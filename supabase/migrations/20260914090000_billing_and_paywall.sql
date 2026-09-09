-- Billing + Free/Pro paywall.
--
-- ┌─────────────────────────────────────────────────────────────────────────┐
-- │ HOLD — do NOT `supabase db push` this to the live project yet.          │
-- │ Billing is not wired up (no Stripe keys, app on a feature branch). This │
-- │ migration is committed so the work is versioned; apply it only when     │
-- │ billing goes live (see docs/BILLING_SETUP.md).                          │
-- │                                                                         │
-- │ It is written to be non-blocking even if applied early: every tier      │
-- │ guard trips only on settings->>'tier' = 'free', and the backfill below  │
-- │ grandfathers every existing game as Pro with proGameSource already set  │
-- │ so consume_pro_game_start() is a no-op for anything created before it.  │
-- └─────────────────────────────────────────────────────────────────────────┘
--
-- Adds host-level entitlements (Free by default, Pro via one-time Stripe
-- purchases), a create_game() RPC that stamps and clamps per-tier settings,
-- credit consumption/refund wired into host_transition(), a player-cap trigger,
-- tier guards on the Pro-only host RPCs, and a review queue for possible account
-- sharing on Pro-Unlimited.
--
-- Free/Pro split is documented in docs/MONETIZATION.md.

-- ────────────────────────────────────────────────────────────────────────────
-- Tables
-- ────────────────────────────────────────────────────────────────────────────

create table public.entitlements (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  plan text not null default 'free' check (plan in ('free', 'pro_pack', 'pro_unlimited')),
  pro_credits integer not null default 0 check (pro_credits >= 0),
  pro_expires_at timestamptz,
  free_pro_game_used boolean not null default false,
  pro_games_started integer not null default 0,
  stripe_customer_id text unique,
  updated_at timestamptz not null default now()
);

create table public.purchases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles (id) on delete set null,
  sku text not null,
  stripe_checkout_session_id text unique,
  stripe_payment_intent_id text,
  amount_total integer,
  currency text,
  credits_granted integer not null default 0,
  expires_at timestamptz,
  created_at timestamptz not null default now()
);

-- Stripe webhook de-duplication. Service role only.
create table public.billing_events (
  id text primary key,
  type text,
  payload jsonb not null default '{}'::jsonb,
  received_at timestamptz not null default now()
);

-- Rows land here when a Pro-Unlimited host starts their 10th / 20th game so the
-- account owner can eyeball it for sharing. Read via Studio / service role.
create table public.billing_review_queue (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles (id) on delete cascade,
  game_id uuid references public.games (id) on delete set null,
  milestone integer not null,
  pro_games_started integer not null,
  notified_at timestamptz,
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.entitlements enable row level security;
alter table public.purchases enable row level security;
alter table public.billing_events enable row level security;
alter table public.billing_review_queue enable row level security;

-- Owners may read their own entitlement / purchase history. All writes go
-- through SECURITY DEFINER functions or the service role.
create policy entitlements_self_select on public.entitlements for select to authenticated
using (user_id = auth.uid());
create policy purchases_self_select on public.purchases for select to authenticated
using (user_id = auth.uid());

revoke all on public.billing_events from anon, authenticated;
revoke all on public.billing_review_queue from anon, authenticated;
grant select on public.entitlements to authenticated;
grant select on public.purchases to authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- Entitlement resolution
-- ────────────────────────────────────────────────────────────────────────────

-- The caller's entitlement row, synthesising a default Free row if none exists.
create or replace function public.current_entitlement()
returns public.entitlements
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v public.entitlements;
begin
  select * into v from public.entitlements where user_id = auth.uid();
  if not found then
    v.user_id := auth.uid();
    v.plan := 'free';
    v.pro_credits := 0;
    v.free_pro_game_used := false;
    v.pro_games_started := 0;
    v.updated_at := now();
  end if;
  return v;
end;
$$;
grant execute on function public.current_entitlement() to authenticated;

-- 'free' whenever Pro access has lapsed (or was never bought).
create or replace function public.effective_plan(p_user uuid default auth.uid())
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when e.pro_expires_at is null or e.pro_expires_at <= now() then 'free'
    else e.plan
  end
  from public.entitlements e
  where e.user_id = p_user;
$$;
grant execute on function public.effective_plan(uuid) to authenticated;

-- Which bucket would pay for the next Pro game: 'free_trial' | 'unlimited' |
-- 'pack' | null (cannot start one).
create or replace function private.pro_game_source(p_user uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  e public.entitlements;
begin
  select * into e from public.entitlements where user_id = p_user;
  if not found or e.free_pro_game_used is not true then
    return 'free_trial';
  end if;
  if e.pro_expires_at is not null and e.pro_expires_at > now() then
    if e.plan = 'pro_unlimited' then
      return 'unlimited';
    elsif e.plan = 'pro_pack' and e.pro_credits > 0 then
      return 'pack';
    end if;
  end if;
  return null;
end;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- Game creation with per-tier clamped settings
-- ────────────────────────────────────────────────────────────────────────────

create or replace function public.create_game(
  p_org uuid,
  p_title text,
  p_format text,
  p_starting_cash bigint,
  p_locale text,
  p_code text,
  p_requested_tier text,
  p_features jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_tier text;
  v_format text;
  v_settings jsonb;
begin
  if not public.is_org_admin(p_org) then raise exception 'forbidden'; end if;

  v_tier := case when p_requested_tier = 'pro' then 'pro' else 'free' end;
  if v_tier = 'pro' and private.pro_game_source(auth.uid()) is null then
    raise exception 'pro_entitlement_required';
  end if;

  if v_tier = 'pro' then
    v_format := case when p_format in ('quick', 'weekend', 'custom') then p_format else 'quick' end;
    v_settings := jsonb_build_object(
      'tier', 'pro',
      'maxPlayers', 50,
      'maxMissions', null,
      'features', jsonb_build_object(
        'sharedSecrets', coalesce((p_features ->> 'sharedSecrets')::boolean, false),
        'secretReplacement', coalesce((p_features ->> 'secretReplacement')::boolean, false),
        'imageHints', coalesce((p_features ->> 'imageHints')::boolean, false),
        'teamMissions', coalesce((p_features ->> 'teamMissions')::boolean, false),
        'publicMissions', coalesce((p_features ->> 'publicMissions')::boolean, false),
        'advancedRounds', coalesce((p_features ->> 'advancedRounds')::boolean, false),
        'customSchedule', v_format <> 'quick'
      )
    );
  else
    v_format := 'quick';
    v_settings := jsonb_build_object(
      'tier', 'free',
      'maxPlayers', 5,
      'maxMissions', 2,
      'features', jsonb_build_object(
        'sharedSecrets', false,
        'secretReplacement', false,
        'imageHints', false,
        'teamMissions', false,
        'publicMissions', false,
        'advancedRounds', false,
        'customSchedule', false
      )
    );
  end if;

  insert into public.games (organization_id, title, format, starting_cash, public_code, created_by, settings)
  values (p_org, left(trim(p_title), 100), v_format, greatest(p_starting_cash, 0), p_code, auth.uid(), v_settings)
  returning id into v_id;

  insert into public.game_players (game_id, user_id) values (v_id, auth.uid());

  return v_id;
end;
$$;
grant execute on function public.create_game(uuid, text, text, bigint, text, text, text, jsonb) to authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- Credit consumption / refund
-- ────────────────────────────────────────────────────────────────────────────

-- Called when round 1 goes live. Idempotent: no-op once settings.proGameSource
-- is set. Raises pro_entitlement_required if the host can no longer cover it.
create or replace function private.consume_pro_game_start(p_game_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_host uuid;
  v_settings jsonb;
  v_source text;
  v_count integer;
begin
  select created_by, settings into v_host, v_settings from public.games where id = p_game_id for update;
  if v_settings ->> 'tier' is distinct from 'pro' then return null; end if;
  if v_settings ? 'proGameSource' then return null; end if;

  insert into public.entitlements (user_id) values (v_host) on conflict (user_id) do nothing;
  perform 1 from public.entitlements where user_id = v_host for update;

  v_source := private.pro_game_source(v_host);
  if v_source is null then raise exception 'pro_entitlement_required'; end if;

  if v_source = 'free_trial' then
    update public.entitlements set free_pro_game_used = true, pro_games_started = pro_games_started + 1, updated_at = now()
    where user_id = v_host
    returning pro_games_started into v_count;
  elsif v_source = 'pack' then
    update public.entitlements set pro_credits = pro_credits - 1, pro_games_started = pro_games_started + 1, updated_at = now()
    where user_id = v_host
    returning pro_games_started into v_count;
    v_settings := jsonb_set(v_settings, '{creditConsumed}', 'true'::jsonb);
  else
    update public.entitlements set pro_games_started = pro_games_started + 1, updated_at = now()
    where user_id = v_host
    returning pro_games_started into v_count;
  end if;

  update public.games
  set settings = jsonb_set(v_settings, '{proGameSource}', to_jsonb(v_source))
  where id = p_game_id;

  if v_count in (10, 20) then
    insert into public.billing_review_queue (user_id, game_id, milestone, pro_games_started)
    values (v_host, p_game_id, v_count, v_count);
  end if;

  return v_count;
end;
$$;

-- Called on game completion. Refunds a pack credit for a Pro game that never
-- ran a single round.
create or replace function private.refund_pro_game(p_game_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_host uuid;
  v_settings jsonb;
begin
  select created_by, settings into v_host, v_settings from public.games where id = p_game_id for update;
  if coalesce((v_settings ->> 'creditConsumed')::boolean, false) is not true then return; end if;
  if exists (select 1 from public.game_rounds where game_id = p_game_id and status = 'completed') then return; end if;

  update public.entitlements
  set pro_credits = pro_credits + 1,
      pro_games_started = greatest(pro_games_started - 1, 0),
      updated_at = now()
  where user_id = v_host;

  update public.games
  set settings = jsonb_set(jsonb_set(v_settings, '{creditConsumed}', 'false'::jsonb), '{creditRefunded}', 'true'::jsonb)
  where id = p_game_id;

  delete from public.billing_review_queue where game_id = p_game_id and resolved_at is null;
end;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- Stripe purchase application (service role, from the webhook)
-- ────────────────────────────────────────────────────────────────────────────

create or replace function public.apply_purchase(
  p_user uuid,
  p_sku text,
  p_session text,
  p_payment_intent text,
  p_amount integer,
  p_currency text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_credits integer := 0;
  v_expires timestamptz;
begin
  -- Idempotent on the checkout session.
  if p_session is not null and exists (select 1 from public.purchases where stripe_checkout_session_id = p_session) then
    return;
  end if;

  insert into public.entitlements (user_id) values (p_user) on conflict (user_id) do nothing;
  perform 1 from public.entitlements where user_id = p_user for update;

  if p_sku = 'pro_pack_3' then
    v_credits := 3;
    update public.entitlements set
      pro_credits = pro_credits + 3,
      plan = case when plan = 'pro_unlimited' and pro_expires_at > now() then 'pro_unlimited' else 'pro_pack' end,
      pro_expires_at = greatest(coalesce(pro_expires_at, now()), now()) + interval '1 year',
      updated_at = now()
    where user_id = p_user
    returning pro_expires_at into v_expires;
  elsif p_sku = 'pro_unlimited' then
    update public.entitlements set
      plan = 'pro_unlimited',
      pro_expires_at = greatest(coalesce(pro_expires_at, now()), now()) + interval '1 year',
      updated_at = now()
    where user_id = p_user
    returning pro_expires_at into v_expires;
  else
    raise exception 'unknown_sku';
  end if;

  insert into public.purchases (
    user_id, sku, stripe_checkout_session_id, stripe_payment_intent_id,
    amount_total, currency, credits_granted, expires_at
  )
  values (p_user, p_sku, p_session, p_payment_intent, p_amount, p_currency, v_credits, v_expires);
end;
$$;
revoke all on function public.apply_purchase(uuid, text, text, text, integer, text) from public, anon, authenticated;
grant execute on function public.apply_purchase(uuid, text, text, text, integer, text) to service_role;

-- Lets the checkout action persist the Stripe customer id once, without the
-- service role.
create or replace function public.set_stripe_customer_id(p_customer_id text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.entitlements (user_id, stripe_customer_id)
  values (auth.uid(), p_customer_id)
  on conflict (user_id) do update
    set stripe_customer_id = coalesce(entitlements.stripe_customer_id, excluded.stripe_customer_id),
        updated_at = now();
end;
$$;
grant execute on function public.set_stripe_customer_id(text) to authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- Player cap trigger (guards the accept_invitation SECURITY DEFINER path)
-- ────────────────────────────────────────────────────────────────────────────

create or replace function private.enforce_player_cap()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cap integer;
begin
  select coalesce((settings ->> 'maxPlayers')::int, 50) into v_cap
  from public.games where id = new.game_id;
  if (select count(*) from public.game_players where game_id = new.game_id) >= coalesce(v_cap, 50) then
    raise exception 'player_cap_reached';
  end if;
  return new;
end;
$$;

drop trigger if exists enforce_player_cap on public.game_players;
create trigger enforce_player_cap
before insert on public.game_players
for each row execute function private.enforce_player_cap();

-- ────────────────────────────────────────────────────────────────────────────
-- Tier guards on existing functions
-- ────────────────────────────────────────────────────────────────────────────

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
begin
  if not public.is_game_admin(p_game_id) then raise exception 'forbidden'; end if;
  select current_round_id, organization_id into v_current, v_org from public.games where id = p_game_id for update;
  if p_action = 'lock_secrets' then
    update public.secrets set status = 'locked', locked_at = now(), updated_at = now()
    where game_id = p_game_id and status = 'draft';
    update public.games set status = 'locked', updated_at = now() where id = p_game_id;
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
        updated_at = now()
      where id = v_next;
      update public.games set status = 'live', current_round_id = v_next, updated_at = now() where id = p_game_id;
      -- Round 1 going live: charge the Pro game against the host's entitlement.
      if v_current is null then
        perform private.consume_pro_game_start(p_game_id);
      end if;
    end if;
  elsif p_action = 'pause' and v_current is not null then
    update public.game_rounds set status = 'paused', updated_at = now() where id = v_current;
  elsif p_action = 'resume' and v_current is not null then
    update public.game_rounds set status = 'live', updated_at = now() where id = v_current;
  elsif p_action = 'finale' then
    update public.games set status = 'finale', updated_at = now() where id = p_game_id;
  elsif p_action = 'complete' then
    update public.games set status = 'completed', completed_at = now(), updated_at = now() where id = p_game_id;
    perform private.refund_pro_game(p_game_id);
  else
    raise exception 'invalid_transition';
  end if;
  insert into public.audit_events (organization_id, game_id, actor_user_id, action, resource_type, resource_id)
  values (v_org, p_game_id, auth.uid(), 'game.' || p_action, 'game', p_game_id);
end;
$$;
grant execute on function public.host_transition(uuid, text) to authenticated;

create or replace function public.admin_replace_secret(
  p_secret_id uuid,
  p_value text,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_game uuid;
  v_org uuid;
begin
  select game_id into v_game from public.secrets where id = p_secret_id for update;
  if not public.is_game_admin(v_game) then raise exception 'forbidden'; end if;
  if (select settings ->> 'tier' from public.games where id = v_game) = 'free' then
    raise exception 'pro_feature_secret_replacement';
  end if;
  if length(trim(p_reason)) < 3 then raise exception 'reason_required'; end if;
  -- The lock trigger permits this transaction-local, audited override only.
  perform set_config('app.secret_override', 'on', true);
  update public.secrets set value = left(trim(p_value), 500), version = version + 1,
    replaced_by = auth.uid(), replacement_reason = left(trim(p_reason), 300),
    updated_at = now()
  where id = p_secret_id;
  select organization_id into v_org from public.games where id = v_game;
  insert into public.audit_events (organization_id, game_id, actor_user_id, action, resource_type, resource_id, metadata)
  values (v_org, v_game, auth.uid(), 'secret.replace', 'secret', p_secret_id, jsonb_build_object('reason', p_reason));
end;
$$;
grant execute on function public.admin_replace_secret(uuid, text, text) to authenticated;

create or replace function public.add_secret_holder(p_secret_id uuid, p_player_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_game uuid;
begin
  select game_id into v_game from public.secrets where id = p_secret_id;
  if not public.is_game_admin(v_game) then raise exception 'forbidden'; end if;
  if (select settings ->> 'tier' from public.games where id = v_game) = 'free' then
    raise exception 'pro_feature_shared_secrets';
  end if;
  if not exists (select 1 from public.game_players where id = p_player_id and game_id = v_game) then
    raise exception 'invalid_player';
  end if;
  insert into public.secret_holders (secret_id, player_id)
  values (p_secret_id, p_player_id)
  on conflict do nothing;
end;
$$;
grant execute on function public.add_secret_holder(uuid, uuid) to authenticated;

create or replace function public.settle_team_dilemma(p_team_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_game uuid;
  v_team_wallet uuid;
  v_pot bigint;
  v_sharers uuid[];
  v_stealers uuid[];
  v_player uuid;
  v_amount bigint;
  v_stealer_pot bigint;
  v_results jsonb := '[]'::jsonb;
begin
  select r.game_id into v_game
  from public.teams t join public.game_rounds r on r.id = t.round_id
  where t.id = p_team_id;
  if not public.is_game_admin(v_game) then raise exception 'forbidden'; end if;
  if (select settings ->> 'tier' from public.games where id = v_game) = 'free' then
    raise exception 'pro_feature_team_dilemma';
  end if;
  if exists (select 1 from public.team_members where team_id = p_team_id and dilemma_choice is null) then
    raise exception 'choices_incomplete';
  end if;
  select id, balance into v_team_wallet from public.wallets where team_id = p_team_id for update;
  v_pot := coalesce(v_pot, 0);
  select array_agg(player_id order by player_id) filter (where dilemma_choice = 'share'),
         array_agg(player_id order by player_id) filter (where dilemma_choice = 'steal')
    into v_sharers, v_stealers
  from public.team_members where team_id = p_team_id;
  v_sharers := coalesce(v_sharers, array[]::uuid[]);
  v_stealers := coalesce(v_stealers, array[]::uuid[]);
  if cardinality(v_stealers) = 0 then
    foreach v_player in array v_sharers loop
      v_amount := v_pot / cardinality(v_sharers);
      perform private.transfer_money(v_game, v_team_wallet, (select id from public.wallets where player_id = v_player), v_amount, 'dilemma_share', 'All shared', 'dilemma:' || p_team_id || ':' || v_player, auth.uid());
      v_results := v_results || jsonb_build_object('playerId', v_player, 'amount', v_amount);
    end loop;
  elsif cardinality(v_sharers) = 0 then
    foreach v_player in array v_stealers loop
      v_amount := floor((v_pot * 0.5) / cardinality(v_stealers));
      perform private.transfer_money(v_game, v_team_wallet, (select id from public.wallets where player_id = v_player), v_amount, 'dilemma_all_steal', 'Everyone stole', 'dilemma:' || p_team_id || ':' || v_player, auth.uid());
      v_results := v_results || jsonb_build_object('playerId', v_player, 'amount', v_amount);
    end loop;
  else
    v_stealer_pot := floor(v_pot * case when cardinality(v_stealers) = 1 then 0.6 else 0.3 end);
    foreach v_player in array v_stealers loop
      v_amount := v_stealer_pot / cardinality(v_stealers);
      perform private.transfer_money(v_game, v_team_wallet, (select id from public.wallets where player_id = v_player), v_amount, 'dilemma_steal', 'Dilemma steal', 'dilemma:' || p_team_id || ':' || v_player, auth.uid());
      v_results := v_results || jsonb_build_object('playerId', v_player, 'amount', v_amount);
    end loop;
    foreach v_player in array v_sharers loop
      v_amount := (v_pot - v_stealer_pot) / cardinality(v_sharers);
      perform private.transfer_money(v_game, v_team_wallet, (select id from public.wallets where player_id = v_player), v_amount, 'dilemma_share', 'Dilemma share', 'dilemma:' || p_team_id || ':' || v_player, auth.uid());
      v_results := v_results || jsonb_build_object('playerId', v_player, 'amount', v_amount);
    end loop;
  end if;
  return v_results;
end;
$$;
grant execute on function public.settle_team_dilemma(uuid) to authenticated;

-- New users get a Free entitlement row alongside their profile.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, display_name, preferred_locale)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data ->> 'display_name', split_part(coalesce(new.email, 'Player'), '@', 1)),
    case when new.raw_user_meta_data ->> 'preferred_locale' = 'en' then 'en' else 'fr' end
  )
  on conflict (id) do update set email = excluded.email;
  insert into public.entitlements (user_id) values (new.id) on conflict (user_id) do nothing;
  return new;
end;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- Backfill
-- ────────────────────────────────────────────────────────────────────────────

insert into public.entitlements (user_id)
select id from public.profiles
on conflict (user_id) do nothing;

-- Grandfather every pre-existing game as Pro so games in flight keep all their
-- features and player headroom. proGameSource is pre-set so
-- consume_pro_game_start() never charges a host for a game that predates billing.
update public.games
set settings = settings || jsonb_build_object(
  'tier', 'pro',
  'maxPlayers', 50,
  'maxMissions', null,
  'proGameSource', 'grandfathered',
  'features', jsonb_build_object(
    'sharedSecrets', true,
    'secretReplacement', true,
    'imageHints', true,
    'teamMissions', true,
    'publicMissions', true,
    'advancedRounds', true,
    'customSchedule', true
  )
)
where not (settings ? 'tier');
