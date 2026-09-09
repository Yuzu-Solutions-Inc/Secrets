// Pure entitlement + tier logic. Mirrors the SQL in
// supabase/migrations/20260914090000_billing_and_paywall.sql. Keep the two in
// sync — the database is the source of truth, this is for the UI and the
// server-action guards.

export const FREE_MAX_PLAYERS = 5;
export const PRO_MAX_PLAYERS = 50;
export const FREE_MAX_MISSIONS = 2;

export type Sku = "pro_pack_3" | "pro_unlimited";

export const SKUS: Record<Sku, { label: string; priceLabel: string; credits: number | "unlimited" }> = {
  pro_pack_3: { label: "3 games", priceLabel: "$5", credits: 3 },
  pro_unlimited: { label: "Unlimited", priceLabel: "$10", credits: "unlimited" },
};

export type ProFeatureKey =
  | "sharedSecrets"
  | "secretReplacement"
  | "imageHints"
  | "teamMissions"
  | "publicMissions"
  | "advancedRounds"
  | "customSchedule";

export const PRO_FEATURE_KEYS: ProFeatureKey[] = [
  "sharedSecrets",
  "secretReplacement",
  "imageHints",
  "teamMissions",
  "publicMissions",
  "advancedRounds",
  "customSchedule",
];

export type Tier = "free" | "pro";

export type Entitlement = {
  user_id: string | null;
  plan: "free" | "pro_pack" | "pro_unlimited";
  pro_credits: number;
  pro_expires_at: string | null;
  free_pro_game_used: boolean;
  pro_games_started: number;
  stripe_customer_id: string | null;
  updated_at: string;
};

export const FREE_ENTITLEMENT: Entitlement = {
  user_id: null,
  plan: "free",
  pro_credits: 0,
  pro_expires_at: null,
  free_pro_game_used: false,
  pro_games_started: 0,
  stripe_customer_id: null,
  updated_at: new Date(0).toISOString(),
};

function proActive(ent: Entitlement, now: Date): boolean {
  return ent.pro_expires_at != null && new Date(ent.pro_expires_at) > now;
}

/** Effective plan — 'free' whenever Pro access has lapsed. */
export function resolvePlan(ent: Entitlement, now: Date): Entitlement["plan"] {
  return proActive(ent, now) ? ent.plan : "free";
}

export type ProGameSource = "free_trial" | "unlimited" | "pack" | null;

/** Which bucket pays for the next Pro game, or null if none can. */
export function proGameSource(ent: Entitlement, now: Date): ProGameSource {
  if (!ent.free_pro_game_used) return "free_trial";
  if (proActive(ent, now)) {
    if (ent.plan === "pro_unlimited") return "unlimited";
    if (ent.plan === "pro_pack" && ent.pro_credits > 0) return "pack";
  }
  return null;
}

export function canStartProGame(ent: Entitlement, now: Date): boolean {
  return proGameSource(ent, now) !== null;
}

export type TierSettings = {
  tier: Tier;
  maxPlayers: number;
  maxMissions: number | null;
  features: Record<ProFeatureKey, boolean>;
};

/**
 * The settings object create_game() will produce for a requested tier +
 * feature set. Free strips everything; Pro passes the requested booleans
 * through. `customSchedule` is derived from the format, not a checkbox.
 */
export function clampSettingsToTier(
  tier: Tier,
  requested: { format: string; features?: Partial<Record<ProFeatureKey, boolean>> },
): TierSettings & { format: string } {
  if (tier !== "pro") {
    return {
      tier: "free",
      format: "quick",
      maxPlayers: FREE_MAX_PLAYERS,
      maxMissions: FREE_MAX_MISSIONS,
      features: Object.fromEntries(PRO_FEATURE_KEYS.map((k) => [k, false])) as Record<ProFeatureKey, boolean>,
    };
  }
  const format = ["quick", "weekend", "custom"].includes(requested.format) ? requested.format : "quick";
  const req = requested.features ?? {};
  return {
    tier: "pro",
    format,
    maxPlayers: PRO_MAX_PLAYERS,
    maxMissions: null,
    features: {
      sharedSecrets: Boolean(req.sharedSecrets),
      secretReplacement: Boolean(req.secretReplacement),
      imageHints: Boolean(req.imageHints),
      teamMissions: Boolean(req.teamMissions),
      publicMissions: Boolean(req.publicMissions),
      advancedRounds: Boolean(req.advancedRounds),
      customSchedule: format !== "quick",
    },
  };
}

export type EntitlementSummary = {
  plan: Entitlement["plan"];
  effectivePlan: Entitlement["plan"];
  credits: number;
  unlimited: boolean;
  expiresAt: string | null;
  freeTrialAvailable: boolean;
  canStartPro: boolean;
  proGamesStarted: number;
  /** Short human label for a badge. */
  label: string;
};

export function describeEntitlement(ent: Entitlement, now: Date): EntitlementSummary {
  const effectivePlan = resolvePlan(ent, now);
  const source = proGameSource(ent, now);
  const unlimited = effectivePlan === "pro_unlimited";
  const freeTrialAvailable = !ent.free_pro_game_used;

  let label: string;
  if (unlimited) label = "Pro · Unlimited";
  else if (effectivePlan === "pro_pack") label = `Pro · ${ent.pro_credits} game${ent.pro_credits === 1 ? "" : "s"} left`;
  else if (freeTrialAvailable) label = "Free · 1 Pro game to try";
  else label = "Free";

  return {
    plan: ent.plan,
    effectivePlan,
    credits: effectivePlan === "pro_pack" ? ent.pro_credits : 0,
    unlimited,
    expiresAt: proActive(ent, now) ? ent.pro_expires_at : null,
    freeTrialAvailable,
    canStartPro: source !== null,
    proGamesStarted: ent.pro_games_started,
    label,
  };
}
