-- Finale execution (items 5 & 6). resolve_finale() reads games.settings.finale
-- (entry + resolution, set in the Finale tab), decides who the finalists are,
-- runs the chosen method, records the outcome in settings.finaleResult and
-- completes the game.
--
-- Guardrails: admin only; game must be in 'finale' status; refuses to run
-- twice (settings.finaleResult already present). Only finalist wallets and the
-- house wallet are ever touched.

create or replace function public.resolve_finale(
  p_game_id uuid,
  p_winner_player_id uuid default null,
  p_box_choices jsonb default null   -- {"<game_player_id>": "share"|"steal", ...}
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_game public.games%rowtype;
  v_finale jsonb;
  v_entry jsonb;
  v_res jsonb;
  v_mode text;
  v_n int;
  v_method text;
  v_formula jsonb;
  v_finalists uuid[];
  v_house_wallet uuid;
  v_player record;
  v_results jsonb := '[]'::jsonb;
  v_winner uuid;
  v_pot bigint := 0;
  v_share_pct numeric; v_one_pct numeric; v_many_pct numeric;
  v_sharers uuid[]; v_stealers uuid[];
  v_stealer_pot bigint; v_amount bigint;
begin
  select * into v_game from public.games where id = p_game_id for update;
  if v_game.id is null then raise exception 'not_found'; end if;
  if not public.is_game_admin(p_game_id) then raise exception 'forbidden'; end if;
  if v_game.status <> 'finale' then raise exception 'not_in_finale'; end if;
  if (v_game.settings ? 'finaleResult') then raise exception 'already_resolved'; end if;

  v_finale := coalesce(v_game.settings -> 'finale', '{}'::jsonb);
  v_entry  := coalesce(v_finale -> 'entry', '{}'::jsonb);
  v_res    := coalesce(v_finale -> 'resolution', jsonb_build_object('method', 'formula'));
  v_mode   := coalesce(v_entry ->> 'mode', 'all_active');
  v_n      := coalesce((v_entry ->> 'n')::int, 3);
  v_method := coalesce(v_res ->> 'method', 'formula');
  v_formula := coalesce(v_game.settings -> 'winnerFormula', '{}'::jsonb);

  -- ---- finalist entry -------------------------------------------------------
  if v_mode = 'top_n_by_balance' then
    select array_agg(gp.id) into v_finalists from (
      select gp.id
      from public.game_players gp
      left join public.wallets w on w.player_id = gp.id
      where gp.game_id = p_game_id and gp.play_status = 'active'
      order by coalesce(w.balance, 0) desc, gp.id
      limit v_n
    ) gp;
  elsif v_mode = 'top_n_by_score' then
    select array_agg(gp.id) into v_finalists from (
      select gp.id
      from public.game_players gp
      left join public.wallets w on w.player_id = gp.id
      where gp.game_id = p_game_id and gp.play_status = 'active'
      order by public.finale_score(gp.id, p_game_id, v_formula) desc, gp.id
      limit v_n
    ) gp;
  elsif v_mode = 'manual' then
    select array_agg(value::uuid) into v_finalists
    from jsonb_array_elements_text(coalesce(v_finale -> 'manualFinalists', '[]'::jsonb));
    if v_finalists is null or cardinality(v_finalists) = 0 then
      raise exception 'manual_finalists_missing';
    end if;
  else
    -- all_active and nominated: nominations already flipped the losers, so the
    -- remaining active players are the finalists.
    select array_agg(id) into v_finalists
    from public.game_players where game_id = p_game_id and play_status = 'active';
  end if;
  v_finalists := coalesce(v_finalists, array[]::uuid[]);
  if cardinality(v_finalists) = 0 then raise exception 'no_finalists'; end if;

  -- Everyone still active but not a finalist becomes a spectator.
  update public.game_players
    set play_status = 'spectator'
  where game_id = p_game_id and play_status = 'active' and not (id = any(v_finalists));

  -- ---- resolution ---------------------------------------------------------
  if v_method = 'box_exchange' then
    if p_box_choices is null then raise exception 'box_choices_missing'; end if;
    v_share_pct := coalesce((v_res ->> 'allSharePercent')::numeric, 100) / 100.0;
    v_one_pct   := coalesce((v_res ->> 'singleStealerPercent')::numeric, 60) / 100.0;
    v_many_pct  := coalesce((v_res ->> 'multipleStealersPercent')::numeric, 30) / 100.0;
    select id into v_house_wallet from public.wallets where game_id = p_game_id and kind = 'house';

    -- Pull every finalist's balance into the house pot.
    for v_player in
      select gp.id, coalesce(w.balance, 0) as balance, w.id as wallet_id
      from public.game_players gp join public.wallets w on w.player_id = gp.id
      where gp.id = any(v_finalists)
    loop
      if v_player.balance > 0 then
        perform private.transfer_money(p_game_id, v_player.wallet_id, v_house_wallet, v_player.balance,
          'finale_box_stake', 'Finale box exchange', 'finale:' || p_game_id || ':stake:' || v_player.id, auth.uid());
        v_pot := v_pot + v_player.balance;
      end if;
    end loop;

    select array_agg(key::uuid) filter (where value::text = '"share"'),
           array_agg(key::uuid) filter (where value::text = '"steal"')
      into v_sharers, v_stealers
    from jsonb_each(p_box_choices)
    where key::uuid = any(v_finalists);
    v_sharers := coalesce(v_sharers, array[]::uuid[]);
    v_stealers := coalesce(v_stealers, array[]::uuid[]);

    if cardinality(v_stealers) = 0 then
      foreach v_winner in array v_sharers loop
        v_amount := floor(v_pot * v_share_pct / greatest(cardinality(v_sharers), 1));
        perform private.transfer_money(p_game_id, v_house_wallet, (select id from public.wallets where player_id = v_winner),
          v_amount, 'finale_box_payout', 'Finale share', 'finale:' || p_game_id || ':pay:' || v_winner, auth.uid());
      end loop;
    elsif cardinality(v_sharers) = 0 then
      foreach v_winner in array v_stealers loop
        v_amount := floor(v_pot * 0.5 / greatest(cardinality(v_stealers), 1));
        perform private.transfer_money(p_game_id, v_house_wallet, (select id from public.wallets where player_id = v_winner),
          v_amount, 'finale_box_payout', 'Finale all-steal', 'finale:' || p_game_id || ':pay:' || v_winner, auth.uid());
      end loop;
    else
      v_stealer_pot := floor(v_pot * (case when cardinality(v_stealers) = 1 then v_one_pct else v_many_pct end));
      foreach v_winner in array v_stealers loop
        v_amount := floor(v_stealer_pot / cardinality(v_stealers));
        perform private.transfer_money(p_game_id, v_house_wallet, (select id from public.wallets where player_id = v_winner),
          v_amount, 'finale_box_payout', 'Finale steal', 'finale:' || p_game_id || ':pay:' || v_winner, auth.uid());
      end loop;
      foreach v_winner in array v_sharers loop
        v_amount := floor((v_pot - v_stealer_pot) / cardinality(v_sharers));
        perform private.transfer_money(p_game_id, v_house_wallet, (select id from public.wallets where player_id = v_winner),
          v_amount, 'finale_box_payout', 'Finale share', 'finale:' || p_game_id || ':pay:' || v_winner, auth.uid());
      end loop;
    end if;
  end if;

  -- Build the ranked results (post box-exchange balances if that ran).
  for v_player in
    select gp.id,
           p.display_name as name,
           coalesce(w.balance, 0) as balance,
           public.finale_score(gp.id, p_game_id, v_formula) as score,
           (select count(*) from public.ballots b
              where b.kind = 'finale' and b.target_player_id = gp.id) as votes
    from public.game_players gp
    join public.profiles p on p.id = gp.user_id
    left join public.wallets w on w.player_id = gp.id
    where gp.id = any(v_finalists)
    order by 3 desc
  loop
    v_results := v_results || jsonb_build_object(
      'playerId', v_player.id, 'name', v_player.name,
      'balance', v_player.balance, 'score', v_player.score, 'votes', v_player.votes
    );
  end loop;

  -- ---- winner -----------------------------------------------------------
  if v_method = 'other' then
    if p_winner_player_id is null or not (p_winner_player_id = any(v_finalists)) then
      raise exception 'winner_required';
    end if;
    v_winner := p_winner_player_id;
  elsif v_method = 'vote' then
    select gp.id into v_winner
    from public.game_players gp
    left join public.wallets w on w.player_id = gp.id
    where gp.id = any(v_finalists)
    order by (select count(*) from public.ballots b where b.kind = 'finale' and b.target_player_id = gp.id) desc,
             coalesce(w.balance, 0) desc, gp.id
    limit 1;
  elsif v_method = 'box_exchange' then
    select gp.id into v_winner
    from public.game_players gp join public.wallets w on w.player_id = gp.id
    where gp.id = any(v_finalists)
    order by w.balance desc, gp.id
    limit 1;
  else
    select gp.id into v_winner
    from public.game_players gp
    where gp.id = any(v_finalists)
    order by public.finale_score(gp.id, p_game_id, v_formula) desc, gp.id
    limit 1;
  end if;

  update public.games
    set status = 'completed',
        completed_at = now(),
        updated_at = now(),
        settings = settings || jsonb_build_object('finaleResult', jsonb_build_object(
          'method', v_method,
          'winnerPlayerId', v_winner,
          'finalists', to_jsonb(v_finalists),
          'results', v_results,
          'resolvedAt', now()
        ))
  where id = p_game_id;

  insert into public.audit_events (organization_id, game_id, actor_user_id, action, resource_type, resource_id, metadata)
  values (v_game.organization_id, p_game_id, auth.uid(), 'game.finale_resolved', 'game', p_game_id,
          jsonb_build_object('method', v_method, 'winner', v_winner));

  return jsonb_build_object('winnerPlayerId', v_winner, 'results', v_results);
end;
$$;
grant execute on function public.resolve_finale(uuid, uuid, jsonb) to authenticated;

-- Weighted finale score for one player (mirrors calculateFinalScore in
-- src/lib/game/rules.ts). Bonus weights in settings.winnerFormula are stored in
-- integer minor units; moneyWeight is a plain multiplier.
create or replace function public.finale_score(p_player_id uuid, p_game_id uuid, p_formula jsonb)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select
    floor(coalesce((select balance from public.wallets where player_id = p_player_id), 0)
          * coalesce((p_formula ->> 'moneyWeight')::numeric, 1))
  + case when not exists (
      select 1 from public.secret_holders sh
      join public.secrets s on s.id = sh.secret_id
      where sh.player_id = p_player_id and s.game_id = p_game_id and s.status = 'revealed'
    ) then coalesce((p_formula ->> 'protectedSecretBonus')::bigint, 0) else 0 end
  + case when exists (
      select 1 from public.house_secrets hs
      join public.house_secret_submissions hss on hss.house_secret_id = hs.id
      where hs.game_id = p_game_id and hs.revealed_at is not null
        and hss.player_id = p_player_id and hss.result = 'correct'
    ) then coalesce((p_formula ->> 'houseSecretBonus')::bigint, 0) else 0 end
  + coalesce((p_formula ->> 'missionBonus')::bigint, 0) * (
      select count(*) from public.mission_assignments ma
      join public.missions m on m.id = ma.mission_id
      where m.status = 'approved' and (
        ma.player_id = p_player_id
        or exists (select 1 from public.team_members tm where tm.team_id = ma.team_id and tm.player_id = p_player_id)
      )
    )
  + coalesce((p_formula ->> 'voteBonus')::bigint, 0) * (
      select count(*) from public.ballots b where b.kind = 'finale' and b.target_player_id = p_player_id
    );
$$;
grant execute on function public.finale_score(uuid, uuid, jsonb) to authenticated;
