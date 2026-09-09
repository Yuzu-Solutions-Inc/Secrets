import assert from "node:assert/strict";
import { test } from "node:test";

import {
  FREE_ENTITLEMENT,
  type Entitlement,
  canStartProGame,
  clampSettingsToTier,
  describeEntitlement,
  proGameSource,
  resolvePlan,
} from "./plan";

const NOW = new Date("2026-06-01T00:00:00Z");
const inAYear = new Date("2027-01-01T00:00:00Z").toISOString();
const lastYear = new Date("2025-06-01T00:00:00Z").toISOString();

function ent(overrides: Partial<Entitlement>): Entitlement {
  return { ...FREE_ENTITLEMENT, ...overrides };
}

test("brand-new user gets the free trial", () => {
  const e = ent({ free_pro_game_used: false });
  assert.equal(proGameSource(e, NOW), "free_trial");
  assert.equal(canStartProGame(e, NOW), true);
  assert.equal(resolvePlan(e, NOW), "free");
});

test("after the trial, free plan cannot start a pro game", () => {
  const e = ent({ free_pro_game_used: true });
  assert.equal(proGameSource(e, NOW), null);
  assert.equal(canStartProGame(e, NOW), false);
});

test("unlimited within term resolves to unlimited", () => {
  const e = ent({ free_pro_game_used: true, plan: "pro_unlimited", pro_expires_at: inAYear });
  assert.equal(resolvePlan(e, NOW), "pro_unlimited");
  assert.equal(proGameSource(e, NOW), "unlimited");
});

test("expired pro lapses to free regardless of stored plan", () => {
  const e = ent({ free_pro_game_used: true, plan: "pro_unlimited", pro_expires_at: lastYear });
  assert.equal(resolvePlan(e, NOW), "free");
  assert.equal(proGameSource(e, NOW), null);
});

test("pack needs both a live term and remaining credits", () => {
  assert.equal(
    proGameSource(ent({ free_pro_game_used: true, plan: "pro_pack", pro_credits: 2, pro_expires_at: inAYear }), NOW),
    "pack",
  );
  assert.equal(
    proGameSource(ent({ free_pro_game_used: true, plan: "pro_pack", pro_credits: 0, pro_expires_at: inAYear }), NOW),
    null,
  );
  assert.equal(
    proGameSource(ent({ free_pro_game_used: true, plan: "pro_pack", pro_credits: 2, pro_expires_at: lastYear }), NOW),
    null,
  );
});

test("free clamp strips features, format and caps", () => {
  const s = clampSettingsToTier("free", {
    format: "weekend",
    features: { sharedSecrets: true, imageHints: true },
  });
  assert.equal(s.tier, "free");
  assert.equal(s.format, "quick");
  assert.equal(s.maxPlayers, 5);
  assert.equal(s.maxMissions, 2);
  assert.equal(Object.values(s.features).every((v) => v === false), true);
});

test("pro clamp keeps requested features and derives customSchedule", () => {
  const s = clampSettingsToTier("pro", {
    format: "weekend",
    features: { sharedSecrets: true, teamMissions: true },
  });
  assert.equal(s.tier, "pro");
  assert.equal(s.format, "weekend");
  assert.equal(s.maxPlayers, 50);
  assert.equal(s.maxMissions, null);
  assert.equal(s.features.sharedSecrets, true);
  assert.equal(s.features.teamMissions, true);
  assert.equal(s.features.imageHints, false);
  assert.equal(s.features.customSchedule, true);
});

test("describeEntitlement labels", () => {
  assert.equal(describeEntitlement(ent({}), NOW).label, "Free · 1 Pro game to try");
  assert.equal(describeEntitlement(ent({ free_pro_game_used: true }), NOW).label, "Free");
  assert.equal(
    describeEntitlement(ent({ free_pro_game_used: true, plan: "pro_pack", pro_credits: 1, pro_expires_at: inAYear }), NOW).label,
    "Pro · 1 game left",
  );
  assert.equal(
    describeEntitlement(ent({ free_pro_game_used: true, plan: "pro_unlimited", pro_expires_at: inAYear }), NOW).label,
    "Pro · Unlimited",
  );
});
