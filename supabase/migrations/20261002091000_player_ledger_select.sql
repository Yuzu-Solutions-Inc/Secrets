-- Players get a wallet transaction history (mirroring the host's per-player
-- ledger panel), including their dilemma accept/refuse cash effects.
-- ledger_entries already scopes to the entry's own wallet owner, but
-- ledger_transactions was admin-only, which blocked the join a player-side
-- query needs. Add a permissive select policy for transactions that have at
-- least one entry on the caller's own wallet; this is additive (OR'd with
-- the existing admin policy) and changes nothing for the host.
create policy ledger_transactions_player_select on public.ledger_transactions for select to authenticated
using (
  exists (
    select 1
    from public.ledger_entries le
    join public.wallets w on w.id = le.wallet_id
    where le.transaction_id = ledger_transactions.id
      and public.owns_game_player(w.player_id)
  )
);
