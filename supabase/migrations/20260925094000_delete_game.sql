-- Host "delete game" (Settings tab). Every game-scoped table references
-- games(id) ON DELETE cascade, so removing the row tears the whole game down.
-- Guarded to a game admin, mirroring delete_game_round.

create or replace function public.delete_game(p_game_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_game_admin(p_game_id) then raise exception 'forbidden'; end if;
  if not exists (select 1 from public.games where id = p_game_id) then raise exception 'not_found'; end if;
  delete from public.games where id = p_game_id;
end;
$$;
grant execute on function public.delete_game(uuid) to authenticated;
