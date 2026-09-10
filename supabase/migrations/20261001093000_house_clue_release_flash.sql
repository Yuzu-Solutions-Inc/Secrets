-- Releasing a House Secret clue now also drops a public "clue" game_event, so
-- the public display flashes the clue full-screen for ~15s with an attention
-- chime (the takeover already keys off public game_events; see public-display).
-- The per-clue "Release" button does this from the server action; the "release
-- random" path is an RPC, so it emits the event itself.
--
-- Whole function reproduced (Postgres has no "add one statement"); only the
-- game_events insert is new versus 20260924090000_house_secret_clue_parity.sql.

create or replace function public.release_random_house_clue(p_house_secret_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_game_id uuid;
  v_clue_id uuid;
  v_clue_text text;
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

  select id, text into v_clue_id, v_clue_text
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

  insert into public.game_events (game_id, kind, title, is_public, published_at)
  values (v_game_id, 'clue', coalesce(nullif(v_clue_text, ''), 'New clue'), true, now());

  return v_clue_id;
end;
$$;

grant execute on function public.release_random_house_clue(uuid) to authenticated;
