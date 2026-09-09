-- Broadcast dilemmas are now a single sentence with Accept / Refuse, and the
-- host attaches auto-applied effects that fire when a player Accepts.

-- 1. Response choice becomes accept / refuse (drop the old check first so the
--    backfill is legal, then re-add it).
alter table public.game_event_responses drop constraint if exists game_event_responses_choice_check;
update public.game_event_responses set choice = 'accept'  where choice = 'option_1';
update public.game_event_responses set choice = 'refuse'  where choice = 'option_2';
alter table public.game_event_responses
  add constraint game_event_responses_choice_check check (choice in ('accept', 'refuse'));

-- 2. apply_dilemma_effects: run a dilemma's payload.effects for one accepter.
--    Idempotent — grant effects dedupe on player_grants.source, cash effects
--    dedupe on the ledger idempotency key.
create or replace function public.apply_dilemma_effects(p_event_id uuid, p_player_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event public.game_events%rowtype;
  v_effects jsonb;
  v_effect jsonb;
  v_recipients uuid[];
  v_rid uuid;
  v_house_wallet uuid;
  v_player_wallet uuid;
  v_amount bigint;
  v_marker text;
begin
  select * into v_event from public.game_events where id = p_event_id;
  if not found or v_event.kind <> 'dilemma' then raise exception 'not_a_dilemma'; end if;
  if not public.is_game_admin(v_event.game_id)
     and not exists (
       select 1 from public.game_players gp
       where gp.id = p_player_id and gp.user_id = auth.uid()
     ) then
    raise exception 'forbidden';
  end if;

  v_marker := 'dilemma:' || p_event_id || ':' || p_player_id;
  v_effects := coalesce(v_event.payload -> 'effects', '[]'::jsonb);
  select id into v_house_wallet from public.wallets where game_id = v_event.game_id and kind = 'house';

  for v_effect in select * from jsonb_array_elements(v_effects) loop
    if coalesce(v_effect ->> 'recipients', 'responder') = 'all' then
      select array_agg(gp.id) into v_recipients
        from public.game_players gp
       where gp.game_id = v_event.game_id and gp.play_status = 'active';
    else
      v_recipients := array[p_player_id];
    end if;
    v_recipients := coalesce(v_recipients, array[]::uuid[]);

    if v_effect ->> 'type' = 'cash' then
      -- Cash always lands on the accepter, never "all".
      v_amount := greatest((v_effect ->> 'amount')::bigint, 0);
      select id into v_player_wallet from public.wallets where player_id = p_player_id;
      begin
        if v_effect ->> 'direction' = 'loss' then
          perform private.transfer_money(v_event.game_id, v_player_wallet, v_house_wallet, v_amount,
            'dilemma_effect', 'Dilemma forfeit', v_marker || ':cash', auth.uid());
        else
          perform private.transfer_money(v_event.game_id, v_house_wallet, v_player_wallet, v_amount,
            'dilemma_effect', 'Dilemma reward', v_marker || ':cash', auth.uid());
        end if;
      exception when unique_violation then
        -- already applied
      end;

    elsif v_effect ->> 'type' = 'free_hint' then
      foreach v_rid in array v_recipients loop
        insert into public.player_grants (game_id, player_id, kind, uses_remaining, target_player_id, source)
        values (v_event.game_id, v_rid, 'free_hint', 1,
                nullif(v_effect ->> 'aboutPlayerId', '')::uuid,
                v_marker || ':fh:' || v_rid)
        on conflict (source) do nothing;
      end loop;

    elsif v_effect ->> 'type' = 'free_buzz' then
      foreach v_rid in array v_recipients loop
        insert into public.player_grants (game_id, player_id, kind, uses_remaining, source)
        values (v_event.game_id, v_rid, 'free_buzz', 1, v_marker || ':fb:' || v_rid)
        on conflict (source) do nothing;
      end loop;

    elsif v_effect ->> 'type' = 'buzz_immunity' then
      foreach v_rid in array v_recipients loop
        insert into public.player_grants (game_id, player_id, kind, uses_remaining, expires_at, source)
        values (v_event.game_id, v_rid, 'buzz_immunity', 1,
                now() + make_interval(mins => greatest((v_effect ->> 'minutes')::int, 1)),
                v_marker || ':bi:' || v_rid)
        on conflict (source) do nothing;
      end loop;
    end if;
  end loop;
end;
$$;
grant execute on function public.apply_dilemma_effects(uuid, uuid) to authenticated;
