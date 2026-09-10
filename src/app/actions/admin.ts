"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { dilemmaEffectsSchema, roundConfigSchema, winnerFormulaSchema } from "@/lib/game/rules";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { processImage } from "@/lib/images";

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
  const { data: existing } = await supabase
    .from("game_rounds")
    .select("id,kind,position")
    .eq("game_id", parsed.gameId)
    .order("position", { ascending: true });
  const rows = (existing ?? []) as { id: string; kind: string; position: number }[];
  const finale = rows.find((r) => r.kind === "finale");
  // The finale is a singleton and always the last round.
  if (parsed.kind === "finale" && finale) throw new Error("finale_exists");

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

  const maxPos = rows.reduce((m, r) => Math.max(m, Number(r.position)), -1);
  let position = maxPos + 1;
  if (parsed.kind !== "finale" && finale) {
    // Slot the new round into the finale's place and bump the finale past the
    // end so it stays last (dodging the game_id/position unique index).
    position = Number(finale.position);
    const { error: bump } = await supabase
      .from("game_rounds")
      .update({ position: maxPos + 1 })
      .eq("id", finale.id);
    if (bump) throw new Error(bump.message);
  }

  const { error } = await supabase.from("game_rounds").insert({
    game_id: parsed.gameId,
    title: parsed.title,
    kind: parsed.kind,
    position,
    config,
  });
  if (error) throw new Error(error.message);
  refresh(parsed.locale, parsed.gameId);
}

// Drag-to-reorder writes the whole round order at once (replaces the old
// up/down arrow control). The RPC keeps a finale pinned last.
export async function reorderRounds(formData: FormData) {
  const parsed = base.extend({ roundIds: z.string() }).parse(Object.fromEntries(formData));
  const roundIds = z.array(z.string().uuid()).min(1).parse(JSON.parse(parsed.roundIds));
  const supabase = await createClient();
  const { error } = await supabase.rpc("reorder_game_rounds", {
    p_game_id: parsed.gameId,
    p_round_ids: roundIds,
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

// Rounds page editor (item 4): edit a round's title + full config in place.
export async function updateRound(formData: FormData) {
  const parsed = base.extend({
    roundId: z.string().uuid(),
    title: z.string().trim().min(2).max(100),
    durationMinutes: z.coerce.number().int().positive().max(1440),
    walletMode: z.enum(["temporary_team", "pooled_personal", "personal"]),
    accusationBuzzEnabled: z.coerce.boolean(),
    hintBuzzEnabled: z.coerce.boolean(),
    accusationStake: z.coerce.number().int().nonnegative(),
    correctTransferPercent: z.coerce.number().int().min(0).max(100),
    hintPrice: z.coerce.number().int().nonnegative(),
    hintVisibility: z.enum(["private", "team", "public"]),
    completion: z.enum(["manual", "timer", "all_submitted"]),
  }).parse(Object.fromEntries(formData));
  const config = roundConfigSchema.parse({
    durationMinutes: parsed.durationMinutes,
    walletMode: parsed.walletMode,
    accusationBuzzEnabled: parsed.accusationBuzzEnabled,
    hintBuzzEnabled: parsed.hintBuzzEnabled,
    accusationStake: parsed.accusationStake * 100,
    correctTransferPercent: parsed.correctTransferPercent,
    hintPrice: parsed.hintPrice * 100,
    hintVisibility: parsed.hintVisibility,
    completion: parsed.completion,
  });
  const supabase = await createClient();
  const { data: allowed } = await supabase.rpc("is_game_admin", { p_game_id: parsed.gameId });
  if (!allowed) throw new Error("forbidden");
  const { error } = await supabase.from("game_rounds").update({ title: parsed.title, config }).eq("id", parsed.roundId);
  if (error) throw new Error(error.message);
  refresh(parsed.locale, parsed.gameId);
}

// Delete a not-yet-run round (server enforces "future only"; see the
// delete_game_round migration).
export async function deleteRound(formData: FormData) {
  const parsed = base.extend({ roundId: z.string().uuid() }).parse(Object.fromEntries(formData));
  const supabase = await createClient();
  const { error } = await supabase.rpc("delete_game_round", { p_round_id: parsed.roundId });
  if (error) throw new Error(error.message);
  refresh(parsed.locale, parsed.gameId);
}

export async function createTeam(formData: FormData) {
  const parsed = base.extend({
    name: z.string().trim().min(1).max(60),
    openingCash: z.coerce.number().int().min(0),
  }).parse(Object.fromEntries(formData));
  const playerIds = z.array(z.string().uuid()).min(1).parse(formData.getAll("playerIds"));
  const supabase = await createClient();
  const { data: team, error } = await supabase.from("teams").insert({
    game_id: parsed.gameId,
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
  if (error) {
    const fr = parsed.locale === "fr";
    if (error.message.includes("choices_incomplete")) {
      throw new Error(
        fr
          ? "Chaque membre doit d'abord choisir Partager ou Voler."
          : "Every member has to choose Share or Steal first.",
      );
    }
    throw new Error(fr ? "Le règlement du dilemme a échoué." : "Settling the dilemma didn't go through.");
  }
  refresh(parsed.locale, parsed.gameId);
}

// Replace a team's whole membership (item 1 — editable any time).
export async function setTeamMembers(formData: FormData) {
  const parsed = base.extend({ teamId: z.string().uuid() }).parse(Object.fromEntries(formData));
  const playerIds = z.array(z.string().uuid()).parse(formData.getAll("playerIds"));
  const supabase = await createClient();
  const { error: clearError } = await supabase.from("team_members").delete().eq("team_id", parsed.teamId);
  if (clearError) throw new Error(clearError.message);
  if (playerIds.length) {
    const { error } = await supabase.from("team_members").insert(
      playerIds.map((playerId) => ({ team_id: parsed.teamId, player_id: playerId })),
    );
    if (error) throw new Error(error.message);
  }
  refresh(parsed.locale, parsed.gameId);
}

export async function deleteTeam(formData: FormData) {
  const parsed = base.extend({ teamId: z.string().uuid() }).parse(Object.fromEntries(formData));
  const supabase = await createClient();
  const { error } = await supabase.from("teams").delete().eq("id", parsed.teamId);
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
    assignAll: z.coerce.boolean().optional(),
    // Optional countdown in minutes. Stored now, applied when the host presses
    // Start (start_mission sets deadline = now + timer_minutes). Missions still
    // close only when the host says so (item 9).
    timerMinutes: z.coerce.number().int().min(0).max(1440).optional().default(0),
  }).parse(Object.fromEntries(formData));
  const supabase = await createClient();
  // Missions are always created as a hidden draft — including pre-assigned
  // ones. The host reveals them to players later with `startMission`.
  const { data: mission, error } = await supabase.from("missions").insert({
    game_id: parsed.gameId,
    title: parsed.title,
    instructions: parsed.instructions,
    reward: parsed.reward * 100,
    penalty: parsed.penalty * 100,
    visibility: parsed.visibility,
    status: "draft",
    timer_minutes: parsed.timerMinutes,
  }).select("id").single();
  if (error) throw new Error(error.message);

  if (parsed.assignAll) {
    const { data: active } = await supabase.from("game_players").select("id").eq("game_id", parsed.gameId).eq("play_status", "active");
    const rows = (active ?? []).map((p) => ({ mission_id: mission.id, player_id: p.id as string, team_id: null }));
    if (rows.length) {
      const { error: assignmentError } = await supabase.from("mission_assignments").insert(rows);
      if (assignmentError) throw new Error(assignmentError.message);
    }
  } else if (parsed.playerId || parsed.teamId) {
    const { error: assignmentError } = await supabase.from("mission_assignments").insert({
      mission_id: mission.id,
      player_id: parsed.playerId || null,
      team_id: parsed.playerId ? null : (parsed.teamId || null),
    });
    if (assignmentError) throw new Error(assignmentError.message);
  }
  refresh(parsed.locale, parsed.gameId);
}

// Host flips a prepared draft mission live: players assigned to it (or anyone,
// if it is public) can now see it, and their phone shows a "new mission" dot.
export async function startMission(formData: FormData) {
  const parsed = base.extend({
    missionId: z.string().uuid(),
  }).parse(Object.fromEntries(formData));
  const supabase = await createClient();
  const { error } = await supabase.rpc("start_mission", { p_mission_id: parsed.missionId });
  if (error) throw new Error(error.message);
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

// Every hint costs the same — the price is set once in the base game settings
// (`hintPrice` in the round config) and applied by `buy_next_hint`. Hints
// therefore carry no per-hint price; `default_price` stays 0.
// One "Add hint" form now carries an optional text line and an optional image —
// either or both (item 7). Both filled => two ordered deck entries (text then
// image); the hint_kind enum stays single-valued so nothing downstream changes.
export async function addHint(formData: FormData) {
  const parsed = base.extend({
    secretId: z.string().uuid(),
    text: z.string().trim().max(500).optional().default(""),
  }).parse(Object.fromEntries(formData));
  const image = optionalImage(formData.get("image"));
  if (!parsed.text && !image) throw new Error("hint_needs_content");

  const supabase = await createClient();
  const { data: allowed } = await supabase.rpc("is_game_admin", { p_game_id: parsed.gameId });
  if (!allowed) throw new Error("forbidden");
  const { count } = await supabase.from("hints").select("id", { count: "exact", head: true }).eq("secret_id", parsed.secretId);

  // One deck entry, carrying text and/or an image (item 7). Renderers key off
  // which columns are set; `kind` stays 'text' whenever there is any text.
  let assetPath: string | null = null;
  if (image) {
    const { buffer, contentType } = await processImage(image, "hint");
    assetPath = `games/${parsed.gameId}/hints/${crypto.randomUUID()}.webp`;
    const { error: uploadError } = await createAdminClient().storage.from("game-assets").upload(assetPath, buffer, { contentType });
    if (uploadError) throw new Error(uploadError.message);
  }

  const { error } = await supabase.from("hints").insert({
    secret_id: parsed.secretId,
    kind: parsed.text ? "text" : "image",
    text: parsed.text || null,
    asset_path: assetPath,
    position: count ?? 0,
  });
  if (error) throw new Error(error.message);
  refresh(parsed.locale, parsed.gameId);
}

// Lightweight edit of a still-draft secret's text (host or the holder). Locked
// or revealed secrets must go through replaceSecret, which writes an audit row.
export async function editSecret(formData: FormData) {
  const parsed = base.extend({
    playerId: z.string().uuid(),
    value: z.string().trim().min(1).max(500),
  }).parse(Object.fromEntries(formData));
  const supabase = await createClient();
  const { error } = await supabase.rpc("submit_player_secret", {
    p_game_id: parsed.gameId,
    p_player_id: parsed.playerId,
    p_value: parsed.value,
  });
  if (error) throw new Error(error.message);
  refresh(parsed.locale, parsed.gameId);
}

export async function editHint(formData: FormData) {
  const parsed = base.extend({
    hintId: z.string().uuid(),
    text: z.string().trim().min(1).max(500),
  }).parse(Object.fromEntries(formData));
  const supabase = await createClient();
  const { data: allowed } = await supabase.rpc("is_game_admin", { p_game_id: parsed.gameId });
  if (!allowed) throw new Error("forbidden");
  const { error } = await supabase.from("hints").update({ text: parsed.text }).eq("id", parsed.hintId).eq("kind", "text");
  if (error) throw new Error(error.message);
  refresh(parsed.locale, parsed.gameId);
}

export async function deleteHint(formData: FormData) {
  const parsed = base.extend({
    hintId: z.string().uuid(),
  }).parse(Object.fromEntries(formData));
  const supabase = await createClient();
  const { data: allowed } = await supabase.rpc("is_game_admin", { p_game_id: parsed.gameId });
  if (!allowed) throw new Error("forbidden");
  const { error } = await supabase.from("hints").delete().eq("id", parsed.hintId);
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

// Like checkedImage but tolerates "no file chosen" — used where the image is
// one optional half of a form.
function optionalImage(value: FormDataEntryValue | null) {
  if (!(value instanceof File) || value.size === 0) return null;
  return checkedImage(value);
}

export async function uploadGameBackground(formData: FormData) {
  const parsed = base.parse(Object.fromEntries(formData));
  const file = checkedImage(formData.get("image"));
  const supabase = await createClient();
  const { data: allowed } = await supabase.rpc("is_game_admin", { p_game_id: parsed.gameId });
  if (!allowed) throw new Error("forbidden");
  const { buffer, contentType } = await processImage(file, "background");
  const path = `games/${parsed.gameId}/background.webp`;
  const { error: uploadError } = await createAdminClient().storage.from("game-assets").upload(path, buffer, { upsert: true, contentType });
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

// The Broadcast section (items 12-18). One entry point, four shapes.
// "surprise" is gone — it was "announcement" with another label.

// Announcement + Clue: a single public line for the whole room. They differ
// only in the dashboard sound/animation, keyed off `kind`.
export async function publishEvent(formData: FormData) {
  const parsed = base.extend({
    title: z.string().trim().min(2).max(200),
    body: z.string().trim().max(1000).optional(),
    kind: z.enum(["announcement", "clue"]),
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

// Dilemma: one sentence the targeted players Accept or Refuse on their phone.
// The host attaches effects that fire automatically on Accept
// (`apply_dilemma_effects`). The host reads the Accept/Refuse tally per dilemma.
export async function publishDilemma(formData: FormData) {
  const parsed = base.extend({
    prompt: z.string().trim().min(2).max(240),
    scope: z.enum(["all", "team", "player"]),
    isPublic: z.coerce.boolean(),
    teamId: z.string().uuid().optional().or(z.literal("")),
    playerId: z.string().uuid().optional().or(z.literal("")),
    effects: z.string().optional().default("[]"),
  }).parse(Object.fromEntries(formData));

  const effects = dilemmaEffectsSchema.parse(JSON.parse(parsed.effects || "[]"));
  // Store cash amounts in cents to match the rest of the ledger.
  const storedEffects = effects.map((effect) =>
    effect.type === "cash" ? { ...effect, amount: effect.amount * 100 } : effect,
  );

  const supabase = await createClient();
  const { error } = await supabase.from("game_events").insert({
    game_id: parsed.gameId,
    kind: "dilemma",
    title: parsed.prompt,
    is_public: parsed.isPublic,
    published_at: new Date().toISOString(),
    payload: {
      scope: parsed.scope,
      team_id: parsed.scope === "team" ? parsed.teamId || null : null,
      player_id: parsed.scope === "player" ? parsed.playerId || null : null,
      effects: storedEffects,
    },
  });
  if (error) throw new Error(error.message);
  refresh(parsed.locale, parsed.gameId);
}

// Power: granted to a player, a whole team, or everyone. `kind` is a seed key
// or free text ("other" — the host can invent one). Optionally announced on
// the dashboard.
export async function assignPower(formData: FormData) {
  const parsed = base.extend({
    scope: z.enum(["player", "team", "all"]),
    playerId: z.string().uuid().optional().or(z.literal("")),
    teamId: z.string().uuid().optional().or(z.literal("")),
    kind: z.string().trim().min(1).max(60),
    kindOther: z.string().trim().max(60).optional().default(""),
    isPublic: z.coerce.boolean(),
  }).parse(Object.fromEntries(formData));
  const kind = parsed.kind === "other" && parsed.kindOther ? parsed.kindOther : parsed.kind;
  const supabase = await createClient();

  let targetPlayerIds: string[] = [];
  if (parsed.scope === "player" && parsed.playerId) {
    targetPlayerIds = [parsed.playerId];
  } else if (parsed.scope === "team" && parsed.teamId) {
    const { data: members } = await supabase.from("team_members").select("player_id").eq("team_id", parsed.teamId);
    targetPlayerIds = (members ?? []).map((m) => m.player_id as string);
  } else if (parsed.scope === "all") {
    const { data: active } = await supabase.from("game_players").select("id").eq("game_id", parsed.gameId).eq("play_status", "active");
    targetPlayerIds = (active ?? []).map((p) => p.id as string);
  }
  if (!targetPlayerIds.length) throw new Error("no_power_target");

  const { error } = await supabase.from("player_powers").insert(
    targetPlayerIds.map((playerId) => ({ player_id: playerId, kind, config: {} })),
  );
  if (error) throw new Error(error.message);

  if (parsed.isPublic) {
    await supabase.from("game_events").insert({
      game_id: parsed.gameId,
      kind: "power",
      title: `Power granted: ${kind.replaceAll("_", " ")}`,
      is_public: true,
      published_at: new Date().toISOString(),
      payload: { scope: parsed.scope, kind },
    });
  }
  refresh(parsed.locale, parsed.gameId);
}

export async function setPlayerPlayStatus(formData: FormData) {
  const parsed = base.extend({
    playerId: z.string().uuid(),
    // "Deactivate" and "Eliminate" were merged into one reversible toggle:
    // a player is either `active` or `eliminated` (`spectator` is set by the
    // finale, not this control).
    status: z.enum(["active", "eliminated", "spectator"]),
  }).parse(Object.fromEntries(formData));
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_player_play_status", {
    p_game_id: parsed.gameId,
    p_player_id: parsed.playerId,
    p_status: parsed.status,
  });
  if (error) {
    // Surface the expected refusal from `set_player_play_status` as readable
    // text; the host sees this in a toast, not the error boundary.
    const message =
      error.message === "forbidden"
        ? "You don't have permission to change this player's status."
        : error.message;
    return { error: message };
  }
  refresh(parsed.locale, parsed.gameId);
  return { error: null };
}

// Host action: remove a player from the game entirely (and drop their invite so
// the shared link can't re-admit them). Only works while the player has no game
// history — otherwise the host is told to deactivate instead.
export async function removeGamePlayer(formData: FormData) {
  const parsed = base.extend({
    playerId: z.string().uuid(),
  }).parse(Object.fromEntries(formData));
  const supabase = await createClient();
  const { error } = await supabase.rpc("remove_game_player", {
    p_game_id: parsed.gameId,
    p_player_id: parsed.playerId,
  });
  if (error) {
    const message =
      error.message === "forbidden"
        ? "You don't have permission to remove this player."
        : error.message === "player_has_activity"
          ? "This player already has game history — deactivate them instead."
          : error.message === "not_found"
            ? "That player is no longer in the game."
            : error.message;
    return { error: message };
  }
  refresh(parsed.locale, parsed.gameId);
  return { error: null };
}

// Host action (Settings tab): permanently delete the whole game. The
// `delete_game` RPC is admin-gated; every game-scoped table cascades off
// games(id), so the row delete tears the game down completely.
export async function deleteGame(formData: FormData) {
  const parsed = base.parse(Object.fromEntries(formData));
  const supabase = await createClient();
  const { error } = await supabase.rpc("delete_game", { p_game_id: parsed.gameId });
  if (error) {
    const message =
      error.message === "forbidden"
        ? "You don't have permission to delete this game."
        : error.message === "not_found"
          ? "That game no longer exists."
          : error.message;
    return { error: message };
  }
  revalidatePath(`/${parsed.locale}/games`, "page");
  redirect(`/${parsed.locale}/games`);
}

// Host action: give every active player without a secret a random unused entry
// from the chosen secret bank category (item 21).
export async function fillBankSecrets(formData: FormData) {
  const parsed = base.parse(Object.fromEntries(formData));
  const supabase = await createClient();
  const { error } = await supabase.rpc("fill_bank_secrets", { p_game_id: parsed.gameId });
  if (error) throw new Error(error.message);
  refresh(parsed.locale, parsed.gameId);
}

export async function updateGameSettings(formData: FormData) {
  const parsed = base.extend({
    startingCash: z.coerce.number().int().min(0).max(100_000_000),
    accusationStake: z.coerce.number().int().min(0).max(100_000_000),
    hintPrice: z.coerce.number().int().min(0).max(100_000_000),
    language: z.enum(["en", "fr"]),
    location: z.string().trim().max(200).optional().default(""),
    startsAt: z.string().trim().optional().default(""),
    secretCategory: z.string().trim().max(40).optional().default("mixed"),
    houseSecretEnabled: z.enum(["on"]).optional(),
  }).parse(Object.fromEntries(formData));
  const supabase = await createClient();

  const { data: game } = await supabase
    .from("games")
    .select("settings")
    .eq("id", parsed.gameId)
    .single();
  const settings = (game?.settings ?? {}) as Record<string, unknown>;
  const accusationStake = parsed.accusationStake * 100;
  const hintPrice = parsed.hintPrice * 100;

  const { error } = await supabase
    .from("games")
    .update({
      starting_cash: parsed.startingCash * 100,
      starts_at: parsed.startsAt ? new Date(parsed.startsAt).toISOString() : null,
      settings: {
        ...settings,
        economy: { accusationStake, hintPrice },
        language: parsed.language,
        location: parsed.location || null,
        secretCategory: parsed.secretCategory || "mixed",
        houseSecret: {
          ...(settings.houseSecret as Record<string, unknown> | undefined),
          enabled: parsed.houseSecretEnabled === "on",
        },
      },
    })
    .eq("id", parsed.gameId);
  if (error) throw new Error(error.message);

  // The buzz / hint prices are a single game-wide value; every round
  // inherits it (matches how the host UI already reads one price).
  const { data: rounds } = await supabase
    .from("game_rounds")
    .select("id,config")
    .eq("game_id", parsed.gameId);
  for (const round of rounds ?? []) {
    const config = (round.config ?? {}) as Record<string, unknown>;
    await supabase
      .from("game_rounds")
      .update({ config: { ...config, accusationStake, hintPrice } })
      .eq("id", round.id as string);
  }
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

// House Secret clues are managed exactly like a secret's hints (item 7 shape):
// one entry carries optional text and/or an optional image, ordered by
// `position`. They are created HELD — never released on insert and never for
// sale. The host releases them one by one (`releaseHouseClue`) or lets
// `releaseRandomHouseClue` pick one.
export async function addHouseClue(formData: FormData) {
  const parsed = base.extend({
    houseSecretId: z.string().uuid(),
    text: z.string().trim().max(500).optional().default(""),
    isDecoy: z.enum(["on"]).optional(),
  }).parse(Object.fromEntries(formData));
  const image = optionalImage(formData.get("image"));
  if (!parsed.text && !image) throw new Error("clue_needs_content");

  const supabase = await createClient();
  const { data: game } = await supabase
    .from("house_secrets")
    .select("game_id")
    .eq("id", parsed.houseSecretId)
    .maybeSingle();
  if (!game) throw new Error("house_secret_not_found");
  const { data: allowed } = await supabase.rpc("is_game_admin", { p_game_id: parsed.gameId });
  if (!allowed) throw new Error("forbidden");

  const { count } = await supabase
    .from("house_secret_clues")
    .select("id", { count: "exact", head: true })
    .eq("house_secret_id", parsed.houseSecretId);

  let assetPath: string | null = null;
  if (image) {
    const { buffer, contentType } = await processImage(image, "hint");
    assetPath = `games/${parsed.gameId}/house-clues/${crypto.randomUUID()}.webp`;
    const { error: uploadError } = await createAdminClient().storage.from("game-assets").upload(assetPath, buffer, { contentType });
    if (uploadError) throw new Error(uploadError.message);
  }

  const { error } = await supabase.from("house_secret_clues").insert({
    house_secret_id: parsed.houseSecretId,
    position: count ?? 0,
    text: parsed.text || null,
    asset_path: assetPath,
    is_decoy: parsed.isDecoy === "on",
  });
  if (error) throw new Error(error.message);
  refresh(parsed.locale, parsed.gameId);
}

export async function editHouseClue(formData: FormData) {
  const parsed = base.extend({
    clueId: z.string().uuid(),
    text: z.string().trim().min(1).max(500),
  }).parse(Object.fromEntries(formData));
  const supabase = await createClient();
  const { data: allowed } = await supabase.rpc("is_game_admin", { p_game_id: parsed.gameId });
  if (!allowed) throw new Error("forbidden");
  const { error } = await supabase
    .from("house_secret_clues")
    .update({ text: parsed.text })
    .eq("id", parsed.clueId)
    .not("text", "is", null);
  if (error) throw new Error(error.message);
  refresh(parsed.locale, parsed.gameId);
}

export async function deleteHouseClue(formData: FormData) {
  const parsed = base.extend({
    clueId: z.string().uuid(),
  }).parse(Object.fromEntries(formData));
  const supabase = await createClient();
  const { data: allowed } = await supabase.rpc("is_game_admin", { p_game_id: parsed.gameId });
  if (!allowed) throw new Error("forbidden");
  const { error } = await supabase.from("house_secret_clues").delete().eq("id", parsed.clueId);
  if (error) throw new Error(error.message);
  refresh(parsed.locale, parsed.gameId);
}

// Release one specific held clue.
export async function releaseHouseClue(formData: FormData) {
  const parsed = base.extend({
    clueId: z.string().uuid(),
  }).parse(Object.fromEntries(formData));
  const supabase = await createClient();
  const { data: allowed } = await supabase.rpc("is_game_admin", { p_game_id: parsed.gameId });
  if (!allowed) throw new Error("forbidden");
  const { error } = await supabase
    .from("house_secret_clues")
    .update({ released_at: new Date().toISOString() })
    .eq("id", parsed.clueId)
    .is("released_at", null);
  if (error) throw new Error(error.message);
  refresh(parsed.locale, parsed.gameId);
}

// Release a random held clue — the house clue "drop" the host triggers instead
// of choosing which fragment comes next.
export async function releaseRandomHouseClue(formData: FormData) {
  const parsed = base.extend({
    houseSecretId: z.string().uuid(),
  }).parse(Object.fromEntries(formData));
  const supabase = await createClient();
  const { error } = await supabase.rpc("release_random_house_clue", {
    p_house_secret_id: parsed.houseSecretId,
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

// Finale rules (items 5 & 6): who gets into the finale, and how the winner is
// picked. Stored in games.settings.finale; consumed by the finale flow.
export async function saveFinaleConfig(formData: FormData) {
  const parsed = base.extend({
    entryMode: z.enum(["all_active", "top_n_by_balance", "top_n_by_score", "nominated", "manual"]),
    entryN: z.coerce.number().int().min(1).max(50).optional().default(3),
    resolutionMethod: z.enum(["formula", "box_exchange", "vote", "other"]),
    voteElectorate: z.enum(["finalists", "all_players", "eliminated_jury"]).optional().default("finalists"),
    voteTieBreak: z.enum(["most_money", "host_decides"]).optional().default("most_money"),
    boxAllSharePercent: z.coerce.number().int().min(0).max(100).optional().default(100),
    boxSingleStealerPercent: z.coerce.number().int().min(0).max(100).optional().default(60),
    boxMultiStealerPercent: z.coerce.number().int().min(0).max(100).optional().default(30),
    otherDescription: z.string().trim().max(500).optional().default(""),
  }).parse(Object.fromEntries(formData));

  const finale = {
    entry: { mode: parsed.entryMode, n: parsed.entryN },
    resolution:
      parsed.resolutionMethod === "vote"
        ? { method: "vote", electorate: parsed.voteElectorate, tieBreak: parsed.voteTieBreak }
        : parsed.resolutionMethod === "box_exchange"
          ? {
              method: "box_exchange",
              allSharePercent: parsed.boxAllSharePercent,
              singleStealerPercent: parsed.boxSingleStealerPercent,
              multipleStealersPercent: parsed.boxMultiStealerPercent,
            }
          : parsed.resolutionMethod === "other"
            ? { method: "other", description: parsed.otherDescription }
            : { method: "formula" },
  };

  const supabase = await createClient();
  const { data: game } = await supabase.from("games").select("settings").eq("id", parsed.gameId).single();
  const settings = z.record(z.string(), z.unknown()).catch({}).parse(game?.settings);
  const { error } = await supabase.from("games").update({
    settings: { ...settings, finale },
  }).eq("id", parsed.gameId);
  if (error) throw new Error(error.message);
  refresh(parsed.locale, parsed.gameId);
}

// Run the finale end to end (items 5 & 6): resolve_finale() picks the
// finalists, runs the configured method, records settings.finaleResult and
// completes the game.
export async function resolveFinale(formData: FormData) {
  const parsed = base.extend({
    winnerPlayerId: z.string().uuid().optional().or(z.literal("")),
    boxChoices: z.string().optional().default(""),
  }).parse(Object.fromEntries(formData));
  let boxChoices: unknown = null;
  if (parsed.boxChoices) {
    try {
      boxChoices = JSON.parse(parsed.boxChoices);
    } catch {
      throw new Error("invalid_box_choices");
    }
  }
  const supabase = await createClient();
  const { error } = await supabase.rpc("resolve_finale", {
    p_game_id: parsed.gameId,
    p_winner_player_id: parsed.winnerPlayerId || null,
    p_box_choices: boxChoices,
  });
  if (error) throw new Error(error.message);
  refresh(parsed.locale, parsed.gameId);
}
