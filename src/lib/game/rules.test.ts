import assert from "node:assert/strict";
import test from "node:test";

import { accusationTransfer, calculateFinalScore, resolveDilemma } from "./rules";

test("all-share splits the complete pot deterministically", () => {
  assert.deepEqual(resolveDilemma(101, { b: "share", a: "share" }), [
    { playerId: "a", amount: 51 },
    { playerId: "b", amount: 50 },
  ]);
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
  assert.equal(payouts.filter((row) => row.playerId.startsWith("thief")).reduce((sum, row) => sum + row.amount, 0), 3_000);
});

test("all-steal distributes only half", () => {
  const payouts = resolveDilemma(10_000, { a: "steal", b: "steal" });
  assert.equal(payouts.reduce((sum, row) => sum + row.amount, 0), 5_000);
});

test("accusation transfers use configured percentages", () => {
  assert.equal(accusationTransfer({
    defenderBalance: 12_345,
    stake: 5_000,
    result: "correct",
    correctPercent: 50,
  }), 6_172);
  assert.equal(accusationTransfer({
    defenderBalance: 12_345,
    stake: 5_000,
    result: "wrong",
    correctPercent: 50,
  }), 5_000);
});

test("final score follows the game template formula", () => {
  assert.equal(calculateFinalScore({
    balance: 10_000,
    secretProtected: true,
    houseSecretSolved: false,
    approvedMissions: 3,
    finaleVotes: 2,
  }, {
    moneyWeight: 1,
    protectedSecretBonus: 5_000,
    houseSecretBonus: 2_000,
    missionBonus: 500,
    voteBonus: 1_000,
  }), 18_500);
});
