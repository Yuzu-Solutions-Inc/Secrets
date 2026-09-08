import { z } from "zod";

export const dilemmaChoiceSchema = z.enum(["share", "steal"]);
export type DilemmaChoice = z.infer<typeof dilemmaChoiceSchema>;

export type DilemmaPayout = {
  playerId: string;
  amount: number;
};

export type DilemmaRules = {
  allSharePercent: number;
  singleStealerPercent: number;
  multipleStealersPercent: number;
  allStealDistributedPercent: number;
};

export const defaultDilemmaRules: DilemmaRules = {
  allSharePercent: 100,
  singleStealerPercent: 60,
  multipleStealersPercent: 30,
  allStealDistributedPercent: 50,
};

function split(total: number, ids: string[]) {
  if (ids.length === 0) return [] as DilemmaPayout[];
  const base = Math.floor(total / ids.length);
  let remainder = total - base * ids.length;
  return [...ids].sort().map((playerId) => ({
    playerId,
    amount: base + (remainder-- > 0 ? 1 : 0),
  }));
}

export function resolveDilemma(
  pot: number,
  choices: Record<string, DilemmaChoice>,
  rules = defaultDilemmaRules,
) {
  const entries = Object.entries(choices);
  if (!Number.isSafeInteger(pot) || pot < 0 || entries.length === 0) {
    throw new Error("invalid_dilemma");
  }
  const sharers = entries.filter(([, value]) => value === "share").map(([id]) => id);
  const stealers = entries.filter(([, value]) => value === "steal").map(([id]) => id);

  if (stealers.length === 0) {
    return split(Math.floor((pot * rules.allSharePercent) / 100), sharers);
  }
  if (sharers.length === 0) {
    return split(
      Math.floor((pot * rules.allStealDistributedPercent) / 100),
      stealers,
    );
  }
  const stealerPercent =
    stealers.length === 1
      ? rules.singleStealerPercent
      : rules.multipleStealersPercent;
  const stealerPot = Math.floor((pot * stealerPercent) / 100);
  return [...split(stealerPot, stealers), ...split(pot - stealerPot, sharers)];
}

export function accusationTransfer(input: {
  defenderBalance: number;
  stake: number;
  result: "correct" | "partial" | "wrong" | "cancelled";
  correctPercent: number;
  partialPercent?: number;
}) {
  if (input.result === "wrong") return input.stake;
  if (input.result === "cancelled") return 0;
  const percent =
    input.result === "correct"
      ? input.correctPercent
      : (input.partialPercent ?? Math.floor(input.correctPercent / 2));
  return Math.floor((Math.max(0, input.defenderBalance) * percent) / 100);
}

export const roundConfigSchema = z.object({
  durationMinutes: z.number().int().positive().max(1440),
  walletMode: z.enum(["temporary_team", "pooled_personal", "personal"]),
  accusationBuzzEnabled: z.boolean(),
  hintBuzzEnabled: z.boolean(),
  accusationStake: z.number().int().nonnegative(),
  correctTransferPercent: z.number().int().min(0).max(100),
  hintPrice: z.number().int().nonnegative(),
  hintVisibility: z.enum(["private", "team", "public"]),
  completion: z.enum(["manual", "timer", "all_submitted"]),
});

export type RoundConfig = z.infer<typeof roundConfigSchema>;

export const winnerFormulaSchema = z.object({
  moneyWeight: z.number().min(0).default(1),
  protectedSecretBonus: z.number().int().nonnegative().default(0),
  houseSecretBonus: z.number().int().nonnegative().default(0),
  missionBonus: z.number().int().nonnegative().default(0),
  voteBonus: z.number().int().nonnegative().default(0),
});

export function calculateFinalScore(
  input: {
    balance: number;
    secretProtected: boolean;
    houseSecretSolved: boolean;
    approvedMissions: number;
    finaleVotes: number;
  },
  formula: z.infer<typeof winnerFormulaSchema>,
) {
  const config = winnerFormulaSchema.parse(formula);
  return (
    Math.floor(input.balance * config.moneyWeight) +
    (input.secretProtected ? config.protectedSecretBonus : 0) +
    (input.houseSecretSolved ? config.houseSecretBonus : 0) +
    input.approvedMissions * config.missionBonus +
    input.finaleVotes * config.voteBonus
  );
}
