"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { gameFormats, roundTemplates } from "@/lib/game/templates";
import { roundConfigSchema } from "@/lib/game/rules";
import { getUser } from "@/lib/auth/session";
import { setActiveOrganizationId } from "@/lib/auth/active-org";
import { createAdminClient } from "@/lib/supabase/admin";
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

const ADVANCED_ROUND_KINDS = new Set(["event", "nomination", "elimination"]);

export async function createGame(formData: FormData) {
  const checkbox = (name: string) => formData.get(name) === "on";
  const parsed = z.object({
    organizationId: z.string().uuid(),
    title: z.string().trim().min(2).max(100),
    format: z.enum(["quick", "weekend", "custom"]),
    startingCash: z.coerce.number().int().min(0).max(100_000_000),
    locale: localeSchema,
    tier: z.enum(["free", "pro"]).default("free"),
  }).parse({
    organizationId: formData.get("organizationId"),
    title: formData.get("title"),
    format: formData.get("format"),
    startingCash: formData.get("startingCash"),
    locale: formData.get("locale"),
    tier: formData.get("tier"),
  });
  await actor();
  const supabase = await createClient();
  const code = randomBytes(4).toString("hex").toUpperCase();

  const isPro = parsed.tier === "pro";
  const features = {
    sharedSecrets: isPro && checkbox("feat_sharedSecrets"),
    secretReplacement: isPro && checkbox("feat_secretReplacement"),
    imageHints: isPro && checkbox("feat_imageHints"),
    teamMissions: isPro && checkbox("feat_teamMissions"),
    publicMissions: isPro && checkbox("feat_publicMissions"),
    advancedRounds: isPro && checkbox("feat_advancedRounds"),
  };
  // create_game() clamps everything server-side; format is only honoured for Pro.
  const format = isPro ? parsed.format : "quick";

  const { data: gameId, error } = await supabase.rpc("create_game", {
    p_org: parsed.organizationId,
    p_title: parsed.title,
    p_format: format,
    p_starting_cash: parsed.startingCash * 100,
    p_locale: parsed.locale,
    p_code: code,
    p_requested_tier: parsed.tier,
    p_features: features,
  });
  if (error) {
    if (error.message.includes("pro_entitlement_required")) {
      redirect(`/${parsed.locale}/billing?need=pro`);
    }
    throw new Error(error.message);
  }

  const keys = gameFormats[format];
  if (keys.length) {
    const rows = keys
      .map((key) => roundTemplates.find((item) => item.key === key)!)
      .filter((template) => features.advancedRounds || !ADVANCED_ROUND_KINDS.has(template.kind))
      .map((template, position) => ({
        game_id: gameId,
        title: template.title[parsed.locale],
        kind: template.kind,
        position,
        config: roundConfigSchema.parse(template.config),
      }));
    if (rows.length) {
      const { error: roundsError } = await supabase.from("game_rounds").insert(rows);
      if (roundsError) throw new Error(roundsError.message);
    }
  }
  redirect(`/${parsed.locale}/games/${gameId}/host`);
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

export async function hostTransition(formData: FormData) {
  const parsed = z.object({
    gameId: z.string().uuid(),
    action: z.enum(["lock_secrets", "next_round", "pause", "resume", "finale", "complete"]),
    locale: localeSchema,
  }).parse(Object.fromEntries(formData));
  const supabase = await createClient();
  const { error } = await supabase.rpc("host_transition", {
    p_game_id: parsed.gameId,
    p_action: parsed.action,
  });
  if (error) {
    if (error.message.includes("pro_entitlement_required")) {
      redirect(`/${parsed.locale}/billing?need=pro`);
    }
    throw new Error(error.message);
  }
  if (parsed.action === "next_round") {
    await maybeNotifyBillingReview(parsed.gameId);
  }
  revalidatePath(`/${parsed.locale}/games/${parsed.gameId}`, "layout");
  revalidatePath(`/${parsed.locale}/games/${parsed.gameId}/host`, "page");
}

// Fires an optional outbound alert when a Pro-Unlimited host crosses a
// game-count milestone (rows are queued by consume_pro_game_start). The
// billing_review_queue row is the durable record; this is best-effort.
async function maybeNotifyBillingReview(gameId: string) {
  // billing_review_queue is service-role only; the host_transition RPC already
  // authorised this caller as the game admin.
  const admin = createAdminClient();
  const { data } = await admin
    .from("billing_review_queue")
    .select("id, user_id, milestone, pro_games_started")
    .eq("game_id", gameId)
    .is("notified_at", null);
  if (!data?.length) return;

  const webhookUrl = process.env.BILLING_ALERT_WEBHOOK_URL;
  for (const row of data) {
    if (webhookUrl) {
      try {
        await fetch(webhookUrl, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            text: `Secrets billing review: host ${row.user_id} started their ${row.milestone}th Pro game (total ${row.pro_games_started}). Check billing_review_queue for possible account sharing.`,
            gameId,
            userId: row.user_id,
            milestone: row.milestone,
          }),
        });
      } catch {
        // Best-effort only — the queue row stays for manual review.
      }
    }
    await admin.from("billing_review_queue").update({ notified_at: new Date().toISOString() }).eq("id", row.id);
  }
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
