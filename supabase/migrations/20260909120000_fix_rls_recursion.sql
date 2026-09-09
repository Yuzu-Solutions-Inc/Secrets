-- Fix "infinite recursion detected in policy" on direct authenticated SELECT.
--
-- Several SELECT policies in 20260908034241_secrets_security_and_functions.sql
-- contain an inline `EXISTS (SELECT ... FROM <other RLS table> ...)` where that
-- other table's policy queries the first table back:
--
--   secrets  <-> secret_holders
--   hints    <-> hint_grants
--   missions <-> mission_assignments
--
-- Postgres evaluates the referenced table's RLS while evaluating the first
-- policy, re-enters the first policy, and aborts. The is_org_* / is_game_*
-- helpers do not have this problem because they are SECURITY DEFINER with
-- `set search_path = ''`, so their internal reads bypass RLS.
--
-- This migration adds SECURITY DEFINER helpers for every cross-table check that
-- was written inline, then recreates the 8 affected policies to call the helpers
-- instead. The access semantics are unchanged - each helper is a literal
-- translation of the predicate it replaces.

-- ---------------------------------------------------------------------------
-- Helpers (all: sql, stable, security definer, empty search_path)
-- ---------------------------------------------------------------------------

-- Current user holds the given secret.
create or replace function public.is_secret_holder(p_secret_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.secret_holders sh
    join public.game_players gp on gp.id = sh.player_id
    where sh.secret_id = p_secret_id and gp.user_id = auth.uid()
  );
$$;

-- Current user is the game host for the game that owns the given secret.
create or replace function public.can_admin_secret(p_secret_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select public.is_game_admin(game_id) from public.secrets where id = p_secret_id),
    false
  );
$$;

-- Current user owns the given game_players row.
create or replace function public.owns_game_player(p_player_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.game_players
    where id = p_player_id and user_id = auth.uid()
  );
$$;

-- Current user is a member of the given team.
create or replace function public.is_on_team(p_team_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_team_id is not null and exists (
    select 1
    from public.team_members tm
    join public.game_players gp on gp.id = tm.player_id
    where tm.team_id = p_team_id and gp.user_id = auth.uid()
  );
$$;

-- Current user is the game host for the game that owns the given hint.
create or replace function public.can_admin_hint(p_hint_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select public.is_game_admin(s.game_id)
    from public.hints h
    join public.secrets s on s.id = h.secret_id
    where h.id = p_hint_id
  ), false);
$$;

-- Current user is a player in the game that owns the given hint.
create or replace function public.plays_hint_game(p_hint_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select public.is_game_player(s.game_id)
    from public.hints h
    join public.secrets s on s.id = h.secret_id
    where h.id = p_hint_id
  ), false);
$$;

-- Current user may read the given hint: host, a direct or team grant, or a
-- public-scope grant while they are in the game.
create or replace function public.can_view_hint(p_hint_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.can_admin_hint(p_hint_id)
    or exists (
      select 1
      from public.hint_grants hg
      left join public.game_players gp on gp.id = hg.player_id
      left join public.team_members tm on tm.team_id = hg.team_id
      left join public.game_players tgp on tgp.id = tm.player_id
      where hg.hint_id = p_hint_id and (
        gp.user_id = auth.uid()
        or tgp.user_id = auth.uid()
        or (hg.scope = 'public' and public.plays_hint_game(p_hint_id))
      )
    );
$$;

-- Current user is assigned to the given mission, directly or via their team.
create or replace function public.is_mission_participant(p_mission_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.mission_assignments ma
    left join public.game_players gp on gp.id = ma.player_id
    left join public.team_members tm on tm.team_id = ma.team_id
    left join public.game_players tgp on tgp.id = tm.player_id
    where ma.mission_id = p_mission_id
      and (gp.user_id = auth.uid() or tgp.user_id = auth.uid())
  );
$$;

-- Current user is the game host for the game that owns the given mission.
create or replace function public.can_admin_mission(p_mission_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select public.is_game_admin(game_id) from public.missions where id = p_mission_id),
    false
  );
$$;

grant execute on function public.is_secret_holder(uuid) to authenticated;
grant execute on function public.can_admin_secret(uuid) to authenticated;
grant execute on function public.owns_game_player(uuid) to authenticated;
grant execute on function public.is_on_team(uuid) to authenticated;
grant execute on function public.can_admin_hint(uuid) to authenticated;
grant execute on function public.plays_hint_game(uuid) to authenticated;
grant execute on function public.can_view_hint(uuid) to authenticated;
grant execute on function public.is_mission_participant(uuid) to authenticated;
grant execute on function public.can_admin_mission(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Recreate the recursive policies (semantics unchanged)
-- ---------------------------------------------------------------------------

drop policy if exists secrets_scoped_select on public.secrets;
create policy secrets_scoped_select on public.secrets for select to authenticated
using (
  public.is_game_admin(game_id)
  or (status = 'revealed' and public.is_game_player(game_id))
  or public.is_secret_holder(id)
);

drop policy if exists holders_scoped_select on public.secret_holders;
create policy holders_scoped_select on public.secret_holders for select to authenticated
using (
  public.can_admin_secret(secret_id)
  or public.owns_game_player(player_id)
);

drop policy if exists hints_scoped_select on public.hints;
create policy hints_scoped_select on public.hints for select to authenticated
using (public.can_view_hint(id));

drop policy if exists hints_admin_manage on public.hints;
create policy hints_admin_manage on public.hints for all to authenticated
using (public.can_admin_secret(secret_id))
with check (public.can_admin_secret(secret_id));

drop policy if exists grants_scoped_select on public.hint_grants;
create policy grants_scoped_select on public.hint_grants for select to authenticated
using (
  public.owns_game_player(player_id)
  or public.is_on_team(team_id)
  or (scope = 'public' and public.plays_hint_game(hint_id))
  or public.can_admin_hint(hint_id)
);

drop policy if exists missions_scoped_select on public.missions;
create policy missions_scoped_select on public.missions for select to authenticated
using (
  public.is_game_admin(game_id)
  or (visibility = 'public' and public.is_game_player(game_id))
  or public.is_mission_participant(id)
);

drop policy if exists mission_assignments_scoped_select on public.mission_assignments;
create policy mission_assignments_scoped_select on public.mission_assignments for select to authenticated
using (
  public.owns_game_player(player_id)
  or public.is_on_team(team_id)
  or public.can_admin_mission(mission_id)
);

drop policy if exists mission_assignments_admin_manage on public.mission_assignments;
create policy mission_assignments_admin_manage on public.mission_assignments for all to authenticated
using (public.can_admin_mission(mission_id))
with check (public.can_admin_mission(mission_id));
