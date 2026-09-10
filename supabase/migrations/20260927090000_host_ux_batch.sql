-- Host UX batch:
--   1. The public TV dashboard is now reachable before the game starts
--      (draft / secret_submission), so a host can open it on the room screen
--      while players are still joining.
--   2. Dilemma "On Accept" effects can now grant a named power (double vote,
--      immunity, buzz shield) alongside cash / free buzz / free hint.

-- ---------------------------------------------------------------------------
-- 1. public_game_dashboard — allow the pre-live statuses. Whole function
--    reproduced (Postgres has no "add one branch"); only the status filter
--    in the `g` CTE changed.
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

-- Realtime refresh cue is visible for the same expanded set of statuses.
drop policy if exists display_cues_public_select on public.display_cues;
create policy display_cues_public_select on public.display_cues for select to anon, authenticated
using (exists (
  select 1 from public.games g
  where g.id = game_id
    and g.status in ('draft', 'secret_submission', 'locked', 'live', 'finale', 'completed')
));

-- ---------------------------------------------------------------------------
-- 2. Dilemma power effects.
-- ---------------------------------------------------------------------------
alter table public.player_powers add column if not exists source text;
create unique index if not exists player_powers_source_uniq
  on public.player_powers (source) where source is not null;

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

    elsif v_effect ->> 'type' = 'power' then
      -- Named power grant (double-vote / immunity / buzz-shield), same shape
      -- as the host's "Grant power" broadcast.
      foreach v_rid in array v_recipients loop
        insert into public.player_powers (player_id, kind, config, source)
        values (v_rid, coalesce(v_effect ->> 'power', 'immunity'), '{}'::jsonb,
                v_marker || ':pw:' || coalesce(v_effect ->> 'power', 'immunity') || ':' || v_rid)
        on conflict (source) do nothing;
      end loop;
    end if;
  end loop;
end;
$$;
grant execute on function public.apply_dilemma_effects(uuid, uuid) to authenticated;
