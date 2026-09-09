-- Lock / unlock secrets pill: the host can flip secrets between draft and
-- locked as many times as they like, but only before round 1 starts. Once the
-- game is 'live' (or later) the game status is no longer 'locked', so
-- `unlock_secrets` refuses and the lock is permanent.
--
-- Whole function reproduced (Postgres has no "add one branch"); only the
-- `unlock_secrets` elsif is new.

create or replace function public.host_transition(p_game_id uuid, p_action text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_current uuid;
  v_next uuid;
  v_org uuid;
  v_status public.game_status;
begin
  if not public.is_game_admin(p_game_id) then raise exception 'forbidden'; end if;
  select current_round_id, organization_id, status into v_current, v_org, v_status
  from public.games where id = p_game_id for update;
  if p_action = 'lock_secrets' then
    update public.secrets set status = 'locked', locked_at = now(), updated_at = now()
    where game_id = p_game_id and status = 'draft';
    update public.games set status = 'locked', updated_at = now() where id = p_game_id;
  elsif p_action = 'unlock_secrets' then
    -- Reversible only while round 1 has not started.
    if v_status <> 'locked' then raise exception 'invalid_transition'; end if;
    update public.secrets set status = 'draft', locked_at = null, updated_at = now()
    where game_id = p_game_id and status = 'locked';
    update public.games set status = 'draft', updated_at = now() where id = p_game_id;
  elsif p_action = 'next_round' then
    if v_current is not null then
      update public.game_rounds set status = 'completed', ends_at = coalesce(ends_at, now()), updated_at = now() where id = v_current;
    end if;
    select id into v_next from public.game_rounds
    where game_id = p_game_id and status = 'scheduled'
    order by position limit 1;
    if v_next is null then
      update public.games set status = 'finale', current_round_id = null, updated_at = now() where id = p_game_id;
    else
      update public.game_rounds set status = 'live', starts_at = now(),
        ends_at = now() + make_interval(mins => coalesce((config ->> 'durationMinutes')::int, 45)),
        updated_at = now()
      where id = v_next;
      update public.games set status = 'live', current_round_id = v_next, updated_at = now() where id = p_game_id;
    end if;
  elsif p_action = 'prev_round' then
    if v_current is not null then
      select r.id into v_next
      from public.game_rounds r
      join public.game_rounds cur on cur.id = v_current and cur.game_id = r.game_id
      where r.game_id = p_game_id and r.position < cur.position
      order by r.position desc
      limit 1;
      if v_next is not null then
        update public.game_rounds set status = 'scheduled', updated_at = now() where id = v_current;
        update public.game_rounds set status = 'live', starts_at = now(),
          ends_at = now() + make_interval(mins => coalesce((config ->> 'durationMinutes')::int, 45)),
          updated_at = now()
        where id = v_next;
        update public.games set status = 'live', current_round_id = v_next, updated_at = now() where id = p_game_id;
      end if;
    end if;
  elsif p_action = 'pause' and v_current is not null then
    update public.game_rounds set status = 'paused', updated_at = now() where id = v_current;
  elsif p_action = 'resume' and v_current is not null then
    update public.game_rounds set status = 'live', updated_at = now() where id = v_current;
  elsif p_action = 'finale' then
    update public.games set status = 'finale', updated_at = now() where id = p_game_id;
  elsif p_action = 'complete' then
    update public.games set status = 'completed', completed_at = now(), updated_at = now() where id = p_game_id;
  else
    raise exception 'invalid_transition';
  end if;
  insert into public.audit_events (organization_id, game_id, actor_user_id, action, resource_type, resource_id)
  values (v_org, p_game_id, auth.uid(), 'game.' || p_action, 'game', p_game_id);
end;
$$;
grant execute on function public.host_transition(uuid, text) to authenticated;
