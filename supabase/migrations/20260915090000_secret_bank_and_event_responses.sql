-- Batch 3 of the feature-refinement work. Three additive changes — no existing
-- table is restructured:
--
--   1. secret_bank              - a curated, categorised pool of ready-made
--                                 secrets so a Quick Night can start without
--                                 every player typing one (item 21).
--      + fill_bank_secrets(uuid) - host action: give every active player who
--                                 has no secret a random unused bank entry.
--   2. game_event_responses     - per-player answers to a broadcast dilemma
--                                 (item 14). Unused until the Broadcast tab
--                                 ships, but the table + RLS land here with
--                                 the rest of the schema work.
--   3. set_player_play_status   - now also accepts 'inactive' (attendance,
--                                 reversible, no elimination-round gate) and
--                                 'spectator' (non-finalist), alongside the
--                                 existing 'active' / 'eliminated' (item 3).

-- ---------------------------------------------------------------------------
-- 1. Secret bank
-- ---------------------------------------------------------------------------

create table if not exists public.secret_bank (
  id uuid primary key default gen_random_uuid(),
  category text not null,
  locale text not null default 'en',
  text text not null,
  created_at timestamptz not null default now()
);

create index if not exists secret_bank_pick on public.secret_bank (category, locale);
create unique index if not exists secret_bank_unique on public.secret_bank (category, locale, "text");

alter table public.secret_bank enable row level security;

-- Prompt content, not player data: any signed-in user may read it (same
-- posture as round_templates). No client writes — the seed and the service
-- role are the only writers.
drop policy if exists secret_bank_read on public.secret_bank;
create policy secret_bank_read on public.secret_bank for select to authenticated using (true);

grant select on public.secret_bank to authenticated;

-- Host fills the gaps: for every active player in the game with no secret,
-- insert one drawn at random from the chosen category / locale. Safe to run
-- repeatedly — players who already have a secret are skipped.
create or replace function public.fill_bank_secrets(p_game_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status public.game_status;
  v_category text;
  v_locale text;
  v_player record;
  v_pick text;
  v_secret uuid;
  v_count integer := 0;
begin
  if not public.is_game_admin(p_game_id) then raise exception 'forbidden'; end if;

  select status,
         coalesce(nullif(settings->>'secretCategory', ''), 'mixed'),
         coalesce(nullif(settings->>'language', ''), 'fr')
    into v_status, v_category, v_locale
    from public.games where id = p_game_id;

  if v_status in ('completed', 'archived') then raise exception 'secrets_locked'; end if;

  for v_player in
    select gp.id
    from public.game_players gp
    where gp.game_id = p_game_id
      and gp.play_status = 'active'
      and not exists (
        select 1
        from public.secret_holders sh
        join public.secrets s on s.id = sh.secret_id
        where sh.player_id = gp.id and s.game_id = p_game_id
      )
  loop
    select b.text into v_pick
    from public.secret_bank b
    where (v_category = 'mixed' or b.category = v_category)
      and b.locale = v_locale
    order by random()
    limit 1;

    -- Fall back to any locale, then any category, so a thin bank still works.
    if v_pick is null then
      select b.text into v_pick from public.secret_bank b
      where (v_category = 'mixed' or b.category = v_category)
      order by random() limit 1;
    end if;
    if v_pick is null then
      select b.text into v_pick from public.secret_bank b order by random() limit 1;
    end if;
    if v_pick is null then raise exception 'secret_bank_empty'; end if;

    insert into public.secrets (game_id, value, status)
    values (
      p_game_id,
      v_pick,
      case when v_status in ('draft', 'secret_submission') then 'draft' else 'locked' end::public.secret_status
    )
    returning id into v_secret;
    insert into public.secret_holders (secret_id, player_id) values (v_secret, v_player.id);
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;
grant execute on function public.fill_bank_secrets(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Broadcast dilemma responses
-- ---------------------------------------------------------------------------

create table if not exists public.game_event_responses (
  id uuid primary key default gen_random_uuid(),
  game_event_id uuid not null references public.game_events(id) on delete cascade,
  player_id uuid not null references public.game_players(id) on delete cascade,
  choice text not null check (choice in ('option_1', 'option_2')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (game_event_id, player_id)
);

create index if not exists game_event_responses_by_event on public.game_event_responses (game_event_id);

alter table public.game_event_responses enable row level security;

-- A player reads and writes only their own answer; the host reads every
-- answer for their game so the control room can stack them per dilemma.
drop policy if exists event_responses_self_select on public.game_event_responses;
create policy event_responses_self_select on public.game_event_responses for select to authenticated
using (
  exists (select 1 from public.game_players gp where gp.id = player_id and gp.user_id = auth.uid())
  or exists (
    select 1 from public.game_events e
    where e.id = game_event_id and public.is_game_admin(e.game_id)
  )
);

drop policy if exists event_responses_self_write on public.game_event_responses;
create policy event_responses_self_write on public.game_event_responses for all to authenticated
using (exists (select 1 from public.game_players gp where gp.id = player_id and gp.user_id = auth.uid()))
with check (exists (select 1 from public.game_players gp where gp.id = player_id and gp.user_id = auth.uid()));

grant select, insert, update, delete on public.game_event_responses to authenticated;

drop trigger if exists display_refresh_event_responses on public.game_event_responses;
create trigger display_refresh_event_responses
after insert or update on public.game_event_responses
for each row execute function private.queue_display_refresh();

-- ---------------------------------------------------------------------------
-- 3. Attendance vs elimination vs spectator
-- ---------------------------------------------------------------------------

create or replace function public.set_player_play_status(
  p_game_id uuid,
  p_player_id uuid,
  p_status text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
begin
  if not public.is_game_admin(p_game_id)
     or p_status not in ('active', 'inactive', 'eliminated', 'spectator') then
    raise exception 'forbidden';
  end if;

  -- 'eliminated' still requires a live elimination round. 'inactive'
  -- (attendance) and 'spectator' (non-finalist) are plain host toggles.
  if p_status = 'eliminated' and not exists (
    select 1 from public.games g
    join public.game_rounds r on r.id = g.current_round_id
    where g.id = p_game_id and r.kind = 'elimination' and r.status = 'live'
  ) then raise exception 'elimination_round_required'; end if;

  update public.game_players set play_status = p_status
  where id = p_player_id and game_id = p_game_id;

  select organization_id into v_org from public.games where id = p_game_id;
  insert into public.audit_events (organization_id, game_id, actor_user_id, action, resource_type, resource_id, metadata)
  values (v_org, p_game_id, auth.uid(), 'player.' || p_status, 'game_player', p_player_id, '{}'::jsonb);
end;
$$;
grant execute on function public.set_player_play_status(uuid, uuid, text) to authenticated;
