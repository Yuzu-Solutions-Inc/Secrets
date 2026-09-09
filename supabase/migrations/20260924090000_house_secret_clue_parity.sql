-- House Secret clues, managed on par with regular secret hints.
--
--  * `position` mirrors hints.position: a stable order the host arranges and the
--    player board renders in sequence. Backfilled from (chapter, created_at).
--  * A clue may now carry text, an image, or both (like a hint row) — the old
--    "text required" shape is relaxed with the same content check hints use.
--  * Clues are NO LONGER auto-released on insert. The host releases them one by
--    one, or lets `release_random_house_clue` pick one — they can never be
--    bought.
--  * house_secret_board() orders by position and carries position + released_at.

alter table public.house_secret_clues
  add column if not exists position integer not null default 0;

-- Number existing clues 0..n within each house secret, keeping their current
-- (chapter, created_at) order.
with ordered as (
  select id,
    row_number() over (
      partition by house_secret_id order by chapter, created_at
    ) - 1 as pos
  from public.house_secret_clues
)
update public.house_secret_clues c
set position = ordered.pos
from ordered
where ordered.id = c.id;

create unique index if not exists house_secret_clue_position_unique
  on public.house_secret_clues (house_secret_id, position);

alter table public.house_secret_clues
  drop constraint if exists house_secret_clue_has_content;
alter table public.house_secret_clues
  add constraint house_secret_clue_has_content
  check (text is not null or asset_path is not null);

-- Release one not-yet-released clue for a house secret, chosen at random.
-- Returns the released clue id, or null when every clue is already out.
-- SECURITY DEFINER with an explicit admin gate so the host action can call it
-- without loosening RLS on house_secret_clues.
create or replace function public.release_random_house_clue(p_house_secret_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_game_id uuid;
  v_clue_id uuid;
begin
  select game_id into v_game_id
  from public.house_secrets
  where id = p_house_secret_id;

  if v_game_id is null then
    raise exception 'house_secret_not_found';
  end if;
  if not public.is_game_admin(v_game_id) then
    raise exception 'forbidden';
  end if;

  select id into v_clue_id
  from public.house_secret_clues
  where house_secret_id = p_house_secret_id and released_at is null
  order by random()
  limit 1;

  if v_clue_id is null then
    return null;
  end if;

  update public.house_secret_clues
  set released_at = now()
  where id = v_clue_id;

  return v_clue_id;
end;
$$;

grant execute on function public.release_random_house_clue(uuid) to authenticated;

-- Player board: order released fragments by position and expose position +
-- released_at so the phone renders them in the host's intended sequence.
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
        'id', c.id, 'chapter', c.chapter, 'position', c.position, 'text', c.text,
        'asset_path', c.asset_path, 'is_decoy', c.is_decoy,
        'released_at', c.released_at
      ) order by c.position, c.created_at)
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
