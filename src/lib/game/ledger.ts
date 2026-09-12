// Shared by the host's per-player ledger panel and the player's own wallet
// history — both render the same `ledger_transactions` rows (scoped
// differently by RLS) and need the same grouping/labeling.

type Row = Record<string, unknown>;

// One net line per game action for a player. An accusation writes up to three
// ledger transactions (stake escrow, stake refund, settlement) that share a
// buzz id in their idempotency key; readers only want the outcome
// ("Accusation won +X"), not the escrow/refund plumbing — so entries are
// grouped by action and summed.
export function playerTransactions(ledger: Row[], playerId: string) {
  const groups = new Map<string, { net: number; types: Set<string>; at: number }>();

  for (const transaction of ledger) {
    const entries = (transaction.ledger_entries as Row[] | null) ?? [];
    const mine = entries.filter(
      (entry) => String((entry.wallets as Row | null)?.player_id) === playerId,
    );
    if (!mine.length) continue;

    // "buzzescrow:<id>", "buzzrefund:<id>" and "buzz:<id>" collapse to the same
    // accusation; "mission:<mid>:<pid>" collapses to the mission; every other
    // key is already one action.
    const rawKey = String(transaction.idempotency_key ?? transaction.id);
    const key = rawKey.replace(/^[a-z_]+:/i, "").split(":")[0] || rawKey;

    const group = groups.get(key) ?? { net: 0, types: new Set<string>(), at: 0 };
    for (const entry of mine) group.net += Number(entry.amount);
    group.types.add(String(transaction.type));
    group.at = Math.max(group.at, Date.parse(String(transaction.created_at ?? "")) || 0);
    groups.set(key, group);
  }

  return [...groups.entries()]
    .filter(([, group]) => group.net !== 0)
    .sort(([, a], [, b]) => b.at - a.at)
    .map(([id, group]) => ({ id, label: actionLabel(group.types, group.net), amount: group.net }));
}

// Returns a i18n key for known ledger actions, or the raw type text for
// anything unrecognised (the call site does `t.has(label) ? t(label) : label`).
export function actionLabel(types: Set<string>, net: number) {
  const list = [...types];
  const has = (prefix: string) => list.some((type) => type.startsWith(prefix));
  if (has("buzz_")) {
    if (types.has("buzz_wrong")) return "ledgerDefenseHeld";
    return net >= 0 ? "ledgerAccusationWon" : "ledgerAccusationLost";
  }
  if (has("hint")) return net >= 0 ? "ledgerHintSold" : "ledgerHintBought";
  if (types.has("mission_reward")) return "ledgerMissionReward";
  if (types.has("mission_penalty")) return "ledgerMissionPenalty";
  if (has("dilemma_")) return "ledgerDilemma";
  if (types.has("team_funding")) return "ledgerTeamPot";
  if (types.has("admin_adjustment")) return "ledgerHostAdjustment";
  if (types.has("starting_cash")) return "ledgerStartingCash";
  if (types.has("reversal")) return "ledgerCorrection";
  return (list[0] ?? "movement").replaceAll("_", " ");
}
