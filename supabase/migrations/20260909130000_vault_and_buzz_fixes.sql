-- Vault feature + buzz/secret robustness fixes.
--
-- 1. create_accusation_buzz / buy_next_hint: the `select ... into` that loads
--    round config filtered on `g.status in ('live','finale')`. When the game is
--    NOT live/finale that select matches zero rows, so the target variables are
--    left NULL (the per-row coalesce fallbacks never run) and the following
--    INSERT hits a NOT NULL constraint (accusation_buzzes.stake /
--    hint_grants.scope). The raw Postgres error bubbles out of the server action
--    as a generic "Something went wrong" page. Fail fast with a named error
--    instead, and let the server action translate it.
--
-- 2. submit_player_secret: previously hard-blocked once the game left
--    'secret_submission', so a player invited after that point (late join) could
--    never enter a secret. Allow a FIRST secret at any time before the game ends;
--    still block edits to an existing/locked secret.
--
-- 3. player_vault / my_secret: read models for the new player Vault UI.
--
-- 4. theory_notes: unique key so per-target notes can be upserted.

-- ---------------------------------------------------------------------------
-- 1. Buzz creation guards
-- ---------------------------------------------------------------------------

create or replace function public.create_accusation_buzz(
  p_game_id uuid,
  p_target_player_id uuid,
  p_theory text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_accuser uuid := public.current_game_player_id(p_game_id);
  v_stake bigint := 500000;
  v_percent int := 50;
  v_balance bigint;
  v_id uuid;
  v_buyer_wallet uuid;
  v_house_wallet uuid;
begin
  if v_accuser is null or v_accuser = p_target_player_id then raise exception 'invalid_target'; end if;
  select coalesce((gr.config ->> 'accusationStake')::bigint, v_stake),
         coalesce((gr.config ->> 'correctTransferPercent')::int, v_percent)
    into v_stake, v_percent
  from public.games g left join public.game_rounds gr on gr.id = g.current_round_id
  where g.id = p_game_id and g.status in ('live', 'finale');
  if not found then raise exception 'game_not_live'; end if;
  select balance into v_balance from public.wallets where player_id = v_accuser;
  if v_balance is null or v_balance < v_stake then raise exception 'insufficient_funds'; end if;
  if exists (
    select 1 from public.secret_holders sh join public.secrets s on s.id = sh.secret_id
    where sh.player_id = p_target_player_id and s.status = 'revealed'
  ) then raise exception 'secret_revealed'; end if;
  insert into public.accusation_buzzes
    (game_id, accuser_player_id, target_player_id, theory, stake, transfer_percent)
  values (p_game_id, v_accuser, p_target_player_id, left(trim(p_theory), 500), v_stake, v_percent)
  returning id into v_id;
  select id into v_buyer_wallet from public.wallets where player_id = v_accuser;
  select id into v_house_wallet from public.wallets where game_id = p_game_id and kind = 'house';
  perform private.transfer_money(p_game_id, v_buyer_wallet, v_house_wallet, v_stake, 'buzz_escrow', 'Accusation stake held', 'buzzescrow:' || v_id, auth.uid());
  return v_id;
end;
$$;
grant execute on function public.create_accusation_buzz(uuid, uuid, text) to authenticated;

create or replace function public.buy_next_hint(
  p_game_id uuid,
  p_target_player_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_buyer uuid := public.current_game_player_id(p_game_id);
  v_hint uuid;
  v_price bigint := 100000;
  v_scope public.knowledge_scope := 'private';
  v_buyer_wallet uuid;
  v_house_wallet uuid;
begin
  if v_buyer is null or v_buyer = p_target_player_id then raise exception 'invalid_target'; end if;
  select coalesce((gr.config ->> 'hintPrice')::bigint, v_price),
         coalesce((gr.config ->> 'hintVisibility')::public.knowledge_scope, v_scope)
    into v_price, v_scope
  from public.games g left join public.game_rounds gr on gr.id = g.current_round_id
  where g.id = p_game_id and g.status in ('live', 'finale');
  if not found then raise exception 'game_not_live'; end if;
  select h.id into v_hint
  from public.secret_holders sh
  join public.secrets s on s.id = sh.secret_id and s.status <> 'revealed'
  join public.hints h on h.secret_id = s.id
  where sh.player_id = p_target_player_id
    and not exists (
      select 1 from public.hint_grants hg
      where hg.hint_id = h.id and hg.player_id = v_buyer
    )
  order by h.position limit 1;
  if v_hint is null then raise exception 'no_hints_left'; end if;
  select id into v_buyer_wallet from public.wallets where player_id = v_buyer;
  select id into v_house_wallet from public.wallets where game_id = p_game_id and kind = 'house';
  perform private.transfer_money(p_game_id, v_buyer_wallet, v_house_wallet, v_price, 'hint_purchase', 'Purchased hint', 'hintbuy:' || gen_random_uuid()::text, auth.uid());
  insert into public.hint_grants (hint_id, player_id, scope, source, granted_by)
  values (v_hint, v_buyer, v_scope, 'buzz', auth.uid());
  insert into public.hint_buzzes (game_id, buyer_player_id, target_player_id, hint_id, price, scope)
  values (p_game_id, v_buyer, p_target_player_id, v_hint, v_price, v_scope);
  return v_hint;
end;
$$;
grant execute on function public.buy_next_hint(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Late-join secret submission
-- ---------------------------------------------------------------------------

create or replace function public.submit_player_secret(
  p_game_id uuid,
  p_player_id uuid,
  p_value text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_secret uuid;
  v_status public.game_status;
begin
  select status into v_status from public.games where id = p_game_id;
  if v_status in ('completed', 'archived') then raise exception 'secrets_locked'; end if;
  if p_player_id <> public.current_game_player_id(p_game_id)
     and not public.is_game_admin(p_game_id) then
    raise exception 'forbidden';
  end if;
  select sh.secret_id into v_secret
  from public.secret_holders sh join public.secrets s on s.id = sh.secret_id
  where sh.player_id = p_player_id and s.game_id = p_game_id limit 1;
  if v_secret is null then
    -- First-time submission is allowed any time before the game ends, so a
    -- player invited after submission closed can still enter one. If we are
    -- already past submission the secret goes straight to 'locked'.
    insert into public.secrets (game_id, value, status)
    values (
      p_game_id,
      left(trim(p_value), 500),
      case when v_status in ('draft', 'secret_submission')
           then 'draft' else 'locked' end::public.secret_status
    )
    returning id into v_secret;
    insert into public.secret_holders (secret_id, player_id) values (v_secret, p_player_id);
  else
    -- Editing an existing secret stays restricted to the open draft window.
    if v_status not in ('draft', 'secret_submission') then raise exception 'secrets_locked'; end if;
    update public.secrets set value = left(trim(p_value), 500), version = version + 1,
      updated_at = now()
    where id = v_secret and status = 'draft';
  end if;
  return v_secret;
end;
$$;
grant execute on function public.submit_player_secret(uuid, uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Vault read models
-- ---------------------------------------------------------------------------

-- The caller's own secret value, on demand (kept out of the page payload so it
-- is only fetched after the deliberate reveal taps).
create or replace function public.my_secret(p_game_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select s.value
  from public.secret_holders sh
  join public.secrets s on s.id = sh.secret_id
  join public.game_players gp on gp.id = sh.player_id
  where gp.game_id = p_game_id and gp.user_id = auth.uid()
  limit 1;
$$;
grant execute on function public.my_secret(uuid) to authenticated;

-- Everything the Vault card needs, assembled server-side so it is not fighting
-- per-table RLS on nested embeds. The caller only ever sees their own rows.
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
        'about_player_name', op.display_name
      ) order by op.display_name, h.position)
      from public.hint_grants hg
      join public.hints h on h.id = hg.hint_id
      join public.secret_holders owner on owner.secret_id = h.secret_id
      join public.game_players ogp on ogp.id = owner.player_id
      join public.profiles op on op.id = ogp.user_id
      where hg.player_id = (select id from me)
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

-- ---------------------------------------------------------------------------
-- 4. Per-target note upsert key
-- ---------------------------------------------------------------------------

-- Free-form notes keep target_player_id NULL; Postgres treats NULLs as distinct
-- so those rows are unaffected. Per-player notes get a stable upsert target.
create unique index if not exists theory_notes_game_player_target_key
  on public.theory_notes (game_id, player_id, target_player_id);
