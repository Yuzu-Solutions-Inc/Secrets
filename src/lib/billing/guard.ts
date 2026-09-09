import "server-only";

import { createClient } from "@/lib/supabase/server";
import type { ProFeatureKey } from "./plan";

type GameTierSettings = {
  tier?: "free" | "pro";
  maxMissions?: number | null;
  features?: Partial<Record<ProFeatureKey, boolean>>;
};

async function readSettings(gameId: string): Promise<GameTierSettings> {
  const supabase = await createClient();
  const { data } = await supabase.from("games").select("settings").eq("id", gameId).maybeSingle();
  return (data?.settings ?? {}) as GameTierSettings;
}

const FEATURE_ERROR: Record<ProFeatureKey, string> = {
  sharedSecrets: "pro_feature_shared_secrets",
  secretReplacement: "pro_feature_secret_replacement",
  imageHints: "pro_feature_image_hints",
  teamMissions: "pro_feature_team_missions",
  publicMissions: "pro_feature_public_missions",
  advancedRounds: "pro_feature_advanced_rounds",
  customSchedule: "pro_feature_custom_schedule",
};

/** Throws the matching `pro_feature_*` code when the game's tier lacks a feature. */
export async function assertProFeature(gameId: string, feature: ProFeatureKey): Promise<void> {
  const settings = await readSettings(gameId);
  if (settings.tier !== "pro" || settings.features?.[feature] !== true) {
    throw new Error(FEATURE_ERROR[feature]);
  }
}

/** Enforces the Free-tier mission ceiling + private-only visibility. */
export async function assertMissionAllowed(
  gameId: string,
  visibility: "private" | "team" | "public",
  currentCount: number,
): Promise<void> {
  const settings = await readSettings(gameId);
  if (settings.tier === "pro") return;
  if (visibility !== "private") throw new Error("pro_feature_mission_visibility");
  const cap = settings.maxMissions ?? 2;
  if (currentCount >= cap) throw new Error("mission_limit_reached");
}

/** True when the game is running on the Free tier. */
export async function isFreeTier(gameId: string): Promise<boolean> {
  return (await readSettings(gameId)).tier !== "pro";
}
