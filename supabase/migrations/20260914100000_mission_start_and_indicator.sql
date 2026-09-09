-- Missions are authored ahead of time by the host and stay hidden from players
-- until the host starts them from the control room. This migration adds:
--   * missions.started_at            - when the host flipped it live
--   * mission_assignments.seen_at    - player ack, drives the phone indicator
--   * RLS: players never see a draft mission
--   * start_mission(uuid)            - host: draft -> offered + started_at
--   * mark_mission_seen(uuid, uuid)  - player: clear the "new mission" dot
--   * a display-refresh trigger so every dashboard reacts in real time

alter table public.missions
  add column if not exists started_at timestamptz;

alter table public.mission_assignments
  add column if not exists seen_at timestamptz;

-- Anything already past draft was, by definition, already started.
update public.missions
  set started_at = coalesce(started_at, created_at)
  where status <> 'draft' and started_at is null;

-- Players and teams only see a mission once it has left draft. Admins still
-- see everything so they can prepare missions in advance.
drop policy if exists missions_scoped_select on public.missions;
create policy missions_scoped_select on public.missions for select to authenticated
using (
  public.is_game_admin(game_id)
  or (
    status <> 'draft'
    and (
      (visibility = 'public' and public.is_game_player(game_id))
      or public.is_mission_participant(id)
    )
  )
);

-- Host flips a prepared draft mission live.
create or replace function public.start_mission(p_mission_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_mission public.missions%rowtype;
begin
  select * into v_mission from public.missions where id = p_mission_id for update;
  if v_mission.id is null then raise exception 'not_found'; end if;
  if not public.is_game_admin(v_mission.game_id) then raise exception 'forbidden'; end if;
  if v_mission.status <> 'draft' then raise exception 'already_started'; end if;

  update public.missions
    set status = 'offered', started_at = now()
    where id = p_mission_id;
end;
$$;
grant execute on function public.start_mission(uuid) to authenticated;

-- Player acknowledges a started mission so the "new mission" indicator clears.
-- Covers both direct player assignments and the player's team assignments.
create or replace function public.mark_mission_seen(p_mission_id uuid, p_player_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.game_players gp
    where gp.id = p_player_id and gp.user_id = auth.uid()
  ) then raise exception 'forbidden'; end if;

  update public.mission_assignments ma
    set seen_at = now()
    where ma.mission_id = p_mission_id
      and ma.seen_at is null
      and (
        ma.player_id = p_player_id
        or exists (
          select 1 from public.team_members tm
          where tm.team_id = ma.team_id and tm.player_id = p_player_id
        )
      );
end;
$$;
grant execute on function public.mark_mission_seen(uuid, uuid) to authenticated;

-- Creating, starting or resolving a mission nudges every connected dashboard
-- through the shared display_cues channel.
drop trigger if exists display_refresh_missions on public.missions;
create trigger display_refresh_missions
after insert or update on public.missions
for each row execute function private.queue_display_refresh();
