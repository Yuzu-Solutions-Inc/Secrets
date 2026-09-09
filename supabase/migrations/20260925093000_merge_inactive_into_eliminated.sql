-- Merge "deactivate" (attendance / play_status = 'inactive') into "eliminate".
-- The host had two buttons that meant the same thing; now there is one
-- reversible Eliminate/Restore toggle. 'eliminated' no longer requires a live
-- elimination round, and 'inactive' is retired as a value.

-- 1. Fold every existing attendance toggle into elimination.
update public.game_players set play_status = 'eliminated' where play_status = 'inactive';

-- 2. set_player_play_status: drop the elimination-round gate and the 'inactive'
--    option. 'spectator' (finale non-finalist) is still a plain host toggle.
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
  if not public.is_game_admin(p_game_id)
     or p_status not in ('active', 'eliminated', 'spectator') then
    raise exception 'forbidden';
  end if;

  update public.game_players set play_status = p_status
  where id = p_player_id and game_id = p_game_id;

  select organization_id into v_org from public.games where id = p_game_id;
  insert into public.audit_events (organization_id, game_id, actor_user_id, action, resource_type, resource_id, metadata)
  values (v_org, p_game_id, auth.uid(), 'player.' || p_status, 'game_player', p_player_id, '{}'::jsonb);
end;
$$;
grant execute on function public.set_player_play_status(uuid, uuid, text) to authenticated;
