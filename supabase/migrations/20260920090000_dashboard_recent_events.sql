-- Dashboard event history + phone mirror (items 18, 23): the display feed now
-- also carries the last few public events so the TV can keep a history column
-- and every open phone can flash the newest one. Whole function reproduced
-- (create or replace); only the new `recent_events` key is added.

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
      and status in ('locked', 'live', 'finale', 'completed')
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
      select jsonb_build_object('id', r.id, 'title', r.title, 'kind', r.kind, 'status', r.status, 'ends_at', r.ends_at)
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
