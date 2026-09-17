-- Finale "box exchange": share/steal was being picked by the HOST on each
-- finalist's behalf (host-control-room.tsx had a button per player). That's
-- backwards for a game about betrayal — finalists should make that call
-- themselves, from their own phone, same as the existing team-dilemma
-- share/steal choice.
--
-- Splits box_exchange resolution into two steps:
--   1. open_finale_box_choices() — host locks in who the finalists are
--      (same entry-mode logic resolve_finale used to run inline) and flips
--      everyone else to spectator. Finalists then see a Share/Steal prompt.
--   2. Each finalist calls submit_finale_box_choice() themselves. Once
--      everyone has answered, the host's existing "Resolve & complete game"
--      runs resolve_finale(), which now reads the stored choices instead of
--      taking them as a host-supplied jsonb blob.

alter table public.game_players add column if not exists finale_box_choice text;

-- Shared finalist-entry logic, factored out of resolve_finale so
-- open_finale_box_choices can run it ahead of time for box_exchange.
create or replace function private.compute_finale_finalists(p_game_id uuid, p_finale jsonb, p_formula jsonb)
returns uuid[]
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_entry jsonb := coalesce(p_finale -> 'entry', '{}'::jsonb);
  v_mode text := coalesce(v_entry ->> 'mode', 'all_active');
  v_n int := coalesce((v_entry ->> 'n')::int, 3);
  v_finalists uuid[];
begin
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
      order by public.finale_score(gp.id, p_game_id, p_formula) desc, gp.id
      limit v_n
    ) gp;
  elsif v_mode = 'manual' then
    select array_agg(value::uuid) into v_finalists
    from jsonb_array_elements_text(coalesce(p_finale -> 'manualFinalists', '[]'::jsonb));
    if v_finalists is null or cardinality(v_finalists) = 0 then
      raise exception 'manual_finalists_missing';
    end if;
  else
    select array_agg(id) into v_finalists
    from public.game_players where game_id = p_game_id and play_status = 'active';
  end if;
  v_finalists := coalesce(v_finalists, array[]::uuid[]);
  if cardinality(v_finalists) = 0 then raise exception 'no_finalists'; end if;
  return v_finalists;
end;
$$;

-- Host: lock in the finale roster for a box_exchange finale and flip
-- everyone else to spectator. Idempotent guard — can only run once per game.
create or replace function public.open_finale_box_choices(p_game_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_game public.games%rowtype;
  v_finale jsonb;
  v_method text;
  v_finalists uuid[];
begin
  select * into v_game from public.games where id = p_game_id for update;
  if v_game.id is null then raise exception 'not_found'; end if;
  if not public.is_game_admin(p_game_id) then raise exception 'forbidden'; end if;
  if v_game.status <> 'finale' then raise exception 'not_in_finale'; end if;
  if (v_game.settings ? 'finaleResult') then raise exception 'already_resolved'; end if;

  v_finale := coalesce(v_game.settings -> 'finale', '{}'::jsonb);
  v_method := coalesce((v_finale -> 'resolution' ->> 'method'), 'formula');
  if v_method <> 'box_exchange' then raise exception 'not_box_exchange'; end if;
  if (v_finale ? 'finalists') then raise exception 'already_opened'; end if;

  v_finalists := private.compute_finale_finalists(p_game_id, v_finale, coalesce(v_game.settings -> 'winnerFormula', '{}'::jsonb));

  update public.game_players
    set play_status = 'spectator'
  where game_id = p_game_id and play_status = 'active' and not (id = any(v_finalists));

  update public.game_players set finale_box_choice = null where id = any(v_finalists);

  update public.games
    set settings = jsonb_set(
      settings,
      '{finale}',
      coalesce(settings -> 'finale', '{}'::jsonb) || jsonb_build_object('finalists', to_jsonb(v_finalists)),
      true
    ),
    updated_at = now()
  where id = p_game_id;

  insert into public.audit_events (organization_id, game_id, actor_user_id, action, resource_type, resource_id, metadata)
  values (v_game.organization_id, p_game_id, auth.uid(), 'game.finale_box_choices_opened', 'game', p_game_id,
          jsonb_build_object('finalists', to_jsonb(v_finalists)));

  return jsonb_build_object('finalists', to_jsonb(v_finalists));
end;
$$;
grant execute on function public.open_finale_box_choices(uuid) to authenticated;

-- Player: lock in their own share/steal choice. Idempotent on a re-submit of
-- the SAME choice (double-click, retried request); raises if they try to
-- flip an already-locked answer.
create or replace function public.submit_finale_box_choice(p_player_id uuid, p_choice text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_game_id uuid;
  v_game public.games%rowtype;
  v_finale jsonb;
  v_finalists jsonb;
  v_updated int;
begin
  if p_choice not in ('share', 'steal') then raise exception 'invalid_choice'; end if;
  select game_id into v_game_id from public.game_players
    where id = p_player_id and user_id = auth.uid();
  if v_game_id is null then raise exception 'forbidden'; end if;

  select * into v_game from public.games where id = v_game_id for update;
  if v_game.status <> 'finale' then raise exception 'not_in_finale'; end if;
  if (v_game.settings ? 'finaleResult') then raise exception 'already_resolved'; end if;

  v_finale := coalesce(v_game.settings -> 'finale', '{}'::jsonb);
  if coalesce((v_finale -> 'resolution' ->> 'method'), 'formula') <> 'box_exchange' then
    raise exception 'not_box_exchange';
  end if;
  v_finalists := v_finale -> 'finalists';
  if v_finalists is null or not (v_finalists @> to_jsonb(p_player_id)) then
    raise exception 'not_a_finalist';
  end if;

  update public.game_players
    set finale_box_choice = p_choice
  where id = p_player_id and (finale_box_choice is null or finale_box_choice = p_choice);
  get diagnostics v_updated = row_count;
  if v_updated = 0 then raise exception 'choice_locked'; end if;

  insert into public.display_cues (game_id) values (v_game_id);
end;
$$;
grant execute on function public.submit_finale_box_choice(uuid, text) to authenticated;

-- resolve_finale: box_exchange now reads its finalist roster and each
-- finalist's choice from the DB (set by open_finale_box_choices /
-- submit_finale_box_choice above) instead of a host-supplied jsonb blob —
-- the parameter list shrinks, so the old three-arg overload is dropped.
drop function if exists public.resolve_finale(uuid, uuid, jsonb);

create or replace function public.resolve_finale(
  p_game_id uuid,
  p_winner_player_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_game public.games%rowtype;
  v_finale jsonb;
  v_res jsonb;
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
  v_res    := coalesce(v_finale -> 'resolution', jsonb_build_object('method', 'formula'));
  v_method := coalesce(v_res ->> 'method', 'formula');
  v_formula := coalesce(v_game.settings -> 'winnerFormula', '{}'::jsonb);

  -- ---- finalist entry -------------------------------------------------------
  if v_method = 'box_exchange' then
    -- Locked in earlier by open_finale_box_choices — finalists have already
    -- been asked, so recomputing here (and re-flipping spectators) would
    -- both be redundant and risk drifting from what players actually saw.
    if not (v_finale ? 'finalists') then raise exception 'finalists_not_locked'; end if;
    select array_agg(value::uuid) into v_finalists
    from jsonb_array_elements_text(v_finale -> 'finalists');
  else
    v_finalists := private.compute_finale_finalists(p_game_id, v_finale, v_formula);
    -- Everyone still active but not a finalist becomes a spectator.
    update public.game_players
      set play_status = 'spectator'
    where game_id = p_game_id and play_status = 'active' and not (id = any(v_finalists));
  end if;
  if v_finalists is null or cardinality(v_finalists) = 0 then raise exception 'no_finalists'; end if;

  -- ---- resolution ---------------------------------------------------------
  if v_method = 'box_exchange' then
    if exists (select 1 from public.game_players where id = any(v_finalists) and finale_box_choice is null) then
      raise exception 'box_choices_missing';
    end if;
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

    select array_agg(id) filter (where finale_box_choice = 'share'),
           array_agg(id) filter (where finale_box_choice = 'steal')
      into v_sharers, v_stealers
    from public.game_players where id = any(v_finalists);
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
grant execute on function public.resolve_finale(uuid, uuid) to authenticated;
