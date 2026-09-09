-- Teams are managed in player view, not per round (item 1): one team set for
-- the whole game, membership editable anytime. This adds teams.game_id and
-- repoints the five places that reached the game through teams.round_id.
-- round_id stays as a nullable, optional hint (unused by new teams).

alter table public.teams add column if not exists game_id uuid references public.games(id) on delete cascade;

update public.teams t
set game_id = r.game_id
from public.game_rounds r
where r.id = t.round_id and t.game_id is null;

alter table public.teams alter column game_id set not null;
alter table public.teams alter column round_id drop not null;

-- A deleted round must no longer cascade-delete a game-scoped team.
alter table public.teams drop constraint if exists teams_round_id_game_rounds_id_fk;
alter table public.teams
  add constraint teams_round_id_game_rounds_id_fk
  foreign key (round_id) references public.game_rounds(id) on delete set null;

create index if not exists teams_by_game on public.teams (game_id);

-- ---------------------------------------------------------------------------
-- RLS — read/manage teams and members through teams.game_id
-- ---------------------------------------------------------------------------

drop policy if exists teams_game_select on public.teams;
create policy teams_game_select on public.teams for select to authenticated
using (public.is_game_player(game_id) or public.is_game_admin(game_id));

drop policy if exists teams_admin_manage on public.teams;
create policy teams_admin_manage on public.teams for all to authenticated
using (public.is_game_admin(game_id))
with check (public.is_game_admin(game_id));

drop policy if exists team_members_scoped_select on public.team_members;
create policy team_members_scoped_select on public.team_members for select to authenticated
using (
  exists (select 1 from public.game_players gp where gp.id = player_id and gp.user_id = auth.uid())
  or exists (
    select 1 from public.teams t
    where t.id = team_id and public.is_game_admin(t.game_id)
  )
);

-- The host manages team membership (add / remove / delete team). This policy
-- was missing entirely, so createTeam's team_members insert had no way to
-- succeed under RLS.
drop policy if exists team_members_admin_manage on public.team_members;
create policy team_members_admin_manage on public.team_members for all to authenticated
using (exists (select 1 from public.teams t where t.id = team_id and public.is_game_admin(t.game_id)))
with check (exists (select 1 from public.teams t where t.id = team_id and public.is_game_admin(t.game_id)));

-- ---------------------------------------------------------------------------
-- Functions — same bodies, game_id now comes straight off the team row
-- ---------------------------------------------------------------------------

create or replace function private.create_team_wallet()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.wallets (game_id, team_id, kind, balance)
  values (new.game_id, new.id, 'team', 0);
  return new;
end;
$$;

create or replace function public.fund_team_wallet(p_team_id uuid, p_amount bigint)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_game uuid;
  v_team_wallet uuid;
  v_house_wallet uuid;
begin
  select game_id into v_game from public.teams where id = p_team_id;
  if not public.is_game_admin(v_game) or p_amount < 0 then raise exception 'forbidden'; end if;
  select id into v_team_wallet from public.wallets where team_id = p_team_id;
  select id into v_house_wallet from public.wallets where game_id = v_game and kind = 'house';
  return private.transfer_money(v_game, v_house_wallet, v_team_wallet, p_amount, 'team_funding', 'Team opening pot', 'teamfund:' || p_team_id, auth.uid());
end;
$$;
grant execute on function public.fund_team_wallet(uuid, bigint) to authenticated;

create or replace function public.settle_team_dilemma(p_team_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_game uuid;
  v_team_wallet uuid;
  v_pot bigint;
  v_sharers uuid[];
  v_stealers uuid[];
  v_player uuid;
  v_amount bigint;
  v_stealer_pot bigint;
  v_results jsonb := '[]'::jsonb;
begin
  select game_id into v_game from public.teams where id = p_team_id;
  if not public.is_game_admin(v_game) then raise exception 'forbidden'; end if;
  if exists (select 1 from public.team_members where team_id = p_team_id and dilemma_choice is null) then
    raise exception 'choices_incomplete';
  end if;
  select id, balance into v_team_wallet, v_pot from public.wallets where team_id = p_team_id for update;
  v_pot := coalesce(v_pot, 0);
  select array_agg(player_id order by player_id) filter (where dilemma_choice = 'share'),
         array_agg(player_id order by player_id) filter (where dilemma_choice = 'steal')
    into v_sharers, v_stealers
  from public.team_members where team_id = p_team_id;
  v_sharers := coalesce(v_sharers, array[]::uuid[]);
  v_stealers := coalesce(v_stealers, array[]::uuid[]);
  if cardinality(v_stealers) = 0 then
    foreach v_player in array v_sharers loop
      v_amount := v_pot / cardinality(v_sharers);
      perform private.transfer_money(v_game, v_team_wallet, (select id from public.wallets where player_id = v_player), v_amount, 'dilemma_share', 'All shared', 'dilemma:' || p_team_id || ':' || v_player, auth.uid());
      v_results := v_results || jsonb_build_object('playerId', v_player, 'amount', v_amount);
    end loop;
  elsif cardinality(v_sharers) = 0 then
    foreach v_player in array v_stealers loop
      v_amount := floor((v_pot * 0.5) / cardinality(v_stealers));
      perform private.transfer_money(v_game, v_team_wallet, (select id from public.wallets where player_id = v_player), v_amount, 'dilemma_all_steal', 'Everyone stole', 'dilemma:' || p_team_id || ':' || v_player, auth.uid());
      v_results := v_results || jsonb_build_object('playerId', v_player, 'amount', v_amount);
    end loop;
  else
    v_stealer_pot := floor(v_pot * case when cardinality(v_stealers) = 1 then 0.6 else 0.3 end);
    foreach v_player in array v_stealers loop
      v_amount := v_stealer_pot / cardinality(v_stealers);
      perform private.transfer_money(v_game, v_team_wallet, (select id from public.wallets where player_id = v_player), v_amount, 'dilemma_steal', 'Dilemma steal', 'dilemma:' || p_team_id || ':' || v_player, auth.uid());
      v_results := v_results || jsonb_build_object('playerId', v_player, 'amount', v_amount);
    end loop;
    foreach v_player in array v_sharers loop
      v_amount := (v_pot - v_stealer_pot) / cardinality(v_sharers);
      perform private.transfer_money(v_game, v_team_wallet, (select id from public.wallets where player_id = v_player), v_amount, 'dilemma_share', 'Dilemma share', 'dilemma:' || p_team_id || ':' || v_player, auth.uid());
      v_results := v_results || jsonb_build_object('playerId', v_player, 'amount', v_amount);
    end loop;
  end if;
  return v_results;
end;
$$;
grant execute on function public.settle_team_dilemma(uuid) to authenticated;
