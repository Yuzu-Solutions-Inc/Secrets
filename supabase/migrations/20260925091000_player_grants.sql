-- player_grants: per-player perks handed out automatically when a player
-- Accepts a broadcast dilemma (see 20260925092000). Three kinds:
--   free_hint      - waives the price of the next hint buzz (optionally only
--                    about a specific target player)
--   free_buzz      - the next accusation buzz needs no stake and risks nothing
--   buzz_immunity  - this player cannot be the target of an accusation buzz
--                    until expires_at
-- Grants are written only by security-definer RPCs and consumed in place.

create table if not exists public.player_grants (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games(id) on delete cascade,
  player_id uuid not null references public.game_players(id) on delete cascade,
  kind text not null check (kind in ('free_hint', 'free_buzz', 'buzz_immunity')),
  uses_remaining int not null default 1,
  target_player_id uuid references public.game_players(id) on delete set null,
  expires_at timestamptz,
  source text,
  created_at timestamptz not null default now()
);

create index if not exists player_grants_by_player on public.player_grants (player_id, kind);
create unique index if not exists player_grants_source_uniq
  on public.player_grants (source) where source is not null;

alter table public.player_grants enable row level security;

drop policy if exists player_grants_self_select on public.player_grants;
create policy player_grants_self_select on public.player_grants for select to authenticated
using (
  exists (select 1 from public.game_players gp where gp.id = player_id and gp.user_id = auth.uid())
  or public.is_game_admin(game_id)
);
-- No insert/update/delete policy: writes go through security-definer RPCs only.
grant select on public.player_grants to authenticated;

drop trigger if exists display_refresh_player_grants on public.player_grants;
create trigger display_refresh_player_grants
after insert or update on public.player_grants
for each row execute function private.queue_display_refresh();

-- ---------------------------------------------------------------------------
-- buy_next_hint: a usable free_hint grant waives the price.
-- ---------------------------------------------------------------------------
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
  v_grant uuid;
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

  select id into v_grant from public.player_grants
   where player_id = v_buyer and kind = 'free_hint' and uses_remaining > 0
     and (target_player_id is null or target_player_id = p_target_player_id)
   order by created_at limit 1;
  if v_grant is not null then
    update public.player_grants set uses_remaining = uses_remaining - 1 where id = v_grant;
  else
    perform private.transfer_money(p_game_id, v_buyer_wallet, v_house_wallet, v_price, 'hint_purchase', 'Purchased hint', 'hintbuy:' || gen_random_uuid()::text, auth.uid());
  end if;

  insert into public.hint_grants (hint_id, player_id, scope, source, granted_by)
  values (v_hint, v_buyer, v_scope, 'buzz', auth.uid());
  insert into public.hint_buzzes (game_id, buyer_player_id, target_player_id, hint_id, price, scope)
  values (p_game_id, v_buyer, p_target_player_id, v_hint, case when v_grant is not null then 0 else v_price end, v_scope);
  return v_hint;
end;
$$;
grant execute on function public.buy_next_hint(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- create_accusation_buzz: free_buzz waives the stake; buzz_immunity on the
-- target blocks the accusation entirely.
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
  v_grant uuid;
begin
  if v_accuser is null or v_accuser = p_target_player_id then raise exception 'invalid_target'; end if;
  select coalesce((gr.config ->> 'accusationStake')::bigint, v_stake),
         coalesce((gr.config ->> 'correctTransferPercent')::int, v_percent)
    into v_stake, v_percent
  from public.games g left join public.game_rounds gr on gr.id = g.current_round_id
  where g.id = p_game_id and g.status in ('live', 'finale');
  if not found then raise exception 'game_not_live'; end if;
  if exists (
    select 1 from public.player_grants
    where player_id = p_target_player_id and kind = 'buzz_immunity'
      and coalesce(expires_at, now()) > now()
  ) then raise exception 'target_immune'; end if;
  if exists (
    select 1 from public.secret_holders sh join public.secrets s on s.id = sh.secret_id
    where sh.player_id = p_target_player_id and s.status = 'revealed'
  ) then raise exception 'secret_revealed'; end if;

  select id into v_grant from public.player_grants
   where player_id = v_accuser and kind = 'free_buzz' and uses_remaining > 0
   order by created_at limit 1;
  if v_grant is not null then
    update public.player_grants set uses_remaining = uses_remaining - 1 where id = v_grant;
    v_stake := 0;
  else
    select balance into v_balance from public.wallets where player_id = v_accuser;
    if v_balance is null or v_balance < v_stake then raise exception 'insufficient_funds'; end if;
  end if;

  insert into public.accusation_buzzes
    (game_id, accuser_player_id, target_player_id, theory, stake, transfer_percent)
  values (p_game_id, v_accuser, p_target_player_id, left(trim(p_theory), 500), v_stake, v_percent)
  returning id into v_id;
  if v_stake > 0 then
    select id into v_buyer_wallet from public.wallets where player_id = v_accuser;
    select id into v_house_wallet from public.wallets where game_id = p_game_id and kind = 'house';
    perform private.transfer_money(p_game_id, v_buyer_wallet, v_house_wallet, v_stake, 'buzz_escrow', 'Accusation stake held', 'buzzescrow:' || v_id, auth.uid());
  end if;
  return v_id;
end;
$$;
grant execute on function public.create_accusation_buzz(uuid, uuid, text) to authenticated;
