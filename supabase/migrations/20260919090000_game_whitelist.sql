-- One shared join link per game + a strict email whitelist (item 2). Replaces
-- the per-email hashed-token invitation flow: the host adds emails, everyone
-- uses the same link, and join_game() refuses anyone whose email is not listed.

-- ---------------------------------------------------------------------------
-- games.invite_token — the single link
-- ---------------------------------------------------------------------------

alter table public.games add column if not exists invite_token text;
update public.games
  set invite_token = replace(gen_random_uuid()::text, '-', '')
  where invite_token is null;
alter table public.games alter column invite_token set not null;
create unique index if not exists games_invite_token_key on public.games (invite_token);

-- ---------------------------------------------------------------------------
-- game_whitelist — the allow-list
-- ---------------------------------------------------------------------------

create table if not exists public.game_whitelist (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games(id) on delete cascade,
  email text not null,
  added_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
create unique index if not exists game_whitelist_unique on public.game_whitelist (game_id, lower(email));
create index if not exists game_whitelist_by_email on public.game_whitelist (lower(email));

alter table public.game_whitelist enable row level security;

drop policy if exists game_whitelist_admin_manage on public.game_whitelist;
create policy game_whitelist_admin_manage on public.game_whitelist for all to authenticated
using (public.is_game_admin(game_id))
with check (public.is_game_admin(game_id));

-- An invited person may see the row that names their own email, so the join
-- page can tell them they're on the list.
drop policy if exists game_whitelist_self_read on public.game_whitelist;
create policy game_whitelist_self_read on public.game_whitelist for select to authenticated
using (lower(email) = (select lower(coalesce(email, '')) from auth.users where id = auth.uid()));

grant select, insert, update, delete on public.game_whitelist to authenticated;

-- ---------------------------------------------------------------------------
-- join_game(token) — the accept path
-- ---------------------------------------------------------------------------

create or replace function public.join_game(p_token text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_game public.games%rowtype;
  v_email text;
begin
  if auth.uid() is null then raise exception 'unauthorized'; end if;
  select lower(coalesce(email, '')) into v_email from auth.users where id = auth.uid();

  select * into v_game from public.games where invite_token = p_token;
  if v_game.id is null then raise exception 'invalid_link'; end if;

  if not exists (
    select 1 from public.game_whitelist w
    where w.game_id = v_game.id and lower(w.email) = v_email
  ) then
    raise exception 'not_whitelisted';
  end if;

  if v_game.status in ('live', 'finale', 'completed', 'archived')
     and coalesce((v_game.settings ->> 'allowLateJoin')::boolean, false) = false then
    raise exception 'late_join_closed';
  end if;

  insert into public.organization_members (organization_id, user_id, role)
  values (v_game.organization_id, auth.uid(), 'player')
  on conflict (organization_id, user_id) do nothing;

  insert into public.game_players (game_id, user_id)
  values (v_game.id, auth.uid())
  on conflict (game_id, user_id) do nothing;

  return v_game.id;
end;
$$;
grant execute on function public.join_game(text) to authenticated;

-- Read model for the join page — resolves the token past RLS and reports
-- whether the caller is on the list.
create or replace function public.join_game_summary(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_game public.games%rowtype;
  v_email text;
begin
  select * into v_game from public.games where invite_token = p_token;
  if v_game.id is null then return null; end if;
  select lower(coalesce(email, '')) into v_email from auth.users where id = auth.uid();
  return jsonb_build_object(
    'game_id', v_game.id,
    'game_title', v_game.title,
    'organization_name', (select name from public.organizations where id = v_game.organization_id),
    'whitelisted', exists (
      select 1 from public.game_whitelist w
      where w.game_id = v_game.id and v_email <> '' and lower(w.email) = v_email
    ),
    'already_player', exists (
      select 1 from public.game_players gp
      where gp.game_id = v_game.id and gp.user_id = auth.uid()
    )
  );
end;
$$;
grant execute on function public.join_game_summary(text) to authenticated;
