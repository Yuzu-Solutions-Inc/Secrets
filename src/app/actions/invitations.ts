"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { normalizeEmail } from "@/lib/auth/invitations";
import { getUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

export type WhitelistState = { error?: string };

// Host adds an email to a game's allow-list. The join link is the same for
// everyone; only listed emails can actually join (item 2).
export async function addToWhitelist(
  _state: WhitelistState,
  formData: FormData,
): Promise<WhitelistState> {
  const parsed = z.object({
    gameId: z.string().uuid(),
    email: z.string().email(),
    locale: z.enum(["en", "fr"]),
  }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "invalid" };
  const user = await getUser();
  if (!user) return { error: "unauthorized" };

  const supabase = await createClient();
  const { error } = await supabase.from("game_whitelist").upsert(
    {
      game_id: parsed.data.gameId,
      email: normalizeEmail(parsed.data.email),
      added_by: user.id,
    },
    { onConflict: "game_id,email", ignoreDuplicates: true },
  );
  if (error) return { error: error.message };
  revalidatePath(`/${parsed.data.locale}/games/${parsed.data.gameId}/host`);
  return {};
}

export async function removeFromWhitelist(formData: FormData) {
  const parsed = z.object({
    id: z.string().uuid(),
    gameId: z.string().uuid(),
    locale: z.enum(["en", "fr"]),
  }).parse(Object.fromEntries(formData));
  const supabase = await createClient();
  const { error } = await supabase.from("game_whitelist").delete().eq("id", parsed.id);
  if (error) throw new Error(error.message);
  revalidatePath(`/${parsed.locale}/games/${parsed.gameId}/host`);
}

export type JoinGameError =
  | "unauthorized"
  | "invalid_link"
  | "not_whitelisted"
  | "late_join_closed"
  | "unknown";

const JOIN_ERRORS: JoinGameError[] = ["unauthorized", "invalid_link", "not_whitelisted", "late_join_closed"];

export type JoinGameState = { error?: JoinGameError };

export async function joinGame(
  _state: JoinGameState,
  formData: FormData,
): Promise<JoinGameState> {
  const parsed = z.object({
    token: z.string().min(8),
    locale: z.enum(["en", "fr"]),
  }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "invalid_link" };

  const supabase = await createClient();
  const { error } = await supabase.rpc("join_game", { p_token: parsed.data.token });
  if (error) {
    const known = JOIN_ERRORS.find((code) => error.message.includes(code));
    return { error: known ?? "unknown" };
  }
  revalidatePath(`/${parsed.data.locale}/games`);
  redirect(`/${parsed.data.locale}/games`);
}
