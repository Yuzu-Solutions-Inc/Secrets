-- Two new mission options for the host:
--
-- 1. require_completion: the host can only Approve/Fail once the player has
--    marked the mission done (mission_assignments.submitted_at is set).
--    Off by default — without it, the host can resolve a mission whenever
--    they like, whether or not the player has submitted anything. A proof
--    photo is itself the completion signal, so require_proof always implies
--    require_completion (enforced in the createMission action, not here).
--
-- 2. use_multiplier: reward/penalty are a per-unit amount (e.g. "$100 per
--    hat"); the host enters the unit count when resolving and it's
--    multiplied into the payout. resolve_mission gains an optional
--    p_multiplier argument, ignored unless the mission has use_multiplier set.

alter table public.missions
  add column if not exists require_completion boolean not null default false;
alter table public.missions
  add column if not exists use_multiplier boolean not null default false;

drop function if exists public.resolve_mission(uuid, uuid, text);

create or replace function public.resolve_mission(
  p_mission_id uuid,
  p_player_id uuid,
  p_result text,
  p_multiplier integer default 1
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
  v_multiplier integer;
  v_description text;
begin
  select * into v_mission from public.missions where id = p_mission_id for update;
  if not public.is_game_admin(v_mission.game_id) then raise exception 'forbidden'; end if;
  if p_result not in ('approved', 'failed') then raise exception 'invalid_result'; end if;
  select id into v_player_wallet from public.wallets where player_id = p_player_id and game_id = v_mission.game_id;
  select id into v_house_wallet from public.wallets where game_id = v_mission.game_id and kind = 'house';
  v_multiplier := greatest(coalesce(p_multiplier, 1), 0);
  v_amount := case when p_result = 'approved' then v_mission.reward else v_mission.penalty end;
  v_description := v_mission.title;
  if v_mission.use_multiplier then
    v_amount := v_amount * v_multiplier;
    v_description := v_description || ' ×' || v_multiplier::text;
  end if;
  if p_result = 'approved' and v_amount > 0 then
    perform private.transfer_money(v_mission.game_id, v_house_wallet, v_player_wallet, v_amount, 'mission_reward', v_description, 'mission:' || p_mission_id || ':' || p_player_id, auth.uid());
  elsif p_result = 'failed' and v_amount > 0 then
    v_amount := least(v_amount, (select balance from public.wallets where id = v_player_wallet));
    perform private.transfer_money(v_mission.game_id, v_player_wallet, v_house_wallet, v_amount, 'mission_penalty', v_description, 'mission:' || p_mission_id || ':' || p_player_id, auth.uid());
  end if;
  update public.missions set status = p_result::public.mission_status where id = p_mission_id;
end;
$$;
grant execute on function public.resolve_mission(uuid, uuid, text, integer) to authenticated;
