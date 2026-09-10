-- Accepting / refusing a broadcast dilemma always threw. game_event_responses
-- carries the generic display-refresh trigger, but the shared
-- private.queue_display_refresh() reads new.game_id — and this table only has
-- game_event_id, no game_id column. Every insert/update raised
-- `record "new" has no field "game_id"`, so respondToDilemma → the 500.
--
-- Give this one table its own trigger function that resolves the game via the
-- parent event. The shared function is left alone (every other table it fires
-- for does have game_id).

create or replace function private.queue_display_refresh_event_response()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_game uuid;
begin
  select e.game_id into v_game
  from public.game_events e
  where e.id = new.game_event_id;
  if v_game is not null then
    insert into public.display_cues (game_id) values (v_game);
  end if;
  return new;
end;
$$;

drop trigger if exists display_refresh_event_responses on public.game_event_responses;
create trigger display_refresh_event_responses
after insert or update on public.game_event_responses
for each row execute function private.queue_display_refresh_event_response();
