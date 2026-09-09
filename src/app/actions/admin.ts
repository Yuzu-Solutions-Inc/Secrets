"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { roundConfigSchema, winnerFormulaSchema } from "@/lib/game/rules";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

const base = z.object({
  gameId: z.string().uuid(),
  locale: z.enum(["en", "fr"]),
});

function refresh(locale: string, gameId: string) {
  // Actions here are invoked from the host control room, but that route
  // (`/host`) was never being revalidated — only the player-facing route —
  // so the host's own page stayed stale after every action they took.
  revalidatePath(`/${locale}/games/${gameId}`, "layout");
  revalidatePath(`/${locale}/games/${gameId}/host`, "page");
}

export async function addRound(formData: FormData) {
  const parsed = base.extend({
    title: z.string().trim().min(2).max(100),
    kind: z.enum(["team", "solo", "house_secret", "event", "nomination", "elimination", "finale"]),
    durationMinutes: z.coerce.number().int().positive().max(1440),
    walletMode: z.enum(["temporary_team", "pooled_personal", "personal"]),
  }).parse(Object.fromEntries(formData));
  const supabase = await createClient();
  const { count } = await supabase.from("game_rounds").select("id", { count: "exact", head: true }).eq("game_id", parsed.gameId);
  const config = roundConfigSchema.parse({
    durationMinutes: parsed.durationMinutes,
    walletMode: parsed.walletMode,
    accusationBuzzEnabled: !["event", "nomination", "elimination"].includes(parsed.kind),
    hintBuzzEnabled: !["event", "nomination", "elimination", "finale"].includes(parsed.kind),
    accusationStake: 500_000,
    correctTransferPercent: 50,
    hintPrice: 100_000,
    hintVisibility: parsed.kind === "team" ? "team" : "private",
    completion: parsed.kind === "nomination" ? "all_submitted" : "manual",
  });
  const { error } = await supabase.from("game_rounds").insert({
    game_id: parsed.gameId,
    title: parsed.title,
    kind: parsed.kind,
    position: count ?? 0,
    config,
  });
  if (error) throw new Error(error.message);
  refresh(parsed.locale, parsed.gameId);
}

export async function moveRound(formData: FormData) {
  const parsed = base.extend({
    roundId: z.string().uuid(),
    direction: z.enum(["up", "down"]),
  }).parse(Object.fromEntries(formData));
  const supabase = await createClient();
  const { error } = await supabase.rpc("move_game_round", {
    p_round_id: parsed.roundId,
    p_direction: parsed.direction,
  });
  if (error) throw new Error(error.message);
  refresh(parsed.locale, parsed.gameId);
}

export async function duplicateRound(formData: FormData) {
  const parsed = base.extend({ roundId: z.string().uuid() }).parse(Object.fromEntries(formData));
  const supabase = await createClient();
  const { error } = await supabase.rpc("duplicate_game_round", { p_round_id: parsed.roundId });
  if (error) throw new Error(error.message);
  refresh(parsed.locale, parsed.gameId);
}

export async function createTeam(formData: FormData) {
  const parsed = base.extend({
    roundId: z.string().uuid(),
    name: z.string().trim().min(1).max(60),
    openingCash: z.coerce.number().int().min(0),
  }).parse(Object.fromEntries(formData));
  const playerIds = z.array(z.string().uuid()).min(1).parse(formData.getAll("playerIds"));
  const supabase = await createClient();
  const { data: team, error } = await supabase.from("teams").insert({
    round_id: parsed.roundId,
    name: parsed.name,
  }).select("id").single();
  if (error) throw new Error(error.message);
  const { error: memberError } = await supabase.from("team_members").insert(
    playerIds.map((playerId) => ({ team_id: team.id, player_id: playerId })),
  );
  if (memberError) throw new Error(memberError.message);
  if (parsed.openingCash > 0) {
    const { error: fundingError } = await supabase.rpc("fund_team_wallet", {
      p_team_id: team.id,
      p_amount: parsed.openingCash * 100,
    });
    if (fundingError) throw new Error(fundingError.message);
  }
  refresh(parsed.locale, parsed.gameId);
}

export async function settleTeamDilemma(formData: FormData) {
  const parsed = base.extend({ teamId: z.string().uuid() }).parse(Object.fromEntries(formData));
  const supabase = await createClient();
  const { error } = await supabase.rpc("settle_team_dilemma", { p_team_id: parsed.teamId });
  if (error) throw new Error(error.message);
  refresh(parsed.locale, parsed.gameId);
}

export async function createMission(formData: FormData) {
  const parsed = base.extend({
    title: z.string().trim().min(2).max(100),
    instructions: z.string().trim().min(3).max(2000),
    reward: z.coerce.number().int().min(0),
    penalty: z.coerce.number().int().min(0),
    visibility: z.enum(["private", "team", "public"]),
    playerId: z.string().uuid().optional().or(z.literal("")),
    teamId: z.string().uuid().optional().or(z.literal("")),
  }).parse(Object.fromEntries(formData));
  const supabase = await createClient();
  const { data: mission, error } = await supabase.from("missions").insert({
    game_id: parsed.gameId,
    title: parsed.title,
    instructions: parsed.instructions,
    reward: parsed.reward * 100,
    penalty: parsed.penalty * 100,
    visibility: parsed.visibility,
    status: parsed.playerId || parsed.teamId ? "offered" : "draft",
  }).select("id").single();
  if (error) throw new Error(error.message);
  if (parsed.playerId || parsed.teamId) {
    const { error: assignmentError } = await supabase.from("mission_assignments").insert({
      mission_id: mission.id,
      player_id: parsed.playerId || null,
      team_id: parsed.playerId ? null : (parsed.teamId || null),
    });
    if (assignmentError) throw new Error(assignmentError.message);
  }
  refresh(parsed.locale, parsed.gameId);
}

export async function validateMission(formData: FormData) {
  const parsed = base.extend({
    missionId: z.string().uuid(),
    playerId: z.string().uuid(),
    result: z.enum(["approved", "failed"]),
  }).parse(Object.fromEntries(formData));
  const supabase = await createClient();
  const { error } = await supabase.rpc("resolve_mission", {
    p_mission_id: parsed.missionId,
    p_player_id: parsed.playerId,
    p_result: parsed.result,
  });
  if (error) throw new Error(error.message);
  refresh(parsed.locale, parsed.gameId);
}

export async function addHint(formData: FormData) {
  const parsed = base.extend({
    secretId: z.string().uuid(),
    text: z.string().trim().min(1).max(500),
    price: z.coerce.number().int().min(0),
  }).parse(Object.fromEntries(formData));
  const supabase = await createClient();
  const { count } = await supabase.from("hints").select("id", { count: "exact", head: true }).eq("secret_id", parsed.secretId);
  const { error } = await supabase.from("hints").insert({
    secret_id: parsed.secretId,
    kind: "text",
    text: parsed.text,
    default_price: parsed.price * 100,
    position: count ?? 0,
  });
  if (error) throw new Error(error.message);
  refresh(parsed.locale, parsed.gameId);
}

function checkedImage(value: FormDataEntryValue | null) {
  if (!(value instanceof File) || value.size === 0) throw new Error("image_required");
  if (value.size > 10 * 1024 * 1024 || !["image/jpeg", "image/png", "image/webp"].includes(value.type)) {
    throw new Error("invalid_image");
  }
  return value;
}

export async function addImageHint(formData: FormData) {
  const parsed = base.extend({
    secretId: z.string().uuid(),
    price: z.coerce.number().int().min(0),
  }).parse(Object.fromEntries(formData));
  const file = checkedImage(formData.get("image"));
  const supabase = await createClient();
  const { data: allowed } = await supabase.rpc("is_game_admin", { p_game_id: parsed.gameId });
  if (!allowed) throw new Error("forbidden");
  const { count } = await supabase.from("hints").select("id", { count: "exact", head: true }).eq("secret_id", parsed.secretId);
  const path = `games/${parsed.gameId}/hints/${crypto.randomUUID()}.${file.type.split("/")[1].replace("jpeg", "jpg")}`;
  const { error: uploadError } = await createAdminClient().storage.from("game-assets").upload(path, file, { contentType: file.type });
  if (uploadError) throw new Error(uploadError.message);
  const { error } = await supabase.from("hints").insert({
    secret_id: parsed.secretId,
    kind: "image",
    asset_path: path,
    default_price: parsed.price * 100,
    position: count ?? 0,
  });
  if (error) throw new Error(error.message);
  refresh(parsed.locale, parsed.gameId);
}

export async function uploadGameBackground(formData: FormData) {
  const parsed = base.parse(Object.fromEntries(formData));
  const file = checkedImage(formData.get("image"));
  const supabase = await createClient();
  const { data: allowed } = await supabase.rpc("is_game_admin", { p_game_id: parsed.gameId });
  if (!allowed) throw new Error("forbidden");
  const path = `games/${parsed.gameId}/background.${file.type.split("/")[1].replace("jpeg", "jpg")}`;
  const { error: uploadError } = await createAdminClient().storage.from("game-assets").upload(path, file, { upsert: true, contentType: file.type });
  if (uploadError) throw new Error(uploadError.message);
  const { error } = await supabase.from("games").update({ background_path: path }).eq("id", parsed.gameId);
  if (error) throw new Error(error.message);
  refresh(parsed.locale, parsed.gameId);
}

export async function replaceSecret(formData: FormData) {
  const parsed = base.extend({
    secretId: z.string().uuid(),
    value: z.string().trim().min(3).max(500),
    reason: z.string().trim().min(3).max(300),
  }).parse(Object.fromEntries(formData));
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_replace_secret", {
    p_secret_id: parsed.secretId,
    p_value: parsed.value,
    p_reason: parsed.reason,
  });
  if (error) throw new Error(error.message);
  refresh(parsed.locale, parsed.gameId);
}

export async function addSecretHolder(formData: FormData) {
  const parsed = base.extend({
    secretId: z.string().uuid(),
    playerId: z.string().uuid(),
  }).parse(Object.fromEntries(formData));
  const supabase = await createClient();
  const { error } = await supabase.rpc("add_secret_holder", {
    p_secret_id: parsed.secretId,
    p_player_id: parsed.playerId,
  });
  if (error) throw new Error(error.message);
  refresh(parsed.locale, parsed.gameId);
}

export async function publishEvent(formData: FormData) {
  const parsed = base.extend({
    title: z.string().trim().min(2).max(100),
    body: z.string().trim().max(1000).optional(),
    kind: z.enum(["announcement", "dilemma", "power", "surprise", "clue"]),
  }).parse(Object.fromEntries(formData));
  const supabase = await createClient();
  const { error } = await supabase.from("game_events").insert({
    game_id: parsed.gameId,
    title: parsed.title,
    body: parsed.body,
    kind: parsed.kind,
    is_public: true,
    published_at: new Date().toISOString(),
  });
  if (error) throw new Error(error.message);
  refresh(parsed.locale, parsed.gameId);
}

export async function assignPower(formData: FormData) {
  const parsed = base.extend({
    playerId: z.string().uuid(),
    kind: z.enum(["immunity", "double_vote", "free_hint", "buzz_shield"]),
  }).parse(Object.fromEntries(formData));
  const supabase = await createClient();
  const { error } = await supabase.from("player_powers").insert({
    player_id: parsed.playerId,
    kind: parsed.kind,
    config: {},
  });
  if (error) throw new Error(error.message);
  refresh(parsed.locale, parsed.gameId);
}

export async function setPlayerPlayStatus(formData: FormData) {
  const parsed = base.extend({
    playerId: z.string().uuid(),
    status: z.enum(["active", "eliminated"]),
  }).parse(Object.fromEntries(formData));
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_player_play_status", {
    p_game_id: parsed.gameId,
    p_player_id: parsed.playerId,
    p_status: parsed.status,
  });
  if (error) throw new Error(error.message);
  refresh(parsed.locale, parsed.gameId);
}

export async function adjustWallet(formData: FormData) {
  const parsed = base.extend({
    playerId: z.string().uuid(),
    amount: z.coerce.number().int().refine((value) => value !== 0),
    reason: z.string().trim().min(3).max(200),
  }).parse(Object.fromEntries(formData));
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_adjust_wallet", {
    p_game_id: parsed.gameId,
    p_player_id: parsed.playerId,
    p_amount: parsed.amount * 100,
    p_reason: parsed.reason,
    p_idempotency_key: `admin:${randomUUID()}`,
  });
  if (error) throw new Error(error.message);
  refresh(parsed.locale, parsed.gameId);
}

export async function undoTransaction(formData: FormData) {
  const parsed = base.extend({
    transactionId: z.string().uuid(),
    reason: z.string().trim().min(3).max(200),
  }).parse(Object.fromEntries(formData));
  const supabase = await createClient();
  const { error } = await supabase.rpc("reverse_ledger_transaction", {
    p_transaction_id: parsed.transactionId,
    p_reason: parsed.reason,
  });
  if (error) throw new Error(error.message);
  refresh(parsed.locale, parsed.gameId);
}

export async function createHouseSecret(formData: FormData) {
  const parsed = base.extend({
    answer: z.string().trim().min(3).max(500),
    mode: z.enum(["competitive", "cooperative", "hybrid"]),
    vault: z.coerce.number().int().min(0),
    attemptCost: z.coerce.number().int().min(0),
  }).parse(Object.fromEntries(formData));
  const supabase = await createClient();
  const { error } = await supabase.from("house_secrets").upsert({
    game_id: parsed.gameId,
    answer: parsed.answer,
    mode: parsed.mode,
    vault: parsed.vault * 100,
    attempt_cost: parsed.attemptCost * 100,
  }, { onConflict: "game_id" });
  if (error) throw new Error(error.message);
  refresh(parsed.locale, parsed.gameId);
}

export async function addHouseClue(formData: FormData) {
  const parsed = base.extend({
    houseSecretId: z.string().uuid(),
    chapter: z.coerce.number().int().min(1).max(100),
    text: z.string().trim().min(1).max(500),
    isDecoy: z.enum(["on"]).optional(),
  }).parse(Object.fromEntries(formData));
  const supabase = await createClient();
  const { error } = await supabase.from("house_secret_clues").insert({
    house_secret_id: parsed.houseSecretId,
    chapter: parsed.chapter,
    text: parsed.text,
    is_decoy: parsed.isDecoy === "on",
    released_at: new Date().toISOString(),
  });
  if (error) throw new Error(error.message);
  refresh(parsed.locale, parsed.gameId);
}

export async function castVote(formData: FormData) {
  const parsed = base.extend({
    roundId: z.string().uuid(),
    voterPlayerId: z.string().uuid(),
    targetPlayerId: z.string().uuid(),
    kind: z.enum(["nominate", "save", "finale"]),
  }).parse(Object.fromEntries(formData));
  const supabase = await createClient();
  const { error } = await supabase.from("ballots").upsert({
    round_id: parsed.roundId,
    voter_player_id: parsed.voterPlayerId,
    target_player_id: parsed.targetPlayerId,
    kind: parsed.kind,
    locked_at: new Date().toISOString(),
  }, { onConflict: "round_id,voter_player_id,kind" });
  if (error) throw new Error(error.message);
  refresh(parsed.locale, parsed.gameId);
}

export async function saveWinnerFormula(formData: FormData) {
  const parsed = base.extend({
    moneyWeight: z.coerce.number().min(0).max(10),
    protectedSecretBonus: z.coerce.number().int().min(0),
    houseSecretBonus: z.coerce.number().int().min(0),
    missionBonus: z.coerce.number().int().min(0),
    voteBonus: z.coerce.number().int().min(0),
  }).parse(Object.fromEntries(formData));
  const formula = winnerFormulaSchema.parse({
    moneyWeight: parsed.moneyWeight,
    protectedSecretBonus: parsed.protectedSecretBonus * 100,
    houseSecretBonus: parsed.houseSecretBonus * 100,
    missionBonus: parsed.missionBonus * 100,
    voteBonus: parsed.voteBonus * 100,
  });
  const supabase = await createClient();
  const { data: game } = await supabase.from("games").select("settings").eq("id", parsed.gameId).single();
  const settings = z.record(z.string(), z.unknown()).catch({}).parse(game?.settings);
  const { error } = await supabase.from("games").update({
    settings: { ...settings, winnerFormula: formula },
  }).eq("id", parsed.gameId);
  if (error) throw new Error(error.message);
  refresh(parsed.locale, parsed.gameId);
}
