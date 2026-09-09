"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { formatEconomy, gameFormats, roundTemplates } from "@/lib/game/templates";
import { roundConfigSchema } from "@/lib/game/rules";
import { getUser } from "@/lib/auth/session";
import { setActiveOrganizationId } from "@/lib/auth/active-org";
import { createClient } from "@/lib/supabase/server";

const localeSchema = z.enum(["en", "fr"]).default("fr");

async function actor() {
  const user = await getUser();
  if (!user) throw new Error("unauthorized");
  return user;
}

export type ActionState = { success: boolean; error: string | null };

// Map named exceptions raised by the Postgres RPCs to something a player can
// read. Anything unrecognised falls back to the supplied generic message
// instead of surfacing the raw error digest / crash page.
function friendlyRpcError(
  message: string,
  table: Record<string, string>,
  fallback: string,
): string {
  const hit = Object.keys(table).find((code) => message.includes(code));
  return hit ? table[hit] : fallback;
}

export type CreateOrganizationState = { error: string | null };

export async function createOrganization(
  _prevState: CreateOrganizationState,
  formData: FormData,
): Promise<CreateOrganizationState> {
  const parsed = z.object({
    name: z.string().trim().min(2).max(80),
    locale: localeSchema,
  }).safeParse({
    name: formData.get("name"),
    locale: formData.get("locale"),
  });
  if (!parsed.success) {
    return { error: "Please enter a group name between 2 and 80 characters." };
  }

  await actor();
  const supabase = await createClient();
  const slug = `${parsed.data.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}-${randomBytes(3).toString("hex")}`;
  const { data, error } = await supabase.rpc("create_organization", {
    p_name: parsed.data.name,
    p_slug: slug,
    p_locale: parsed.data.locale,
  });

  if (error) {
    if (error.message.includes("user_already_has_organization")) {
      return { error: "You already have a game group. Refreshing…" };
    }
    return { error: "Something went wrong creating your group. Please try again." };
  }

  await setActiveOrganizationId(String(data));
  // Without this, Next.js serves the stale cached /games page after the
  // redirect below, which still shows the "create your group" empty state —
  // making it look like the click did nothing.
  revalidatePath(`/${parsed.data.locale}/games`);
  redirect(`/${parsed.data.locale}/games`);
}

export async function createGame(formData: FormData) {
  const parsed = z.object({
    organizationId: z.string().uuid(),
    title: z.string().trim().min(2).max(100),
    format: z.enum(["quick", "weekend", "custom"]),
    secretCategory: z.string().trim().max(40).optional().default("mixed"),
    locale: localeSchema,
  }).parse({
    organizationId: formData.get("organizationId"),
    title: formData.get("title"),
    format: formData.get("format"),
    secretCategory: formData.get("secretCategory"),
    locale: formData.get("locale"),
  });
  const user = await actor();
  const supabase = await createClient();
  const code = randomBytes(4).toString("hex").toUpperCase();

  // The chosen format is a template: it decides the economy and the round
  // set. Everything here is editable afterwards in the game's Settings tab.
  const economy = formatEconomy[parsed.format];
  const accusationStake = economy.accusationStake * 100;
  const hintPrice = economy.hintPrice * 100;

  const { data: game, error } = await supabase
    .from("games")
    .insert({
      organization_id: parsed.organizationId,
      title: parsed.title,
      format: parsed.format,
      starting_cash: economy.startingCash * 100,
      public_code: code,
      created_by: user.id,
      settings: {
        economy: { accusationStake, hintPrice },
        language: parsed.locale,
        secretCategory: parsed.secretCategory || "mixed",
      },
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);

  await supabase.from("game_players").insert({ game_id: game.id, user_id: user.id });
  const keys = gameFormats[parsed.format];
  if (keys.length) {
    // Anchor the schedule on "now" and lay rounds back to back; the host
    // shifts them on the Rounds page.
    let cursor = Date.now();
    const rows = keys.map((key, position) => {
      const template = roundTemplates.find((item) => item.key === key)!;
      const config = roundConfigSchema.parse({
        ...template.config,
        accusationStake,
        hintPrice,
      });
      const startsAt = new Date(cursor);
      cursor += config.durationMinutes * 60_000;
      return {
        game_id: game.id,
        title: template.title[parsed.locale],
        kind: template.kind,
        position,
        config,
        starts_at: startsAt.toISOString(),
        ends_at: new Date(cursor).toISOString(),
      };
    });
    const { error: roundsError } = await supabase.from("game_rounds").insert(rows);
    if (roundsError) throw new Error(roundsError.message);
  }
  redirect(`/${parsed.locale}/games/${game.id}/host`);
}

export type SubmitSecretState = { success: boolean; error: string | null };

export async function submitSecret(
  _prevState: SubmitSecretState,
  formData: FormData,
): Promise<SubmitSecretState> {
  const parsed = z.object({
    gameId: z.string().uuid(),
    playerId: z.string().uuid(),
    value: z.string().trim().min(3).max(500),
    locale: localeSchema,
  }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { success: false, error: "Your secret needs to be between 3 and 500 characters." };
  }
  const supabase = await createClient();
  const { error } = await supabase.rpc("submit_player_secret", {
    p_game_id: parsed.data.gameId,
    p_player_id: parsed.data.playerId,
    p_value: parsed.data.value,
  });
  if (error) {
    if (error.message.includes("secrets_locked")) {
      return { success: false, error: "Secrets are already locked for this game — it's too late to change yours." };
    }
    return { success: false, error: "Something went wrong saving your secret. Please try again." };
  }
  revalidatePath(`/${parsed.data.locale}/games/${parsed.data.gameId}`);
  revalidatePath(`/${parsed.data.locale}/games/${parsed.data.gameId}/host`, "page");
  return { success: true, error: null };
}

export async function accusationBuzz(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = z.object({
    gameId: z.string().uuid(),
    targetPlayerId: z.string().uuid(),
    theory: z.string().trim().min(3).max(500),
    locale: localeSchema,
  }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { success: false, error: "Pick a player and write a theory of 3 to 500 characters." };
  }
  const supabase = await createClient();
  const { error } = await supabase.rpc("create_accusation_buzz", {
    p_game_id: parsed.data.gameId,
    p_target_player_id: parsed.data.targetPlayerId,
    p_theory: parsed.data.theory,
  });
  if (error) {
    return {
      success: false,
      error: friendlyRpcError(error.message, {
        game_not_live: "Accusations open once the host starts a live round.",
        invalid_target: "Choose a different player to accuse.",
        insufficient_funds: "You can't cover the accusation stake right now.",
        secret_revealed: "That player's secret is already out — no accusation needed.",
      }, "Your accusation didn't go through. Please try again."),
    };
  }
  revalidatePath(`/${parsed.data.locale}/games/${parsed.data.gameId}`);
  return { success: true, error: null };
}

export async function stageAccusationBuzz(formData: FormData) {
  const parsed = z.object({
    gameId: z.string().uuid(),
    buzzId: z.string().uuid(),
    status: z.enum(["confrontation", "confirmed", "retracted"]),
    locale: localeSchema,
  }).parse(Object.fromEntries(formData));
  const supabase = await createClient();
  const { error } = await supabase.rpc("stage_accusation_buzz", {
    p_buzz_id: parsed.buzzId,
    p_status: parsed.status,
  });
  if (error) throw new Error(error.message);
  revalidatePath(`/${parsed.locale}/games/${parsed.gameId}`, "layout");
  revalidatePath(`/${parsed.locale}/games/${parsed.gameId}/host`, "page");
}

export async function buyHint(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = z.object({
    gameId: z.string().uuid(),
    targetPlayerId: z.string().uuid(),
    locale: localeSchema,
  }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { success: false, error: "Choose a player to buy a hint about." };
  }
  const supabase = await createClient();
  const { error } = await supabase.rpc("buy_next_hint", {
    p_game_id: parsed.data.gameId,
    p_target_player_id: parsed.data.targetPlayerId,
  });
  if (error) {
    return {
      success: false,
      error: friendlyRpcError(error.message, {
        game_not_live: "Hint buzzes open once the host starts a live round.",
        invalid_target: "Choose a different player.",
        insufficient_funds: "You can't cover the hint price right now.",
        no_hints_left: "There are no more hints to buy about that player.",
      }, "The hint buzz didn't go through. Please try again."),
    };
  }
  revalidatePath(`/${parsed.data.locale}/games/${parsed.data.gameId}`);
  return { success: true, error: null };
}

export async function setDilemmaChoice(formData: FormData) {
  const parsed = z.object({
    teamId: z.string().uuid(),
    playerId: z.string().uuid(),
    gameId: z.string().uuid(),
    choice: z.enum(["share", "steal"]),
    locale: localeSchema,
  }).parse(Object.fromEntries(formData));
  const supabase = await createClient();
  const { error } = await supabase
    .from("team_members")
    .update({
      dilemma_choice: parsed.choice,
      dilemma_locked_at: new Date().toISOString(),
    })
    .eq("team_id", parsed.teamId)
    .eq("player_id", parsed.playerId);
  if (error) throw new Error(error.message);
  revalidatePath(`/${parsed.locale}/games/${parsed.gameId}`);
}

// A player's answer to a broadcast dilemma (item 14). Upserts their single
// row in game_event_responses; the host reads the stack.
export async function submitDilemmaChoice(formData: FormData) {
  const parsed = z.object({
    gameId: z.string().uuid(),
    eventId: z.string().uuid(),
    playerId: z.string().uuid(),
    choice: z.enum(["option_1", "option_2"]),
    locale: localeSchema,
  }).parse(Object.fromEntries(formData));
  const supabase = await createClient();
  const { error } = await supabase
    .from("game_event_responses")
    .upsert(
      { game_event_id: parsed.eventId, player_id: parsed.playerId, choice: parsed.choice, updated_at: new Date().toISOString() },
      { onConflict: "game_event_id,player_id" },
    );
  if (error) throw new Error(error.message);
  revalidatePath(`/${parsed.locale}/games/${parsed.gameId}`);
}

export async function hostTransition(formData: FormData) {
  const parsed = z.object({
    gameId: z.string().uuid(),
    action: z.enum(["lock_secrets", "next_round", "prev_round", "pause", "resume", "finale", "complete"]),
    locale: localeSchema,
  }).parse(Object.fromEntries(formData));
  const supabase = await createClient();
  const { error } = await supabase.rpc("host_transition", {
    p_game_id: parsed.gameId,
    p_action: parsed.action,
  });
  if (error) throw new Error(error.message);
  revalidatePath(`/${parsed.locale}/games/${parsed.gameId}`, "layout");
  revalidatePath(`/${parsed.locale}/games/${parsed.gameId}/host`, "page");
}

export async function adjudicateBuzz(formData: FormData) {
  const parsed = z.object({
    gameId: z.string().uuid(),
    buzzId: z.string().uuid(),
    result: z.enum(["correct", "partial", "wrong", "cancelled"]),
    locale: localeSchema,
  }).parse(Object.fromEntries(formData));
  const supabase = await createClient();
  const { error } = await supabase.rpc("resolve_accusation_buzz", {
    p_buzz_id: parsed.buzzId,
    p_result: parsed.result,
  });
  if (error) throw new Error(error.message);
  revalidatePath(`/${parsed.locale}/games/${parsed.gameId}`, "layout");
  revalidatePath(`/${parsed.locale}/games/${parsed.gameId}/host`, "page");
}

export async function createHintOffer(formData: FormData) {
  const parsed = z.object({
    gameId: z.string().uuid(),
    hintId: z.string().uuid(),
    buyerPlayerId: z.string().uuid(),
    price: z.coerce.number().int().positive(),
    locale: localeSchema,
  }).parse(Object.fromEntries(formData));
  const supabase = await createClient();
  const { error } = await supabase.rpc("create_hint_offer", {
    p_game_id: parsed.gameId,
    p_hint_id: parsed.hintId,
    p_buyer_player_id: parsed.buyerPlayerId,
    p_price: parsed.price * 100,
  });
  if (error) throw new Error(error.message);
  revalidatePath(`/${parsed.locale}/games/${parsed.gameId}`);
}

export async function shareHint(formData: FormData) {
  const parsed = z.object({
    gameId: z.string().uuid(),
    hintId: z.string().uuid(),
    recipientPlayerId: z.string().uuid(),
    locale: localeSchema,
  }).parse(Object.fromEntries(formData));
  const supabase = await createClient();
  const { error } = await supabase.rpc("share_hint", {
    p_game_id: parsed.gameId,
    p_hint_id: parsed.hintId,
    p_recipient_player_id: parsed.recipientPlayerId,
  });
  if (error) throw new Error(error.message);
  revalidatePath(`/${parsed.locale}/games/${parsed.gameId}`);
}

export async function resolveHintOffer(formData: FormData) {
  const parsed = z.object({
    gameId: z.string().uuid(),
    offerId: z.string().uuid(),
    accept: z.enum(["true", "false"]).transform((value) => value === "true"),
    locale: localeSchema,
  }).parse(Object.fromEntries(formData));
  const supabase = await createClient();
  const { error } = await supabase.rpc("resolve_hint_offer", {
    p_offer_id: parsed.offerId,
    p_accept: parsed.accept,
  });
  if (error) throw new Error(error.message);
  revalidatePath(`/${parsed.locale}/games/${parsed.gameId}`);
}

export async function saveTheoryNote(formData: FormData) {
  const parsed = z.object({
    gameId: z.string().uuid(),
    playerId: z.string().uuid(),
    body: z.string().trim().min(1).max(3000),
    locale: localeSchema,
  }).parse(Object.fromEntries(formData));
  const supabase = await createClient();
  const { error } = await supabase.from("theory_notes").insert({
    game_id: parsed.gameId,
    player_id: parsed.playerId,
    body: parsed.body,
  });
  if (error) throw new Error(error.message);
  revalidatePath(`/${parsed.locale}/games/${parsed.gameId}`);
}

// Fetches the caller's own secret text on demand. Kept off the page payload so
// the value only travels after the deliberate reveal taps in the Vault.
export async function revealMySecret(gameId: string): Promise<string | null> {
  const id = z.string().uuid().parse(gameId);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("my_secret", { p_game_id: id });
  if (error) throw new Error(error.message);
  return (data as string | null) ?? null;
}

// Upserts (or clears) the caller's private note about one other player.
export async function savePlayerNote(formData: FormData) {
  const parsed = z.object({
    gameId: z.string().uuid(),
    playerId: z.string().uuid(),
    targetPlayerId: z.string().uuid(),
    body: z.string().trim().max(3000),
    locale: localeSchema,
  }).parse(Object.fromEntries(formData));
  const supabase = await createClient();
  if (parsed.body.length === 0) {
    const { error } = await supabase
      .from("theory_notes")
      .delete()
      .eq("game_id", parsed.gameId)
      .eq("player_id", parsed.playerId)
      .eq("target_player_id", parsed.targetPlayerId);
    if (error) throw new Error(error.message);
  } else {
    const { error } = await supabase
      .from("theory_notes")
      .upsert(
        {
          game_id: parsed.gameId,
          player_id: parsed.playerId,
          target_player_id: parsed.targetPlayerId,
          body: parsed.body,
        },
        { onConflict: "game_id,player_id,target_player_id" },
      );
    if (error) throw new Error(error.message);
  }
  revalidatePath(`/${parsed.locale}/games/${parsed.gameId}`);
}

// Upserts (or clears) the caller's private comment on the House Secret. Mirrors
// savePlayerNote, keyed on the house secret instead of a target player.
export async function saveHouseNote(formData: FormData) {
  const parsed = z.object({
    gameId: z.string().uuid(),
    playerId: z.string().uuid(),
    houseSecretId: z.string().uuid(),
    body: z.string().trim().max(3000),
    locale: localeSchema,
  }).parse(Object.fromEntries(formData));
  const supabase = await createClient();
  if (parsed.body.length === 0) {
    const { error } = await supabase
      .from("theory_notes")
      .delete()
      .eq("game_id", parsed.gameId)
      .eq("player_id", parsed.playerId)
      .eq("target_house_secret_id", parsed.houseSecretId);
    if (error) throw new Error(error.message);
  } else {
    const { error } = await supabase
      .from("theory_notes")
      .upsert(
        {
          game_id: parsed.gameId,
          player_id: parsed.playerId,
          target_house_secret_id: parsed.houseSecretId,
          body: parsed.body,
        },
        { onConflict: "game_id,player_id,target_house_secret_id" },
      );
    if (error) throw new Error(error.message);
  }
  revalidatePath(`/${parsed.locale}/games/${parsed.gameId}`);
}

export async function submitMission(formData: FormData) {
  const parsed = z.object({
    gameId: z.string().uuid(),
    missionId: z.string().uuid(),
    playerId: z.string().uuid(),
    locale: localeSchema,
  }).parse(Object.fromEntries(formData));
  const supabase = await createClient();
  const { error } = await supabase.rpc("submit_mission", {
    p_mission_id: parsed.missionId,
    p_player_id: parsed.playerId,
  });
  if (error) throw new Error(error.message);
  revalidatePath(`/${parsed.locale}/games/${parsed.gameId}`);
}

// Player acknowledges a freshly started mission. Fire-and-forget from the
// dashboard so the "new mission" indicator does not come back on other devices.
export async function markMissionSeen(formData: FormData) {
  const parsed = z.object({
    gameId: z.string().uuid(),
    missionId: z.string().uuid(),
    playerId: z.string().uuid(),
    locale: localeSchema,
  }).parse(Object.fromEntries(formData));
  const supabase = await createClient();
  const { error } = await supabase.rpc("mark_mission_seen", {
    p_mission_id: parsed.missionId,
    p_player_id: parsed.playerId,
  });
  if (error) throw new Error(error.message);
  revalidatePath(`/${parsed.locale}/games/${parsed.gameId}`);
}

export async function submitHouseTheory(formData: FormData) {
  const parsed = z.object({
    gameId: z.string().uuid(),
    houseSecretId: z.string().uuid(),
    playerId: z.string().uuid(),
    theory: z.string().trim().min(3).max(500),
    locale: localeSchema,
  }).parse(Object.fromEntries(formData));
  const supabase = await createClient();
  const { error } = await supabase.from("house_secret_submissions").insert({
    house_secret_id: parsed.houseSecretId,
    player_id: parsed.playerId,
    theory: parsed.theory,
  });
  if (error) throw new Error(error.message);
  revalidatePath(`/${parsed.locale}/games/${parsed.gameId}`);
}
