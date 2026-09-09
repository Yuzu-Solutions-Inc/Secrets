-- Accusation verdict flash + secret-reveal fan-out.
--
-- Product behaviour:
--  * When the host adjudicates a buzz, the TV holds a VERDICT card (with a
--    celebration for a hit, a "missed" beat for a failed accusation) for a few
--    seconds before the next queued accusation takes the spotlight.
--  * A correct accusation reveals the target's secret: their card on the TV
--    flips to a "secret out" state, and every hint about that player becomes
--    readable in every player's Vault (no purchase / grant needed).
--  * The verdict is also written as a public game event so the activity feed
--    and the TV's "Live" card keep it after the flash fades.

-- ---------------------------------------------------------------------------
-- 1. resolve_accusation_buzz: emit a public verdict event on every resolution.
-- ---------------------------------------------------------------------------
create or replace function public.resolve_accusation_buzz(
  p_buzz_id uuid,
  p_result text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_buzz public.accusation_buzzes%rowtype;
  v_accuser_wallet uuid;
  v_target_wallet uuid;
  v_house_wallet uuid;
  v_amount bigint;
  v_target_balance bigint;
  v_accuser text;
  v_target text;
  v_round uuid;
begin
  select * into v_buzz from public.accusation_buzzes where id = p_buzz_id for update;
  if not public.is_game_admin(v_buzz.game_id) then raise exception 'forbidden'; end if;
  if v_buzz.status in ('correct', 'partial', 'wrong', 'cancelled', 'retracted') then raise exception 'already_resolved'; end if;
  if p_result not in ('correct', 'partial', 'wrong', 'cancelled') then raise exception 'invalid_result'; end if;
  select id into v_accuser_wallet from public.wallets where player_id = v_buzz.accuser_player_id;
  select id, balance into v_target_wallet, v_target_balance from public.wallets where player_id = v_buzz.target_player_id;
  select id into v_house_wallet from public.wallets where game_id = v_buzz.game_id and kind = 'house';
  if p_result = 'wrong' then
    v_amount := v_buzz.stake;
    perform private.transfer_money(v_buzz.game_id, v_house_wallet, v_target_wallet, v_amount, 'buzz_wrong', 'Failed accusation', 'buzz:' || p_buzz_id, auth.uid());
  elsif p_result in ('correct', 'partial') then
    perform private.transfer_money(v_buzz.game_id, v_house_wallet, v_accuser_wallet, v_buzz.stake, 'buzz_refund', 'Accusation stake returned', 'buzzrefund:' || p_buzz_id, auth.uid());
    v_amount := floor(v_target_balance * case when p_result = 'correct' then v_buzz.transfer_percent else floor(v_buzz.transfer_percent / 2.0) end / 100.0);
    perform private.transfer_money(v_buzz.game_id, v_target_wallet, v_accuser_wallet, v_amount, 'buzz_' || p_result, 'Successful accusation', 'buzz:' || p_buzz_id, auth.uid());
    if p_result = 'correct' then
      update public.secrets set status = 'revealed', revealed_at = now()
      where id in (select secret_id from public.secret_holders where player_id = v_buzz.target_player_id);
    end if;
  elsif p_result = 'cancelled' then
    v_amount := 0;
    perform private.transfer_money(v_buzz.game_id, v_house_wallet, v_accuser_wallet, v_buzz.stake, 'buzz_refund', 'Cancelled accusation stake returned', 'buzzrefund:' || p_buzz_id, auth.uid());
  end if;
  update public.accusation_buzzes set status = p_result::public.buzz_status, resolved_at = now(), updated_at = now()
  where id = p_buzz_id;

  select ap.display_name, tp.display_name, g.current_round_id
    into v_accuser, v_target, v_round
  from public.games g
  join public.game_players ag on ag.id = v_buzz.accuser_player_id
  join public.profiles ap on ap.id = ag.user_id
  join public.game_players tg on tg.id = v_buzz.target_player_id
  join public.profiles tp on tp.id = tg.user_id
  where g.id = v_buzz.game_id;

  insert into public.game_events (game_id, round_id, kind, title, body, payload, is_public, published_at)
  values (
    v_buzz.game_id,
    v_round,
    'accusation_' || p_result,
    case p_result
      when 'correct' then coalesce(v_target, 'A player') || ' — secret revealed'
      when 'partial' then coalesce(v_accuser, 'A player') || ' — so close'
      when 'wrong'   then coalesce(v_accuser, 'A player') || ' — missed'
      else 'Accusation voided'
    end,
    case p_result
      when 'correct' then coalesce(v_accuser, 'A player') || ' cracked the secret. Every hint about ' || coalesce(v_target, 'them') || ' is now public.'
      when 'partial' then coalesce(v_accuser, 'A player') || ' was partly right about ' || coalesce(v_target, 'them') || '.'
      when 'wrong'   then coalesce(v_target, 'The target') || ' keeps the secret and takes the stake.'
      else null
    end,
    jsonb_build_object(
      'result', p_result,
      'buzz_id', p_buzz_id,
      'accuser', v_accuser,
      'target', v_target,
      'target_player_id', v_buzz.target_player_id,
      'secret_revealed', p_result = 'correct',
      'amount', coalesce(v_amount, 0)
    ),
    true,
    now()
  );

  insert into public.audit_events (organization_id, game_id, actor_user_id, action, resource_type, resource_id, metadata)
  select g.organization_id, v_buzz.game_id, auth.uid(), 'buzz.resolve', 'accusation_buzz', p_buzz_id,
    jsonb_build_object('result', p_result, 'amount', coalesce(v_amount, 0))
  from public.games g where g.id = v_buzz.game_id;
end;
$$;
grant execute on function public.resolve_accusation_buzz(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. public_game_dashboard: add the just-resolved `verdict` (held ~12s) and a
--    per-player `secret_revealed` flag.
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

-- ---------------------------------------------------------------------------
-- 3. player_vault: hints about a REVEALED secret are readable by everyone, not
--    just players who were granted them. Granted hints keep source 'granted';
--    freshly public ones are tagged 'revealed'.
-- ---------------------------------------------------------------------------
create or replace function public.player_vault(p_game_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with me as (
    select id from public.game_players
    where game_id = p_game_id and user_id = auth.uid()
    limit 1
  )
  select jsonb_build_object(
    'secret', coalesce((
      select jsonb_build_object('has', true, 'status', s.status)
      from public.secret_holders sh
      join public.secrets s on s.id = sh.secret_id
      where sh.player_id = (select id from me) and s.game_id = p_game_id
      limit 1
    ), jsonb_build_object('has', false, 'status', null)),
    'missions', coalesce((
      select jsonb_agg(distinct jsonb_build_object(
        'id', m.id,
        'title', m.title,
        'instructions', m.instructions,
        'status', m.status,
        'reward', m.reward,
        'penalty', m.penalty,
        'visibility', m.visibility,
        'submitted_at', ma.submitted_at
      ))
      from public.mission_assignments ma
      join public.missions m on m.id = ma.mission_id
      left join public.team_members tm on tm.team_id = ma.team_id
      where m.game_id = p_game_id
        and (ma.player_id = (select id from me) or tm.player_id = (select id from me))
    ), '[]'::jsonb),
    'hints', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', h.id,
        'kind', h.kind,
        'text', h.text,
        'position', h.position,
        'about_player_id', ogp.id,
        'about_player_name', op.display_name,
        'source', case when hg.hint_id is not null then 'granted' else 'revealed' end
      ) order by op.display_name, h.position)
      from public.hints h
      join public.secret_holders owner on owner.secret_id = h.secret_id
      join public.game_players ogp on ogp.id = owner.player_id
      join public.profiles op on op.id = ogp.user_id
      join public.secrets s on s.id = h.secret_id
      left join public.hint_grants hg on hg.hint_id = h.id and hg.player_id = (select id from me)
      where ogp.game_id = p_game_id
        and (hg.hint_id is not null or s.status = 'revealed')
    ), '[]'::jsonb),
    'notes', coalesce((
      select jsonb_agg(jsonb_build_object(
        'target_player_id', tn.target_player_id,
        'body', tn.body,
        'updated_at', tn.updated_at
      ))
      from public.theory_notes tn
      where tn.game_id = p_game_id and tn.player_id = (select id from me)
        and tn.target_player_id is not null
    ), '[]'::jsonb),
    'players', coalesce((
      select jsonb_agg(jsonb_build_object('id', gp.id, 'name', p.display_name)
                       order by p.display_name)
      from public.game_players gp
      join public.profiles p on p.id = gp.user_id
      where gp.game_id = p_game_id and gp.id <> (select id from me)
    ), '[]'::jsonb)
  )
  where exists (select 1 from me);
$$;
grant execute on function public.player_vault(uuid) to authenticated;
