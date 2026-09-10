-- Play / pause now actually freezes the round clock. Before, `pause` only set
-- game_rounds.status = 'paused' and left ends_at untouched, so the countdown
-- kept draining on the host control room and the public display; on resume the
-- round had silently lost all the paused time. We now snapshot the seconds
-- left at the moment of the pause (game_rounds.paused_seconds_left) and rebuild
-- ends_at from that snapshot on resume.

alter table public.game_rounds
  add column if not exists paused_seconds_left integer;

-- ---------------------------------------------------------------------------
-- host_transition — whole function reproduced (Postgres has no "replace one
-- branch"); only the pause / resume branches (and clearing the snapshot when a
-- round starts) changed versus 20260921093000_unlock_secrets.sql.
-- ---------------------------------------------------------------------------
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
        paused_seconds_left = null,
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
        update public.game_rounds set status = 'scheduled', paused_seconds_left = null, updated_at = now() where id = v_current;
        update public.game_rounds set status = 'live', starts_at = now(),
          ends_at = now() + make_interval(mins => coalesce((config ->> 'durationMinutes')::int, 45)),
          paused_seconds_left = null,
          updated_at = now()
        where id = v_next;
        update public.games set status = 'live', current_round_id = v_next, updated_at = now() where id = p_game_id;
      end if;
    end if;
  elsif p_action = 'pause' and v_current is not null then
    update public.game_rounds
      set status = 'paused',
          paused_seconds_left = greatest(0, ceil(extract(epoch from (ends_at - now())))::int),
          updated_at = now()
    where id = v_current;
  elsif p_action = 'resume' and v_current is not null then
    update public.game_rounds
      set status = 'live',
          ends_at = case
            when paused_seconds_left is not null then now() + make_interval(secs => paused_seconds_left)
            else ends_at
          end,
          paused_seconds_left = null,
          updated_at = now()
    where id = v_current;
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

-- ---------------------------------------------------------------------------
-- public_game_dashboard — whole function reproduced (Postgres has no "add one
-- key"); only the `round` object gains `paused_seconds_left` versus
-- 20260927090000_host_ux_batch.sql.
-- ---------------------------------------------------------------------------
create or replace function public.public_game_dashboard(p_code text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with g as (
    select *
    from public.games
    where upper(public_code) = upper(p_code)
      and status in ('draft', 'secret_submission', 'locked', 'live', 'finale', 'completed')
  ),
  unresolved as (
    select b.*,
           row_number() over (order by b.created_at, b.id) as queue_position
    from public.accusation_buzzes b
    join g on g.id = b.game_id
    where b.status not in ('correct', 'partial', 'wrong', 'cancelled', 'retracted')
  ),
  recent_verdict as (
    select b.*,
           row_number() over (order by b.resolved_at desc, b.id) as rn
    from public.accusation_buzzes b
    join g on g.id = b.game_id
    where b.status in ('correct', 'partial', 'wrong')
      and b.resolved_at is not null
      and b.resolved_at > now() - interval '12 seconds'
  )
  select jsonb_build_object(
    'game', jsonb_build_object(
      'id', g.id, 'title', g.title, 'status', g.status,
      'currency_symbol', g.currency_symbol, 'public_code', g.public_code,
      'background_path', g.background_path
    ),
    'round', (
      select jsonb_build_object('id', r.id, 'title', r.title, 'kind', r.kind, 'status', r.status, 'ends_at', r.ends_at, 'paused_seconds_left', r.paused_seconds_left)
      from public.game_rounds r where r.id = g.current_round_id
    ),
    'players', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', gp.id, 'play_status', gp.play_status,
        'display_name', p.display_name, 'avatar_path', p.avatar_path,
        'balance', w.balance,
        'secret_revealed', exists (
          select 1 from public.secret_holders sh
          join public.secrets s on s.id = sh.secret_id
          where sh.player_id = gp.id and s.status = 'revealed'
        )
      ) order by p.display_name)
      from public.game_players gp
      join public.profiles p on p.id = gp.user_id
      left join public.wallets w on w.player_id = gp.id
      where gp.game_id = g.id
    ), '[]'::jsonb),
    'latest_event', (
      select jsonb_build_object('id', e.id, 'title', e.title, 'body', e.body, 'kind', e.kind, 'published_at', e.published_at)
      from public.game_events e
      where e.game_id = g.id and e.is_public and e.published_at is not null
      order by e.published_at desc limit 1
    ),
    'recent_events', coalesce((
      select jsonb_agg(ev order by ev->>'published_at' desc)
      from (
        select jsonb_build_object('id', e.id, 'title', e.title, 'body', e.body, 'kind', e.kind, 'published_at', e.published_at) as ev
        from public.game_events e
        where e.game_id = g.id and e.is_public and e.published_at is not null
        order by e.published_at desc
        limit 8
      ) s
    ), '[]'::jsonb),
    'accusation', (
      select jsonb_build_object(
        'id', s.id,
        'theory', s.theory,
        'stake', s.stake,
        'status', s.status,
        'created_at', s.created_at,
        'accuser', ap.display_name,
        'target', tp.display_name
      )
      from unresolved s
      join public.game_players ag on ag.id = s.accuser_player_id
      join public.profiles ap on ap.id = ag.user_id
      join public.game_players tg on tg.id = s.target_player_id
      join public.profiles tp on tp.id = tg.user_id
      where s.queue_position = 1
    ),
    'accusation_queue', (select greatest(count(*) - 1, 0) from unresolved),
    'verdict', (
      select jsonb_build_object(
        'id', v.id,
        'result', v.status,
        'theory', v.theory,
        'resolved_at', v.resolved_at,
        'accuser', ap.display_name,
        'target', tp.display_name,
        'secret_revealed', v.status = 'correct'
      )
      from recent_verdict v
      join public.game_players ag on ag.id = v.accuser_player_id
      join public.profiles ap on ap.id = ag.user_id
      join public.game_players tg on tg.id = v.target_player_id
      join public.profiles tp on tp.id = tg.user_id
      where v.rn = 1
    )
  )
  from g;
$$;
grant execute on function public.public_game_dashboard(text) to anon, authenticated;
