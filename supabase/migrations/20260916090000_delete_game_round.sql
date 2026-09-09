-- Rounds page editor (item 4): the host may delete a round that has not run
-- yet. delete_game_round() enforces "future only" server-side and closes the
-- position gap so move_game_round keeps working.
--
-- A round is deletable only when its status is 'scheduled' AND it sits after
-- the game's current round (or the game has no current round yet).

create or replace function public.delete_game_round(p_round_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_round public.game_rounds%rowtype;
  v_current_pos int;
begin
  select * into v_round from public.game_rounds where id = p_round_id for update;
  if v_round.id is null then raise exception 'not_found'; end if;
  if not public.is_game_admin(v_round.game_id) then raise exception 'forbidden'; end if;
  if v_round.status <> 'scheduled' then raise exception 'round_not_future'; end if;

  select r.position into v_current_pos
  from public.games g
  join public.game_rounds r on r.id = g.current_round_id
  where g.id = v_round.game_id;

  if v_current_pos is not null and v_round.position <= v_current_pos then
    raise exception 'round_not_future';
  end if;

  delete from public.game_rounds where id = p_round_id;

  -- Close the gap without tripping the (game_id, position) unique index:
  -- park the higher rounds far away, then bring them back one slot lower.
  update public.game_rounds set position = position + 100000
  where game_id = v_round.game_id and position > v_round.position;
  update public.game_rounds set position = position - 100001
  where game_id = v_round.game_id and position > 99999;
end;
$$;
grant execute on function public.delete_game_round(uuid) to authenticated;
