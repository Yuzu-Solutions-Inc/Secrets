-- Rounds tab overhaul: drag-to-reorder replaces the up/down arrows, and the
-- finale becomes a singleton that is always the last round.

-- Existing data: some games already carry more than one 'finale' round. Keep
-- the one at the greatest position and demote the rest to 'solo' so the
-- singleton index below can be created.
with ranked as (
  select id,
         row_number() over (partition by game_id order by position desc, id desc) as rn
  from public.game_rounds
  where kind = 'finale'
)
update public.game_rounds gr
   set kind = 'solo'
  from ranked
 where gr.id = ranked.id and ranked.rn > 1;

-- Backstop for "only one finale per game".
create unique index if not exists game_round_one_finale
  on public.game_rounds (game_id) where kind = 'finale';

-- The up/down arrow control is gone; drag-to-reorder writes an explicit order.
drop function if exists public.move_game_round(uuid, text);

-- Reassign positions from an explicit ordered id list. Two-phase to dodge the
-- (game_id, position) unique index. Refuses unless the id set matches the
-- game's rounds exactly and kind='finale' (if any) ends up last.
create or replace function public.reorder_game_rounds(p_game_id uuid, p_round_ids uuid[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_total int;
  v_matched int;
  v_finale_pos int;
  v_has_finale boolean;
begin
  if not public.is_game_admin(p_game_id) then raise exception 'forbidden'; end if;

  select count(*) into v_total from public.game_rounds where game_id = p_game_id;
  select count(*) into v_matched
    from unnest(p_round_ids) as x(id)
    join public.game_rounds gr on gr.id = x.id and gr.game_id = p_game_id;
  if coalesce(array_length(p_round_ids, 1), 0) <> v_total or v_matched <> v_total then
    raise exception 'round_set_mismatch';
  end if;

  -- Phase 1: park every row on a unique negative position.
  update public.game_rounds gr
     set position = -1 - t.ord
    from (select id, (ord - 1)::int as ord
            from unnest(p_round_ids) with ordinality as u(id, ord)) t
   where gr.id = t.id and gr.game_id = p_game_id;

  -- Phase 2: contiguous 0..n-1 in the requested order.
  update public.game_rounds gr
     set position = t.ord
    from (select id, (ord - 1)::int as ord
            from unnest(p_round_ids) with ordinality as u(id, ord)) t
   where gr.id = t.id and gr.game_id = p_game_id;

  select position into v_finale_pos
    from public.game_rounds where game_id = p_game_id and kind = 'finale';
  v_has_finale := found;
  if v_has_finale and v_finale_pos <> v_total - 1 then
    raise exception 'finale_must_be_last';
  end if;
end;
$$;
grant execute on function public.reorder_game_rounds(uuid, uuid[]) to authenticated;

-- Duplicating a round: never duplicate the finale, and drop the copy in just
-- before the finale so the finale stays last.
create or replace function public.duplicate_game_round(p_round_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_round public.game_rounds%rowtype;
  v_id uuid;
  v_max int;
  v_finale_pos int;
  v_has_finale boolean;
  v_insert_pos int;
begin
  select * into v_round from public.game_rounds where id = p_round_id;
  if not public.is_game_admin(v_round.game_id) then raise exception 'forbidden'; end if;
  if v_round.kind = 'finale' then raise exception 'cannot_duplicate_finale'; end if;

  select coalesce(max(position), -1) into v_max from public.game_rounds where game_id = v_round.game_id;
  select position into v_finale_pos
    from public.game_rounds where game_id = v_round.game_id and kind = 'finale';
  v_has_finale := found;

  if v_has_finale then
    v_insert_pos := v_finale_pos;
    update public.game_rounds set position = v_max + 1
      where game_id = v_round.game_id and kind = 'finale';
  else
    v_insert_pos := v_max + 1;
  end if;

  insert into public.game_rounds (game_id, title, kind, position, config)
  values (v_round.game_id, v_round.title || ' copy', v_round.kind, v_insert_pos, v_round.config)
  returning id into v_id;
  return v_id;
end;
$$;
grant execute on function public.duplicate_game_round(uuid) to authenticated;
