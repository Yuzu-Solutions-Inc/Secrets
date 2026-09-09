-- Accusation spotlight on the public TV dashboard.
--
-- Product behaviour:
--  * A new accusation buzz lights up the TV (the client plays a sting + buzzer
--    and flashes the screen).
--  * The buzz currently in the spotlight is the OLDEST unresolved one. It stays
--    on screen until the host adjudicates it. Newer buzzes wait in a queue and
--    only take the spotlight once the current one is resolved.
--  * Creating OR resolving a buzz pushes a display cue so every connected TV and
--    every player dashboard re-fetches (balances, revealed secret, queue depth).

-- ---------------------------------------------------------------------------
-- 1. Push a display refresh whenever an accusation buzz is created or changes
--    status. Reuses the existing queue_display_refresh() trigger function,
--    which already derives the game id from new.game_id.
-- ---------------------------------------------------------------------------
drop trigger if exists display_refresh_buzzes on public.accusation_buzzes;
create trigger display_refresh_buzzes
after insert or update on public.accusation_buzzes
for each row execute function private.queue_display_refresh();

-- ---------------------------------------------------------------------------
-- 2. Surface the spotlight buzz + queue depth in the public dashboard payload.
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
      and status in ('locked', 'live', 'finale', 'completed')
  ),
  unresolved as (
    select b.*,
           row_number() over (order by b.created_at, b.id) as queue_position
    from public.accusation_buzzes b
    join g on g.id = b.game_id
    where b.status not in ('correct', 'partial', 'wrong', 'cancelled', 'retracted')
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
        'balance', w.balance
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
    'accusation_queue', (select greatest(count(*) - 1, 0) from unresolved)
  )
  from g;
$$;
grant execute on function public.public_game_dashboard(text) to anon, authenticated;
