-- Mission timer is anchored at start, not at creation (closes the known gap
-- from batch 9). The host sets a duration when creating the mission; the
-- countdown only begins when they press Start.

alter table public.missions add column if not exists timer_minutes integer not null default 0;

-- Reconcile drafts that had a create-time deadline: recover the intended
-- minutes and clear the deadline so start_mission sets it fresh.
update public.missions
  set timer_minutes = greatest(0, round(extract(epoch from (deadline - created_at)) / 60.0))::int,
      deadline = null
  where status = 'draft' and deadline is not null;

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
    set status = 'offered',
        started_at = now(),
        deadline = case
          when coalesce(v_mission.timer_minutes, 0) > 0
            then now() + make_interval(mins => v_mission.timer_minutes)
          else v_mission.deadline
        end
    where id = p_mission_id;
end;
$$;
grant execute on function public.start_mission(uuid) to authenticated;
