-- Host can remove a player from a game. Before the game goes live a game_player
-- only trails ON DELETE CASCADE rows (its wallet, a held secret, team
-- membership, mission assignments), so the delete is clean. Once play has
-- started the player may be referenced by ballots or accusation buzzes
-- (ON DELETE no action); that delete raises foreign_key_violation, which we
-- translate to `player_has_activity` so the host is steered to "deactivate"
-- instead. Removing the player also drops the matching allow-list email so the
-- shared invite link can't let them straight back in.

create or replace function public.remove_game_player(p_game_id uuid, p_player_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_email text;
begin
  if not public.is_game_admin(p_game_id) then
    raise exception 'forbidden';
  end if;

  select g.organization_id into v_org from public.games g where g.id = p_game_id;

  select lower(pr.email) into v_email
  from public.game_players gp
  join public.profiles pr on pr.id = gp.user_id
  where gp.id = p_player_id and gp.game_id = p_game_id;

  begin
    delete from public.game_players where id = p_player_id and game_id = p_game_id;
  exception when foreign_key_violation then
    raise exception 'player_has_activity';
  end;

  if not found then
    raise exception 'not_found';
  end if;

  if v_email is not null then
    delete from public.game_whitelist
    where game_id = p_game_id and lower(email) = v_email;
  end if;

  insert into public.audit_events
    (organization_id, game_id, actor_user_id, action, resource_type, resource_id, metadata)
  values
    (v_org, p_game_id, auth.uid(), 'player.removed', 'game_player', p_player_id, '{}'::jsonb);
end;
$$;

grant execute on function public.remove_game_player(uuid, uuid) to authenticated;
