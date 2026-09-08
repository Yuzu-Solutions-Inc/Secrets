create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create unique index if not exists one_open_accusation_per_player
on public.accusation_buzzes (game_id, accuser_player_id)
where status in ('pending', 'confrontation', 'confirmed');
create unique index if not exists unique_player_hint_grant
on public.hint_grants (hint_id, player_id)
where player_id is not null;

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
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert or update of email on auth.users
for each row execute function public.handle_new_user();

create or replace function public.is_org_member(p_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.organization_members
    where organization_id = p_organization_id and user_id = auth.uid()
  );
$$;

create or replace function public.is_org_admin(p_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.organization_members
    where organization_id = p_organization_id
      and user_id = auth.uid()
      and role = 'admin'
  );
$$;

create or replace function public.is_game_player(p_game_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.game_players
    where game_id = p_game_id and user_id = auth.uid()
  );
$$;

create or replace function public.is_game_admin(p_game_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.games g
    join public.organization_members om on om.organization_id = g.organization_id
    where g.id = p_game_id and om.user_id = auth.uid() and om.role = 'admin'
  );
$$;

create or replace function public.current_game_player_id(p_game_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select id from public.game_players
  where game_id = p_game_id and user_id = auth.uid()
  limit 1;
$$;

grant execute on function public.is_org_member(uuid) to authenticated;
grant execute on function public.is_org_admin(uuid) to authenticated;
grant execute on function public.is_game_player(uuid) to authenticated;
grant execute on function public.is_game_admin(uuid) to authenticated;
grant execute on function public.current_game_player_id(uuid) to authenticated;

create or replace function public.is_house_secret_player(p_house_secret_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_game_player(game_id)
  from public.house_secrets
  where id = p_house_secret_id;
$$;
grant execute on function public.is_house_secret_player(uuid) to authenticated;

create or replace function public.create_organization(
  p_name text,
  p_slug text,
  p_locale text default 'fr'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if auth.uid() is null then raise exception 'unauthorized'; end if;
  insert into public.organizations (name, slug, default_locale, created_by)
  values (left(trim(p_name), 80), p_slug, case when p_locale = 'en' then 'en' else 'fr' end, auth.uid())
  returning id into v_id;
  insert into public.organization_members (organization_id, user_id, role)
  values (v_id, auth.uid(), 'admin');
  return v_id;
end;
$$;
grant execute on function public.create_organization(text, text, text) to authenticated;

create or replace function private.protect_last_admin()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.role = 'admin' and (tg_op = 'DELETE' or new.role <> 'admin') then
    if not exists (
      select 1 from public.organization_members
      where organization_id = old.organization_id
        and role = 'admin'
        and id <> old.id
    ) then
      raise exception 'last_admin';
    end if;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;
create trigger protect_last_admin
before update of role or delete on public.organization_members
for each row execute function private.protect_last_admin();

create or replace function private.create_house_wallet()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.wallets (game_id, kind, balance)
  values (new.id, 'house', 0);
  return new;
end;
$$;
create trigger create_house_wallet
after insert on public.games
for each row execute function private.create_house_wallet();

create or replace function private.create_player_wallet()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_start bigint;
  v_player_wallet uuid;
  v_house_wallet uuid;
  v_transaction uuid;
begin
  select starting_cash into v_start from public.games where id = new.game_id;
  insert into public.wallets (game_id, player_id, kind, balance)
  values (new.game_id, new.id, 'player', v_start)
  returning id into v_player_wallet;
  select id into v_house_wallet from public.wallets
  where game_id = new.game_id and kind = 'house' limit 1;
  insert into public.ledger_transactions (game_id, type, description, idempotency_key)
  values (new.game_id, 'starting_cash', 'Starting cash', 'start:' || new.id::text)
  returning id into v_transaction;
  update public.wallets set balance = balance - v_start where id = v_house_wallet;
  insert into public.ledger_entries (transaction_id, wallet_id, amount)
  values (v_transaction, v_house_wallet, -v_start), (v_transaction, v_player_wallet, v_start);
  return new;
end;
$$;
create trigger create_player_wallet
after insert on public.game_players
for each row execute function private.create_player_wallet();

create or replace function private.create_team_wallet()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_game uuid;
begin
  select game_id into v_game from public.game_rounds where id = new.round_id;
  insert into public.wallets (game_id, team_id, kind, balance)
  values (v_game, new.id, 'team', 0);
  return new;
end;
$$;
create trigger create_team_wallet
after insert on public.teams
for each row execute function private.create_team_wallet();

create or replace function private.queue_display_refresh()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_game uuid;
begin
  v_game := case when tg_table_name = 'games' then new.id else new.game_id end;
  insert into public.display_cues (game_id) values (v_game);
  return new;
end;
$$;
create trigger display_refresh_games
after update on public.games
for each row execute function private.queue_display_refresh();
create trigger display_refresh_rounds
after insert or update on public.game_rounds
for each row execute function private.queue_display_refresh();
create trigger display_refresh_wallets
after update on public.wallets
for each row execute function private.queue_display_refresh();
create trigger display_refresh_events
after insert or update on public.game_events
for each row execute function private.queue_display_refresh();

create or replace function private.prevent_immutable_change()
returns trigger
language plpgsql
as $$
begin
  raise exception 'immutable_record';
end;
$$;
create trigger immutable_ledger_transactions
before update or delete on public.ledger_transactions
for each row execute function private.prevent_immutable_change();
create trigger immutable_ledger_entries
before update or delete on public.ledger_entries
for each row execute function private.prevent_immutable_change();

create or replace function private.protect_locked_secret()
returns trigger
language plpgsql
as $$
begin
  if old.status <> 'draft'
    and coalesce(current_setting('app.secret_override', true), '') <> 'on'
    and (
    new.value is distinct from old.value
    or new.game_id is distinct from old.game_id
  ) then
    raise exception 'secret_locked';
  end if;
  return new;
end;
$$;
create trigger protect_locked_secret
before update on public.secrets
for each row execute function private.protect_locked_secret();

create or replace function private.transfer_money(
  p_game_id uuid,
  p_from_wallet uuid,
  p_to_wallet uuid,
  p_amount bigint,
  p_type text,
  p_description text,
  p_key text,
  p_actor uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_transaction uuid;
  v_balance bigint;
begin
  if p_amount < 0 then raise exception 'invalid_amount'; end if;
  select balance into v_balance from public.wallets
  where id = p_from_wallet and game_id = p_game_id for update;
  if v_balance is null then raise exception 'wallet_not_found'; end if;
  if v_balance < p_amount and (select kind from public.wallets where id = p_from_wallet) <> 'house' then
    raise exception 'insufficient_funds';
  end if;
  perform 1 from public.wallets where id = p_to_wallet and game_id = p_game_id for update;
  insert into public.ledger_transactions
    (game_id, type, description, idempotency_key, actor_user_id)
  values (p_game_id, p_type, p_description, p_key, p_actor)
  returning id into v_transaction;
  update public.wallets set balance = balance - p_amount where id = p_from_wallet;
  update public.wallets set balance = balance + p_amount where id = p_to_wallet;
  insert into public.ledger_entries (transaction_id, wallet_id, amount)
  values (v_transaction, p_from_wallet, -p_amount), (v_transaction, p_to_wallet, p_amount);
  return v_transaction;
end;
$$;

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
  if v_status not in ('draft', 'secret_submission') then raise exception 'secrets_locked'; end if;
  if p_player_id <> public.current_game_player_id(p_game_id)
     and not public.is_game_admin(p_game_id) then
    raise exception 'forbidden';
  end if;
  select sh.secret_id into v_secret
  from public.secret_holders sh join public.secrets s on s.id = sh.secret_id
  where sh.player_id = p_player_id and s.game_id = p_game_id limit 1;
  if v_secret is null then
    insert into public.secrets (game_id, value) values (p_game_id, left(trim(p_value), 500))
    returning id into v_secret;
    insert into public.secret_holders (secret_id, player_id) values (v_secret, p_player_id);
  else
    update public.secrets set value = left(trim(p_value), 500), version = version + 1,
      updated_at = now()
    where id = v_secret and status = 'draft';
  end if;
  return v_secret;
end;
$$;
grant execute on function public.submit_player_secret(uuid, uuid, text) to authenticated;

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
  select balance into v_balance from public.wallets where player_id = v_accuser;
  if v_balance < v_stake then raise exception 'insufficient_funds'; end if;
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

create or replace function public.stage_accusation_buzz(p_buzz_id uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_buzz public.accusation_buzzes%rowtype;
  v_actor uuid;
  v_house_wallet uuid;
  v_accuser_wallet uuid;
begin
  select * into v_buzz from public.accusation_buzzes where id = p_buzz_id for update;
  v_actor := public.current_game_player_id(v_buzz.game_id);
  if p_status = 'confrontation' then
    if not public.is_game_admin(v_buzz.game_id) or v_buzz.status <> 'pending' then raise exception 'invalid_transition'; end if;
  elsif p_status = 'confirmed' then
    if v_actor <> v_buzz.accuser_player_id or v_buzz.status <> 'confrontation' then raise exception 'invalid_transition'; end if;
  elsif p_status = 'retracted' then
    if v_actor <> v_buzz.accuser_player_id or v_buzz.status not in ('pending', 'confrontation') then raise exception 'invalid_transition'; end if;
    select id into v_house_wallet from public.wallets where game_id = v_buzz.game_id and kind = 'house';
    select id into v_accuser_wallet from public.wallets where player_id = v_buzz.accuser_player_id;
    perform private.transfer_money(v_buzz.game_id, v_house_wallet, v_accuser_wallet, v_buzz.stake, 'buzz_refund', 'Retracted accusation stake returned', 'buzzrefund:' || p_buzz_id, auth.uid());
  else
    raise exception 'invalid_transition';
  end if;
  update public.accusation_buzzes
  set status = p_status::public.buzz_status, updated_at = now()
  where id = p_buzz_id;
end;
$$;
grant execute on function public.stage_accusation_buzz(uuid, text) to authenticated;

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
  insert into public.audit_events (organization_id, game_id, actor_user_id, action, resource_type, resource_id, metadata)
  select g.organization_id, v_buzz.game_id, auth.uid(), 'buzz.resolve', 'accusation_buzz', p_buzz_id,
    jsonb_build_object('result', p_result, 'amount', coalesce(v_amount, 0))
  from public.games g where g.id = v_buzz.game_id;
end;
$$;
grant execute on function public.resolve_accusation_buzz(uuid, text) to authenticated;

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

create or replace function public.create_hint_offer(
  p_game_id uuid,
  p_hint_id uuid,
  p_buyer_player_id uuid,
  p_price bigint
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seller uuid := public.current_game_player_id(p_game_id);
  v_id uuid;
begin
  if p_price <= 0 or v_seller is null or v_seller = p_buyer_player_id then raise exception 'invalid_offer'; end if;
  if not exists (select 1 from public.hint_grants where hint_id = p_hint_id and player_id = v_seller) then
    raise exception 'hint_not_owned';
  end if;
  insert into public.hint_offers (game_id, hint_id, seller_player_id, buyer_player_id, price)
  values (p_game_id, p_hint_id, v_seller, p_buyer_player_id, p_price)
  returning id into v_id;
  return v_id;
end;
$$;
grant execute on function public.create_hint_offer(uuid, uuid, uuid, bigint) to authenticated;

create or replace function public.share_hint(
  p_game_id uuid,
  p_hint_id uuid,
  p_recipient_player_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sender uuid := public.current_game_player_id(p_game_id);
begin
  if v_sender is null or v_sender = p_recipient_player_id then raise exception 'invalid_recipient'; end if;
  if not exists (select 1 from public.game_players where id = p_recipient_player_id and game_id = p_game_id) then
    raise exception 'invalid_recipient';
  end if;
  if not exists (select 1 from public.hint_grants where hint_id = p_hint_id and player_id = v_sender) then
    raise exception 'hint_not_owned';
  end if;
  if not exists (select 1 from public.hint_grants where hint_id = p_hint_id and player_id = p_recipient_player_id) then
    insert into public.hint_grants (hint_id, player_id, scope, source, granted_by)
    values (p_hint_id, p_recipient_player_id, 'private', 'player_share', auth.uid());
  end if;
end;
$$;
grant execute on function public.share_hint(uuid, uuid, uuid) to authenticated;

create or replace function public.resolve_hint_offer(p_offer_id uuid, p_accept boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_offer public.hint_offers%rowtype;
  v_actor uuid;
  v_buyer_wallet uuid;
  v_seller_wallet uuid;
begin
  select * into v_offer from public.hint_offers where id = p_offer_id for update;
  v_actor := public.current_game_player_id(v_offer.game_id);
  if v_actor <> v_offer.buyer_player_id then raise exception 'forbidden'; end if;
  if v_offer.status <> 'pending' then raise exception 'already_resolved'; end if;
  if not p_accept then
    update public.hint_offers set status = 'rejected', resolved_at = now() where id = p_offer_id;
    return;
  end if;
  select id into v_buyer_wallet from public.wallets where player_id = v_offer.buyer_player_id;
  select id into v_seller_wallet from public.wallets where player_id = v_offer.seller_player_id;
  perform private.transfer_money(v_offer.game_id, v_buyer_wallet, v_seller_wallet, v_offer.price, 'hint_sale', 'Player hint sale', 'hintoffer:' || p_offer_id, auth.uid());
  insert into public.hint_grants (hint_id, player_id, scope, source, granted_by)
  values (v_offer.hint_id, v_offer.buyer_player_id, 'private', 'player_sale', auth.uid())
  on conflict do nothing;
  update public.hint_offers set status = 'accepted', resolved_at = now() where id = p_offer_id;
end;
$$;
grant execute on function public.resolve_hint_offer(uuid, boolean) to authenticated;

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
    end if;
  elsif p_action = 'pause' and v_current is not null then
    update public.game_rounds set status = 'paused', updated_at = now() where id = v_current;
  elsif p_action = 'resume' and v_current is not null then
    update public.game_rounds set status = 'live', updated_at = now() where id = v_current;
  elsif p_action = 'finale' then
    update public.games set status = 'finale', updated_at = now() where id = p_game_id;
  elsif p_action = 'complete' then
    update public.games set status = 'completed', completed_at = now(), updated_at = now() where id = p_game_id;
  else
    raise exception 'invalid_transition';
  end if;
  insert into public.audit_events (organization_id, game_id, actor_user_id, action, resource_type, resource_id)
  values (v_org, p_game_id, auth.uid(), 'game.' || p_action, 'game', p_game_id);
end;
$$;
grant execute on function public.host_transition(uuid, text) to authenticated;

create or replace function public.set_player_play_status(
  p_game_id uuid,
  p_player_id uuid,
  p_status text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
begin
  if not public.is_game_admin(p_game_id) or p_status not in ('active', 'eliminated') then
    raise exception 'forbidden';
  end if;
  if p_status = 'eliminated' and not exists (
    select 1 from public.games g
    join public.game_rounds r on r.id = g.current_round_id
    where g.id = p_game_id and r.kind = 'elimination' and r.status = 'live'
  ) then raise exception 'elimination_round_required'; end if;
  update public.game_players set play_status = p_status
  where id = p_player_id and game_id = p_game_id;
  select organization_id into v_org from public.games where id = p_game_id;
  insert into public.audit_events (organization_id, game_id, actor_user_id, action, resource_type, resource_id, metadata)
  values (v_org, p_game_id, auth.uid(), 'player.' || p_status, 'game_player', p_player_id, '{}'::jsonb);
end;
$$;
grant execute on function public.set_player_play_status(uuid, uuid, text) to authenticated;

create or replace function public.move_game_round(p_round_id uuid, p_direction text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_round public.game_rounds%rowtype;
  v_other uuid;
  v_target int;
begin
  select * into v_round from public.game_rounds where id = p_round_id for update;
  if not public.is_game_admin(v_round.game_id) then raise exception 'forbidden'; end if;
  v_target := v_round.position + case when p_direction = 'up' then -1 when p_direction = 'down' then 1 else 0 end;
  if v_target < 0 then return; end if;
  select id into v_other from public.game_rounds where game_id = v_round.game_id and position = v_target for update;
  if v_other is null then return; end if;
  update public.game_rounds set position = -1 where id = v_round.id;
  update public.game_rounds set position = v_round.position where id = v_other;
  update public.game_rounds set position = v_target where id = v_round.id;
end;
$$;
grant execute on function public.move_game_round(uuid, text) to authenticated;

create or replace function public.duplicate_game_round(p_round_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_round public.game_rounds%rowtype;
  v_id uuid;
  v_position int;
begin
  select * into v_round from public.game_rounds where id = p_round_id;
  if not public.is_game_admin(v_round.game_id) then raise exception 'forbidden'; end if;
  select coalesce(max(position), -1) + 1 into v_position from public.game_rounds where game_id = v_round.game_id;
  insert into public.game_rounds (game_id, title, kind, position, config)
  values (v_round.game_id, v_round.title || ' copy', v_round.kind, v_position, v_round.config)
  returning id into v_id;
  return v_id;
end;
$$;
grant execute on function public.duplicate_game_round(uuid) to authenticated;

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
  if not exists (select 1 from public.game_players where id = p_player_id and game_id = v_game) then
    raise exception 'invalid_player';
  end if;
  insert into public.secret_holders (secret_id, player_id)
  values (p_secret_id, p_player_id)
  on conflict do nothing;
end;
$$;
grant execute on function public.add_secret_holder(uuid, uuid) to authenticated;

create or replace function public.admin_adjust_wallet(
  p_game_id uuid,
  p_player_id uuid,
  p_amount bigint,
  p_reason text,
  p_idempotency_key text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_player_wallet uuid;
  v_house_wallet uuid;
  v_org uuid;
  v_transaction uuid;
begin
  if not public.is_game_admin(p_game_id) then raise exception 'forbidden'; end if;
  if p_amount = 0 or length(trim(p_reason)) < 3 then raise exception 'invalid_adjustment'; end if;
  select id into v_player_wallet from public.wallets where player_id = p_player_id and game_id = p_game_id;
  select id into v_house_wallet from public.wallets where game_id = p_game_id and kind = 'house';
  if p_amount > 0 then
    v_transaction := private.transfer_money(p_game_id, v_house_wallet, v_player_wallet, p_amount, 'admin_adjustment', p_reason, p_idempotency_key, auth.uid());
  else
    v_transaction := private.transfer_money(p_game_id, v_player_wallet, v_house_wallet, abs(p_amount), 'admin_adjustment', p_reason, p_idempotency_key, auth.uid());
  end if;
  select organization_id into v_org from public.games where id = p_game_id;
  insert into public.audit_events (organization_id, game_id, actor_user_id, action, resource_type, resource_id, metadata)
  values (v_org, p_game_id, auth.uid(), 'wallet.adjust', 'player', p_player_id, jsonb_build_object('amount', p_amount, 'reason', p_reason));
  return v_transaction;
end;
$$;
grant execute on function public.admin_adjust_wallet(uuid, uuid, bigint, text, text) to authenticated;

create or replace function public.reverse_ledger_transaction(p_transaction_id uuid, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_original public.ledger_transactions%rowtype;
  v_new uuid;
  v_entry record;
  v_balance bigint;
begin
  select * into v_original from public.ledger_transactions where id = p_transaction_id;
  if not public.is_game_admin(v_original.game_id) then raise exception 'forbidden'; end if;
  if exists (select 1 from public.ledger_transactions where reversed_transaction_id = p_transaction_id) then
    raise exception 'already_reversed';
  end if;
  for v_entry in select * from public.ledger_entries where transaction_id = p_transaction_id loop
    select balance into v_balance from public.wallets where id = v_entry.wallet_id for update;
    if v_entry.amount > 0
       and v_balance < v_entry.amount
       and (select kind from public.wallets where id = v_entry.wallet_id) <> 'house' then
      raise exception 'insufficient_funds_to_reverse';
    end if;
  end loop;
  insert into public.ledger_transactions
    (game_id, type, description, idempotency_key, actor_user_id, reversed_transaction_id)
  values (
    v_original.game_id, 'reversal', left(trim(p_reason), 200),
    'reverse:' || p_transaction_id, auth.uid(), p_transaction_id
  ) returning id into v_new;
  for v_entry in select * from public.ledger_entries where transaction_id = p_transaction_id loop
    update public.wallets set balance = balance - v_entry.amount where id = v_entry.wallet_id;
    insert into public.ledger_entries (transaction_id, wallet_id, amount)
    values (v_new, v_entry.wallet_id, -v_entry.amount);
  end loop;
  return v_new;
end;
$$;
grant execute on function public.reverse_ledger_transaction(uuid, text) to authenticated;

create or replace function public.fund_team_wallet(p_team_id uuid, p_amount bigint)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_game uuid;
  v_team_wallet uuid;
  v_house_wallet uuid;
begin
  select r.game_id into v_game
  from public.teams t join public.game_rounds r on r.id = t.round_id
  where t.id = p_team_id;
  if not public.is_game_admin(v_game) or p_amount < 0 then raise exception 'forbidden'; end if;
  select id into v_team_wallet from public.wallets where team_id = p_team_id;
  select id into v_house_wallet from public.wallets where game_id = v_game and kind = 'house';
  return private.transfer_money(v_game, v_house_wallet, v_team_wallet, p_amount, 'team_funding', 'Team opening pot', 'teamfund:' || p_team_id, auth.uid());
end;
$$;
grant execute on function public.fund_team_wallet(uuid, bigint) to authenticated;

create or replace function public.resolve_mission(
  p_mission_id uuid,
  p_player_id uuid,
  p_result text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_mission public.missions%rowtype;
  v_player_wallet uuid;
  v_house_wallet uuid;
  v_amount bigint;
begin
  select * into v_mission from public.missions where id = p_mission_id for update;
  if not public.is_game_admin(v_mission.game_id) then raise exception 'forbidden'; end if;
  if p_result not in ('approved', 'failed') then raise exception 'invalid_result'; end if;
  select id into v_player_wallet from public.wallets where player_id = p_player_id and game_id = v_mission.game_id;
  select id into v_house_wallet from public.wallets where game_id = v_mission.game_id and kind = 'house';
  v_amount := case when p_result = 'approved' then v_mission.reward else v_mission.penalty end;
  if p_result = 'approved' and v_amount > 0 then
    perform private.transfer_money(v_mission.game_id, v_house_wallet, v_player_wallet, v_amount, 'mission_reward', v_mission.title, 'mission:' || p_mission_id || ':' || p_player_id, auth.uid());
  elsif p_result = 'failed' and v_amount > 0 then
    v_amount := least(v_amount, (select balance from public.wallets where id = v_player_wallet));
    perform private.transfer_money(v_mission.game_id, v_player_wallet, v_house_wallet, v_amount, 'mission_penalty', v_mission.title, 'mission:' || p_mission_id || ':' || p_player_id, auth.uid());
  end if;
  update public.missions set status = p_result::public.mission_status where id = p_mission_id;
end;
$$;
grant execute on function public.resolve_mission(uuid, uuid, text) to authenticated;

create or replace function public.submit_mission(p_mission_id uuid, p_player_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_game uuid;
begin
  select game_id into v_game from public.missions where id = p_mission_id;
  if p_player_id <> public.current_game_player_id(v_game) then raise exception 'forbidden'; end if;
  if not exists (
    select 1 from public.mission_assignments ma
    where ma.mission_id = p_mission_id and (
      ma.player_id = p_player_id
      or exists (
        select 1 from public.team_members tm
        where tm.team_id = ma.team_id and tm.player_id = p_player_id
      )
    )
  ) then raise exception 'not_assigned'; end if;
  update public.mission_assignments set submitted_at = now()
  where mission_id = p_mission_id and (
    player_id = p_player_id
    or exists (
      select 1 from public.team_members tm
      where tm.team_id = mission_assignments.team_id and tm.player_id = p_player_id
    )
  );
  update public.missions set status = 'submitted' where id = p_mission_id;
end;
$$;
grant execute on function public.submit_mission(uuid, uuid) to authenticated;

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

create or replace function public.invitation_summary(p_token_hash text)
returns table (organization_name text, game_title text, expires_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select o.name, g.title, i.expires_at
  from public.organization_invitations i
  join public.organizations o on o.id = i.organization_id
  left join public.games g on g.id = i.game_id
  where i.token_hash = p_token_hash
    and i.accepted_at is null and i.revoked_at is null and i.expires_at > now()
  limit 1;
$$;
grant execute on function public.invitation_summary(text) to anon, authenticated;

create or replace function public.accept_invitation(p_token_hash text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invite public.organization_invitations%rowtype;
  v_email text;
begin
  if auth.uid() is null then raise exception 'unauthorized'; end if;
  select lower(coalesce(email, '')) into v_email from auth.users where id = auth.uid();
  select * into v_invite from public.organization_invitations
  where token_hash = p_token_hash and accepted_at is null and revoked_at is null and expires_at > now()
  for update;
  if v_invite.id is null then raise exception 'invalid_invitation'; end if;
  if lower(v_invite.email) <> v_email then raise exception 'email_mismatch'; end if;
  if v_invite.game_id is not null and exists (
    select 1 from public.games
    where id = v_invite.game_id
      and status in ('live', 'finale', 'completed', 'archived')
      and coalesce((settings ->> 'allowLateJoin')::boolean, false) = false
  ) then raise exception 'late_join_closed'; end if;
  insert into public.organization_members (organization_id, user_id, role)
  values (v_invite.organization_id, auth.uid(), v_invite.role)
  on conflict (organization_id, user_id) do nothing;
  if v_invite.game_id is not null then
    insert into public.game_players (game_id, user_id)
    values (v_invite.game_id, auth.uid())
    on conflict (game_id, user_id) do nothing;
  end if;
  update public.organization_invitations set accepted_at = now() where id = v_invite.id;
  return v_invite.game_id;
end;
$$;
grant execute on function public.accept_invitation(text) to authenticated;

create or replace function public.public_game_dashboard(p_code text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
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
    )
  )
  from public.games g
  where upper(g.public_code) = upper(p_code)
    and g.status in ('locked', 'live', 'finale', 'completed');
$$;
grant execute on function public.public_game_dashboard(text) to anon, authenticated;

create or replace function public.house_secret_board(p_game_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', hs.id,
    'mode', hs.mode,
    'vault', hs.vault,
    'attempt_cost', hs.attempt_cost,
    'revealed_at', hs.revealed_at,
    'clues', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id, 'chapter', c.chapter, 'text', c.text,
        'asset_path', c.asset_path, 'is_decoy', c.is_decoy
      ) order by c.chapter, c.created_at)
      from public.house_secret_clues c
      where c.house_secret_id = hs.id and c.released_at is not null
    ), '[]'::jsonb)
  )
  from public.house_secrets hs
  where hs.game_id = p_game_id and (
    public.is_game_player(p_game_id) or public.is_game_admin(p_game_id)
  );
$$;
grant execute on function public.house_secret_board(uuid) to authenticated;

-- RLS is mandatory on every exposed table.
alter table public.profiles enable row level security;
alter table public.organizations enable row level security;
alter table public.organization_members enable row level security;
alter table public.organization_invitations enable row level security;
alter table public.games enable row level security;
alter table public.game_players enable row level security;
alter table public.secrets enable row level security;
alter table public.secret_holders enable row level security;
alter table public.hints enable row level security;
alter table public.hint_grants enable row level security;
alter table public.round_templates enable row level security;
alter table public.game_rounds enable row level security;
alter table public.teams enable row level security;
alter table public.team_members enable row level security;
alter table public.wallets enable row level security;
alter table public.ledger_transactions enable row level security;
alter table public.ledger_entries enable row level security;
alter table public.hint_offers enable row level security;
alter table public.accusation_buzzes enable row level security;
alter table public.hint_buzzes enable row level security;
alter table public.missions enable row level security;
alter table public.mission_assignments enable row level security;
alter table public.house_secrets enable row level security;
alter table public.house_secret_clues enable row level security;
alter table public.house_secret_submissions enable row level security;
alter table public.game_events enable row level security;
alter table public.display_cues enable row level security;
alter table public.player_powers enable row level security;
alter table public.ballots enable row level security;
alter table public.theory_notes enable row level security;
alter table public.audit_events enable row level security;

create policy profiles_self_select on public.profiles for select to authenticated
using (id = auth.uid() or exists (
  select 1 from public.organization_members mine
  join public.organization_members theirs on theirs.organization_id = mine.organization_id
  where mine.user_id = auth.uid() and theirs.user_id = profiles.id
));
create policy profiles_self_update on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

create policy organizations_member_select on public.organizations for select to authenticated using (public.is_org_member(id));
create policy organizations_admin_update on public.organizations for update to authenticated using (public.is_org_admin(id)) with check (public.is_org_admin(id));

create policy members_org_select on public.organization_members for select to authenticated using (public.is_org_member(organization_id));
create policy members_admin_manage on public.organization_members for all to authenticated using (public.is_org_admin(organization_id)) with check (public.is_org_admin(organization_id));

create policy invitations_admin_manage on public.organization_invitations for all to authenticated
using (public.is_org_admin(organization_id)) with check (public.is_org_admin(organization_id));

create policy games_participant_select on public.games for select to authenticated
using (public.is_org_admin(organization_id) or public.is_game_player(id));
create policy games_admin_manage on public.games for all to authenticated
using (public.is_org_admin(organization_id)) with check (public.is_org_admin(organization_id));

create policy players_game_select on public.game_players for select to authenticated
using (public.is_game_player(game_id) or public.is_game_admin(game_id));
create policy players_admin_manage on public.game_players for all to authenticated
using (public.is_game_admin(game_id)) with check (public.is_game_admin(game_id));
create policy players_self_update on public.game_players for update to authenticated
using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy secrets_scoped_select on public.secrets for select to authenticated
using (
  public.is_game_admin(game_id)
  or status = 'revealed' and public.is_game_player(game_id)
  or exists (
    select 1 from public.secret_holders sh
    join public.game_players gp on gp.id = sh.player_id
    where sh.secret_id = secrets.id and gp.user_id = auth.uid()
  )
);
create policy secrets_admin_manage on public.secrets for all to authenticated
using (public.is_game_admin(game_id)) with check (public.is_game_admin(game_id));

create policy holders_scoped_select on public.secret_holders for select to authenticated
using (
  exists (select 1 from public.secrets s where s.id = secret_id and public.is_game_admin(s.game_id))
  or exists (select 1 from public.game_players gp where gp.id = player_id and gp.user_id = auth.uid())
);

create policy hints_scoped_select on public.hints for select to authenticated
using (
  exists (select 1 from public.secrets s where s.id = secret_id and public.is_game_admin(s.game_id))
  or exists (
    select 1 from public.hint_grants hg
    left join public.game_players gp on gp.id = hg.player_id
    left join public.team_members tm on tm.team_id = hg.team_id
    left join public.game_players tgp on tgp.id = tm.player_id
    where hg.hint_id = hints.id and (
      gp.user_id = auth.uid()
      or tgp.user_id = auth.uid()
      or hg.scope = 'public' and exists (
        select 1 from public.secrets s where s.id = hints.secret_id and public.is_game_player(s.game_id)
      )
    )
  )
);
create policy hints_admin_manage on public.hints for all to authenticated
using (exists (select 1 from public.secrets s where s.id = secret_id and public.is_game_admin(s.game_id)))
with check (exists (select 1 from public.secrets s where s.id = secret_id and public.is_game_admin(s.game_id)));

create policy grants_scoped_select on public.hint_grants for select to authenticated
using (
  exists (select 1 from public.game_players gp where gp.id = player_id and gp.user_id = auth.uid())
  or exists (
    select 1 from public.team_members tm join public.game_players gp on gp.id = tm.player_id
    where tm.team_id = hint_grants.team_id and gp.user_id = auth.uid()
  )
  or scope = 'public' and exists (
    select 1 from public.hints h
    join public.secrets s on s.id = h.secret_id
    where h.id = hint_id and public.is_game_player(s.game_id)
  )
  or exists (
    select 1 from public.hints h join public.secrets s on s.id = h.secret_id
    where h.id = hint_id and public.is_game_admin(s.game_id)
  )
);

create policy rounds_game_select on public.game_rounds for select to authenticated
using (public.is_game_player(game_id) or public.is_game_admin(game_id));
create policy rounds_admin_manage on public.game_rounds for all to authenticated
using (public.is_game_admin(game_id)) with check (public.is_game_admin(game_id));

create policy templates_org_select on public.round_templates for select to authenticated
using (is_system or public.is_org_member(organization_id));
create policy templates_admin_manage on public.round_templates for all to authenticated
using (public.is_org_admin(organization_id)) with check (public.is_org_admin(organization_id));

create policy teams_game_select on public.teams for select to authenticated
using (exists (select 1 from public.game_rounds r where r.id = round_id and (public.is_game_player(r.game_id) or public.is_game_admin(r.game_id))));
create policy teams_admin_manage on public.teams for all to authenticated
using (exists (select 1 from public.game_rounds r where r.id = round_id and public.is_game_admin(r.game_id)))
with check (exists (select 1 from public.game_rounds r where r.id = round_id and public.is_game_admin(r.game_id)));

create policy team_members_scoped_select on public.team_members for select to authenticated
using (
  exists (select 1 from public.game_players gp where gp.id = player_id and gp.user_id = auth.uid())
  or exists (
    select 1 from public.teams t join public.game_rounds r on r.id = t.round_id
    where t.id = team_id and public.is_game_admin(r.game_id)
  )
);
create policy team_members_self_update on public.team_members for update to authenticated
using (exists (select 1 from public.game_players gp where gp.id = player_id and gp.user_id = auth.uid()))
with check (exists (select 1 from public.game_players gp where gp.id = player_id and gp.user_id = auth.uid()));

create policy wallets_scoped_select on public.wallets for select to authenticated
using (
  public.is_game_admin(game_id)
  or exists (select 1 from public.game_players gp where gp.id = player_id and gp.user_id = auth.uid())
  or exists (
    select 1 from public.team_members tm join public.game_players gp on gp.id = tm.player_id
    where tm.team_id = wallets.team_id and gp.user_id = auth.uid()
  )
);

create policy ledger_transactions_admin_select on public.ledger_transactions for select to authenticated
using (public.is_game_admin(game_id));
create policy ledger_entries_scoped_select on public.ledger_entries for select to authenticated
using (exists (
  select 1 from public.wallets w
  where w.id = wallet_id and (
    public.is_game_admin(w.game_id)
    or exists (select 1 from public.game_players gp where gp.id = w.player_id and gp.user_id = auth.uid())
  )
));

create policy accusation_parties_select on public.accusation_buzzes for select to authenticated
using (
  public.is_game_admin(game_id)
  or exists (select 1 from public.game_players gp where gp.id in (accuser_player_id, target_player_id) and gp.user_id = auth.uid())
);
create policy hint_buzz_buyer_select on public.hint_buzzes for select to authenticated
using (
  public.is_game_admin(game_id)
  or exists (select 1 from public.game_players gp where gp.id = buyer_player_id and gp.user_id = auth.uid())
);
create policy hint_offers_parties_select on public.hint_offers for select to authenticated
using (
  public.is_game_admin(game_id)
  or exists (select 1 from public.game_players gp where gp.id in (seller_player_id, buyer_player_id) and gp.user_id = auth.uid())
);

create policy missions_scoped_select on public.missions for select to authenticated
using (
  public.is_game_admin(game_id)
  or visibility = 'public' and public.is_game_player(game_id)
  or exists (
    select 1 from public.mission_assignments ma
    left join public.game_players gp on gp.id = ma.player_id
    left join public.team_members tm on tm.team_id = ma.team_id
    left join public.game_players tgp on tgp.id = tm.player_id
    where ma.mission_id = missions.id and (gp.user_id = auth.uid() or tgp.user_id = auth.uid())
  )
);
create policy missions_admin_manage on public.missions for all to authenticated
using (public.is_game_admin(game_id)) with check (public.is_game_admin(game_id));
create policy mission_assignments_scoped_select on public.mission_assignments for select to authenticated
using (
  exists (select 1 from public.game_players gp where gp.id = player_id and gp.user_id = auth.uid())
  or exists (
    select 1 from public.team_members tm
    join public.game_players gp on gp.id = tm.player_id
    where tm.team_id = mission_assignments.team_id and gp.user_id = auth.uid()
  )
  or exists (
    select 1 from public.missions m where m.id = mission_id and public.is_game_admin(m.game_id)
  )
);
create policy mission_assignments_admin_manage on public.mission_assignments for all to authenticated
using (exists (select 1 from public.missions m where m.id = mission_id and public.is_game_admin(m.game_id)))
with check (exists (select 1 from public.missions m where m.id = mission_id and public.is_game_admin(m.game_id)));

create policy house_secret_admin_select on public.house_secrets for select to authenticated
using (public.is_game_admin(game_id));
create policy house_secret_admin_manage on public.house_secrets for all to authenticated
using (public.is_game_admin(game_id)) with check (public.is_game_admin(game_id));
create policy house_clues_released_select on public.house_secret_clues for select to authenticated
using (
  released_at is not null and public.is_house_secret_player(house_secret_id)
  or exists (select 1 from public.house_secrets hs where hs.id = house_secret_id and public.is_game_admin(hs.game_id))
);
create policy house_clues_admin_manage on public.house_secret_clues for all to authenticated
using (exists (select 1 from public.house_secrets hs where hs.id = house_secret_id and public.is_game_admin(hs.game_id)))
with check (exists (select 1 from public.house_secrets hs where hs.id = house_secret_id and public.is_game_admin(hs.game_id)));
create policy house_submissions_owner_select on public.house_secret_submissions for select to authenticated
using (
  exists (select 1 from public.game_players gp where gp.id = player_id and gp.user_id = auth.uid())
  or exists (
    select 1 from public.house_secrets hs where hs.id = house_secret_id and public.is_game_admin(hs.game_id)
  )
);
create policy house_submissions_owner_insert on public.house_secret_submissions for insert to authenticated
with check (
  exists (select 1 from public.game_players gp where gp.id = player_id and gp.user_id = auth.uid())
  and public.is_house_secret_player(house_secret_id)
);

create policy events_game_select on public.game_events for select to authenticated
using (public.is_game_player(game_id) or public.is_game_admin(game_id));
create policy events_admin_manage on public.game_events for all to authenticated
using (public.is_game_admin(game_id)) with check (public.is_game_admin(game_id));

create policy display_cues_public_select on public.display_cues for select to anon, authenticated
using (exists (
  select 1 from public.games g
  where g.id = game_id and g.status in ('locked', 'live', 'finale', 'completed')
));

create policy powers_owner_select on public.player_powers for select to authenticated
using (exists (
  select 1 from public.game_players gp where gp.id = player_id
  and (gp.user_id = auth.uid() or public.is_game_admin(gp.game_id))
));
create policy powers_admin_manage on public.player_powers for all to authenticated
using (exists (select 1 from public.game_players gp where gp.id = player_id and public.is_game_admin(gp.game_id)))
with check (exists (select 1 from public.game_players gp where gp.id = player_id and public.is_game_admin(gp.game_id)));

create policy ballots_private on public.ballots for select to authenticated
using (
  exists (select 1 from public.game_players gp where gp.id = voter_player_id and gp.user_id = auth.uid())
  or exists (
    select 1 from public.game_rounds r where r.id = round_id and public.is_game_admin(r.game_id)
  )
);
create policy ballots_self_insert on public.ballots for insert to authenticated
with check (exists (select 1 from public.game_players gp where gp.id = voter_player_id and gp.user_id = auth.uid()));

create policy notes_owner on public.theory_notes for all to authenticated
using (exists (select 1 from public.game_players gp where gp.id = player_id and gp.user_id = auth.uid()))
with check (exists (select 1 from public.game_players gp where gp.id = player_id and gp.user_id = auth.uid()));

create policy audit_admin_select on public.audit_events for select to authenticated
using (public.is_org_admin(organization_id));

-- Private media. Secret hint bytes are served only after application authorization.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'game-assets',
  'game-assets',
  false,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy avatar_insert on storage.objects for insert to authenticated
with check (bucket_id = 'game-assets' and (storage.foldername(name))[1] = 'avatars' and (storage.foldername(name))[2] = auth.uid()::text);
create policy avatar_select on storage.objects for select to authenticated
using (bucket_id = 'game-assets' and (storage.foldername(name))[1] = 'avatars');
create policy avatar_update on storage.objects for update to authenticated
using (bucket_id = 'game-assets' and (storage.foldername(name))[1] = 'avatars' and (storage.foldername(name))[2] = auth.uid()::text)
with check (bucket_id = 'game-assets' and (storage.foldername(name))[1] = 'avatars' and (storage.foldername(name))[2] = auth.uid()::text);

-- Realtime publishes only safe state-change tables. Sensitive payloads are fetched through RLS.
alter publication supabase_realtime add table public.game_rounds;
alter publication supabase_realtime add table public.game_events;
alter publication supabase_realtime add table public.wallets;
alter publication supabase_realtime add table public.display_cues;
