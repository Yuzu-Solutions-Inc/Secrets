-- A player's dilemma answer (accept/refuse) must be permanent. The
-- event_responses_self_write policy grants players unrestricted UPDATE on
-- their own response row, so respondToDilemma's upsert could silently flip
-- an earlier accept to refuse (or back) — including after the accept's
-- cash/perk effects had already been granted, with nothing to claw them
-- back. Block any update that changes `choice`; a same-choice re-submit
-- (double-click, retried request) still passes through untouched.

create or replace function private.lock_dilemma_choice()
returns trigger
language plpgsql
as $$
begin
  if old.choice is distinct from new.choice then
    raise exception 'dilemma_choice_locked';
  end if;
  return new;
end;
$$;

drop trigger if exists game_event_responses_lock_choice on public.game_event_responses;
create trigger game_event_responses_lock_choice
before update on public.game_event_responses
for each row execute function private.lock_dilemma_choice();
