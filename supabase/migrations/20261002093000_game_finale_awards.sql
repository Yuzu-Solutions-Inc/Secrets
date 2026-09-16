-- Post-game "finish video" (mirrors the game-show cold open, but for the
-- ending): a public, security-definer read that assembles the winner, a
-- handful of by-the-numbers stats, and a set of funny superlative awards
-- (biggest spender, most secrets uncovered, etc.) once a game is completed.
--
-- Only returns data once games.status = 'completed' (i.e. resolve_finale()
-- has run) — mirrors public_game_dashboard's public_code lookup so the
-- public display can call it with the anon key.

create or replace function public.public_game_awards(p_code text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with g as (
    select *
    from public.games
    where upper(public_code) = upper(p_code) and status = 'completed'
  ),
  spend as (
    select w.player_id, sum(-le.amount) as spent
    from public.ledger_entries le
    join public.wallets w on w.id = le.wallet_id
    join g on w.game_id = g.id
    where w.player_id is not null and le.amount < 0
    group by w.player_id
  ),
  gossip as (
    -- Distinct secrets a player has learned a hint about, excluding their own.
    select hg.player_id, count(distinct h.secret_id) as secrets_known
    from public.hint_grants hg
    join public.hints h on h.id = hg.hint_id
    join public.secrets s on s.id = h.secret_id
    join g on s.game_id = g.id
    where hg.player_id is not null
      and not exists (
        select 1 from public.secret_holders sh
        where sh.secret_id = s.id and sh.player_id = hg.player_id
      )
    group by hg.player_id
  ),
  acc as (
    select
      ab.accuser_player_id as player_id,
      count(*) as made,
      count(*) filter (where ab.status = 'correct') as correct,
      count(*) filter (where ab.status = 'wrong') as wrong
    from public.accusation_buzzes ab
    join g on ab.game_id = g.id
    group by ab.accuser_player_id
  ),
  player_stats as (
    select
      gp.id as player_id,
      p.display_name as name,
      (p.avatar_path is not null) as has_avatar,
      coalesce(w.balance, 0) as balance,
      greatest(g.starting_cash - coalesce(w.balance, 0), 0) as net_loss,
      coalesce(spend.spent, 0) as spent,
      coalesce(gossip.secrets_known, 0) as secrets_known,
      coalesce(acc.made, 0) as accusations_made,
      coalesce(acc.correct, 0) as accusations_correct,
      coalesce(acc.wrong, 0) as accusations_wrong
    from public.game_players gp
    join public.profiles p on p.id = gp.user_id
    join g on gp.game_id = g.id
    left join public.wallets w on w.player_id = gp.id
    left join spend on spend.player_id = gp.id
    left join gossip on gossip.player_id = gp.id
    left join acc on acc.player_id = gp.id
  ),
  leader as (
    (select 'gossip' as key, player_id, name, has_avatar, secrets_known as value
     from player_stats where secrets_known > 0 order by secrets_known desc, player_id limit 1)
  union all
    (select 'bigSpender', player_id, name, has_avatar, spent
     from player_stats where spent > 0 order by spent desc, player_id limit 1)
  union all
    (select 'rockBottom', player_id, name, has_avatar, net_loss
     from player_stats where net_loss > 0 order by net_loss desc, player_id limit 1)
  union all
    (select 'tycoon', player_id, name, has_avatar, balance
     from player_stats where balance > 0 order by balance desc, player_id limit 1)
  union all
    (select 'triggerHappy', player_id, name, has_avatar, accusations_made
     from player_stats where accusations_made > 0 order by accusations_made desc, player_id limit 1)
  union all
    (select 'masterSleuth', player_id, name, has_avatar, accusations_correct
     from player_stats where accusations_correct > 0 order by accusations_correct desc, player_id limit 1)
  union all
    (select 'wildGuesser', player_id, name, has_avatar, accusations_wrong
     from player_stats where accusations_wrong > 0 order by accusations_wrong desc, player_id limit 1)
  )
  select jsonb_build_object(
    'game', jsonb_build_object(
      'id', g.id, 'title', g.title, 'currency_symbol', g.currency_symbol,
      'public_code', g.public_code, 'completed_at', g.completed_at
    ),
    'winner', (
      select jsonb_build_object(
        'player_id', ps.player_id, 'name', ps.name, 'has_avatar', ps.has_avatar,
        'balance', ps.balance, 'method', g.settings -> 'finaleResult' ->> 'method'
      )
      from player_stats ps, g
      where ps.player_id = nullif(g.settings -> 'finaleResult' ->> 'winnerPlayerId', '')::uuid
    ),
    'stats', jsonb_build_object(
      'player_count', (select count(*) from player_stats),
      'secrets_revealed', (select count(*) from public.secrets s join g on s.game_id = g.id where s.status = 'revealed'),
      'accusations_made', (select count(*) from public.accusation_buzzes ab join g on ab.game_id = g.id),
      'rounds_played', (select count(*) from public.game_rounds r join g on r.game_id = g.id where r.status = 'completed')
    ),
    'awards', coalesce((
      select jsonb_agg(jsonb_build_object(
        'key', l.key, 'player_id', l.player_id, 'name', l.name, 'has_avatar', l.has_avatar, 'value', l.value
      ))
      from leader l
    ), '[]'::jsonb)
  )
  from g;
$$;
grant execute on function public.public_game_awards(text) to anon, authenticated;
