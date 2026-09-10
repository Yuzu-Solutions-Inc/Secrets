-- Missions can require a proof photo before the host will approve them. The
-- host ticks "require a proof photo" when drafting the mission; the player then
-- has to attach an image to mark it complete; the host sees the photo next to
-- the Approve / Fail buttons. The photo path lands in the long-existing but
-- unused mission_assignments.evidence_path column.

alter table public.missions
  add column if not exists require_proof boolean not null default false;

-- submit_mission gains an optional evidence path. Drop the 2-arg version so we
-- keep a single definition (the new arg has a default, so existing callers that
-- pass only mission + player still resolve to this one).
drop function if exists public.submit_mission(uuid, uuid);

create or replace function public.submit_mission(
  p_mission_id uuid,
  p_player_id uuid,
  p_evidence_path text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_game uuid;
  v_require_proof boolean;
  v_evidence text := nullif(p_evidence_path, '');
begin
  select game_id, require_proof into v_game, v_require_proof
  from public.missions where id = p_mission_id;
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
  if coalesce(v_require_proof, false) and v_evidence is null then
    raise exception 'proof_required';
  end if;
  update public.mission_assignments
  set submitted_at = now(),
      evidence_path = coalesce(v_evidence, evidence_path)
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
grant execute on function public.submit_mission(uuid, uuid, text) to authenticated;
