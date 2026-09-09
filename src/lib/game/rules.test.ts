import assert from "node:assert/strict";
import test from "node:test";

import {
  accusationTransfer,
  calculateFinalScore,
  defaultDilemmaRules,
  resolveDilemma,
  roundConfigSchema,
  winnerFormulaSchema,
  type DilemmaChoice,
} from "./rules";

test("all-share splits the complete pot deterministically", () => {
  assert.deepEqual(resolveDilemma(101, { b: "share", a: "share" }), [
    { playerId: "a", amount: 51 },
    { playerId: "b", amount: 50 },
  ]);
});

test("all-share spreads an indivisible pot by sorted player id", () => {
  const payouts = resolveDilemma(100, { c: "share", a: "share", b: "share" });
  assert.deepEqual(payouts, [
    { playerId: "a", amount: 34 },
    { playerId: "b", amount: 33 },
    { playerId: "c", amount: 33 },
  ]);
  assert.equal(payouts.reduce((sum, row) => sum + row.amount, 0), 100);
});

test("one stealer receives sixty percent", () => {
  const payouts = resolveDilemma(10_000, {
    thief: "steal",
    first: "share",
    second: "share",
  });
  assert.deepEqual(payouts, [
    { playerId: "thief", amount: 6_000 },
    { playerId: "first", amount: 2_000 },
    { playerId: "second", amount: 2_000 },
  ]);
});

test("multiple stealers favor sharers", () => {
  const payouts = resolveDilemma(10_000, {
    thiefB: "steal",
    honest: "share",
    thiefA: "steal",
  });
  assert.equal(payouts.find((row) => row.playerId === "honest")?.amount, 7_000);
  assert.equal(
    payouts
      .filter((row) => row.playerId.startsWith("thief"))
      .reduce((sum, row) => sum + row.amount, 0),
    3_000,
  );
});

test("mixed indivisible pot stays fully distributed", () => {
  const payouts = resolveDilemma(101, { a: "steal", b: "steal", c: "share" });
  assert.equal(payouts.reduce((sum, row) => sum + row.amount, 0), 101);
  assert.equal(payouts.find((row) => row.playerId === "c")?.amount, 71);
});

test("all-steal distributes only half and banks the rest", () => {
  const payouts = resolveDilemma(10_000, { a: "steal", b: "steal" });
  assert.equal(payouts.reduce((sum, row) => sum + row.amount, 0), 5_000);
});

test("all-steal floors the distributed half on an odd pot", () => {
  const payouts = resolveDilemma(101, { a: "steal", b: "steal" });
  assert.equal(payouts.reduce((sum, row) => sum + row.amount, 0), 50);
});

test("resolveDilemma rejects impossible pots", () => {
  assert.throws(() => resolveDilemma(-1, { a: "share" }), /invalid_dilemma/);
  assert.throws(() => resolveDilemma(1.5, { a: "share" }), /invalid_dilemma/);
  assert.throws(() => resolveDilemma(100, {}), /invalid_dilemma/);
});

test("resolveDilemma never pays out more than the pot or a negative share", () => {
  const ids = ["a", "b", "c", "d"];
  const pot = 1_000;
  for (let mask = 0; mask < 1 << ids.length; mask++) {
    const choices: Record<string, DilemmaChoice> = {};
    ids.forEach((id, index) => {
      choices[id] = mask & (1 << index) ? "steal" : "share";
    });
    const payouts = resolveDilemma(pot, choices, defaultDilemmaRules);
    const total = payouts.reduce((sum, row) => sum + row.amount, 0);
    assert.ok(total <= pot, `combo ${mask} paid ${total} > ${pot}`);
    assert.ok(
      payouts.every((row) => Number.isInteger(row.amount) && row.amount >= 0),
      `combo ${mask} produced a bad share`,
    );
  }
});

test("accusation transfers use configured percentages", () => {
  assert.equal(
    accusationTransfer({
      defenderBalance: 12_345,
      stake: 5_000,
      result: "correct",
      correctPercent: 50,
    }),
    6_172,
  );
  assert.equal(
    accusationTransfer({
      defenderBalance: 12_345,
      stake: 5_000,
      result: "wrong",
      correctPercent: 50,
    }),
    5_000,
  );
});

test("partial accusations use partialPercent, falling back to half of correct", () => {
  assert.equal(
    accusationTransfer({
      defenderBalance: 1_000,
      stake: 100,
      result: "partial",
      correctPercent: 50,
      partialPercent: 20,
    }),
    200,
  );
  assert.equal(
    accusationTransfer({
      defenderBalance: 1_000,
      stake: 100,
      result: "partial",
      correctPercent: 50,
    }),
    250,
  );
});

test("cancelled accusations move nothing and negative balances clamp to zero", () => {
  assert.equal(
    accusationTransfer({
      defenderBalance: 9_999,
      stake: 100,
      result: "cancelled",
      correctPercent: 50,
    }),
    0,
  );
  assert.equal(
    accusationTransfer({
      defenderBalance: -500,
      stake: 100,
      result: "correct",
      correctPercent: 50,
    }),
    0,
  );
});

test("final score follows the game template formula", () => {
  assert.equal(
    calculateFinalScore(
      {
        balance: 10_000,
        secretProtected: true,
        houseSecretSolved: false,
        approvedMissions: 3,
        finaleVotes: 2,
      },
      {
        moneyWeight: 1,
        protectedSecretBonus: 5_000,
        houseSecretBonus: 2_000,
        missionBonus: 500,
        voteBonus: 1_000,
      },
    ),
    18_500,
  );
});

test("winner-formula schema fills every bonus with a default", () => {
  const formula = winnerFormulaSchema.parse({});
  assert.deepEqual(formula, {
    moneyWeight: 1,
    protectedSecretBonus: 0,
    houseSecretBonus: 0,
    missionBonus: 0,
    voteBonus: 0,
  });
  assert.equal(
    calculateFinalScore(
      {
        balance: 1_000,
        secretProtected: true,
        houseSecretSolved: true,
        approvedMissions: 2,
        finaleVotes: 1,
      },
      formula,
    ),
    1_000,
  );
});

test("final score floors a fractional money weight", () => {
  assert.equal(
    calculateFinalScore(
      {
        balance: 999,
        secretProtected: false,
        houseSecretSolved: false,
        approvedMissions: 0,
        finaleVotes: 0,
      },
      winnerFormulaSchema.parse({ moneyWeight: 0.5 }),
    ),
    499,
  );
});

test("round and winner schemas reject out-of-range configuration", () => {
  assert.throws(() =>
    roundConfigSchema.parse({
      durationMinutes: 0,
      walletMode: "personal",
      accusationBuzzEnabled: true,
      hintBuzzEnabled: true,
      accusationStake: 0,
      correctTransferPercent: 50,
      hintPrice: 0,
      hintVisibility: "private",
      completion: "manual",
    }),
  );
  assert.throws(() => winnerFormulaSchema.parse({ moneyWeight: -1 }));
  assert.throws(() => winnerFormulaSchema.parse({ missionBonus: 1.5 }));
});
