-- "Delete game" failed with `immutable_record`: removing a game cascades into
-- ledger_transactions, whose BEFORE DELETE trigger (private.prevent_immutable_change)
-- blocks every delete to keep the audit ledger tamper-proof during play. And
-- even past that, ledger_entries has no cascade path from games, so the delete
-- would then trip a foreign-key violation.
--
-- Fix: give the immutability guard the same escape hatch the locked-secret guard
-- already uses (a transaction-local GUC), and have delete_game() clear the
-- game's ledger explicitly under that override before dropping the game row.

create or replace function private.prevent_immutable_change()
returns trigger
language plpgsql
as $$
begin
  -- Full game teardown (public.delete_game) sets this for the transaction.
  if coalesce(current_setting('app.ledger_override', true), '') = 'on' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  raise exception 'immutable_record';
end;
$$;

create or replace function public.delete_game(p_game_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_game_admin(p_game_id) then raise exception 'forbidden'; end if;
  if not exists (select 1 from public.games where id = p_game_id) then raise exception 'not_found'; end if;

  -- Allow this transaction to delete the (otherwise immutable) ledger rows.
  perform set_config('app.ledger_override', 'on', true);

  delete from public.ledger_entries e
    using public.ledger_transactions t
    where e.transaction_id = t.id
      and t.game_id = p_game_id;
  delete from public.ledger_transactions where game_id = p_game_id;

  -- Every other game-scoped table references games(id) ON DELETE cascade.
  delete from public.games where id = p_game_id;
end;
$$;

grant execute on function public.delete_game(uuid) to authenticated;
