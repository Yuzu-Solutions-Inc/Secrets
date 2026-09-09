import assert from "node:assert/strict";
import test from "node:test";

import { dilemmaEffectSchema, dilemmaEffectsSchema, summarizeDilemmaEffect } from "./rules";

test("cash effect requires a positive amount and a direction", () => {
  assert.doesNotThrow(() => dilemmaEffectSchema.parse({ type: "cash", direction: "gain", amount: 500 }));
  assert.throws(() => dilemmaEffectSchema.parse({ type: "cash", direction: "gain", amount: 0 }));
  assert.throws(() => dilemmaEffectSchema.parse({ type: "cash", direction: "sideways", amount: 5 }));
});

test("free_hint accepts an optional target and rejects a bad uuid", () => {
  assert.doesNotThrow(() => dilemmaEffectSchema.parse({ type: "free_hint", recipients: "all" }));
  assert.doesNotThrow(() =>
    dilemmaEffectSchema.parse({
      type: "free_hint",
      recipients: "responder",
      aboutPlayerId: "00000000-0000-0000-0000-000000000000",
    }),
  );
  assert.throws(() => dilemmaEffectSchema.parse({ type: "free_hint", recipients: "responder", aboutPlayerId: "nope" }));
});

test("buzz_immunity minutes are bounded", () => {
  assert.doesNotThrow(() => dilemmaEffectSchema.parse({ type: "buzz_immunity", recipients: "responder", minutes: 10 }));
  assert.throws(() => dilemmaEffectSchema.parse({ type: "buzz_immunity", recipients: "responder", minutes: 0 }));
  assert.throws(() => dilemmaEffectSchema.parse({ type: "buzz_immunity", recipients: "responder", minutes: 999 }));
});

test("a dilemma can stack effects, but no more than six", () => {
  const one = { type: "free_buzz", recipients: "responder" } as const;
  assert.doesNotThrow(() => dilemmaEffectsSchema.parse([{ type: "cash", direction: "gain", amount: 500 }, { type: "free_hint", recipients: "all" }]));
  assert.throws(() => dilemmaEffectsSchema.parse(Array.from({ length: 7 }, () => one)));
});

test("summaries read naturally for host and player", () => {
  assert.equal(
    summarizeDilemmaEffect({ type: "cash", direction: "gain", amount: 500 }),
    "Give $500 to the accepter",
  );
  assert.equal(
    summarizeDilemmaEffect({ type: "free_hint", recipients: "all" }),
    "Free hint for everyone",
  );
  assert.equal(
    summarizeDilemmaEffect({ type: "buzz_immunity", recipients: "responder", minutes: 10 }),
    "Buzz immunity for the accepter (10 min)",
  );
});
