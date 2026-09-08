"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { hashInviteToken, INVITE_DAYS, newInviteToken, normalizeEmail } from "@/lib/auth/invitations";
import { getUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

export type InviteState = { error?: string; inviteUrl?: string };

export async function createInvitation(
  _state: InviteState,
  formData: FormData,
): Promise<InviteState> {
  const parsed = z.object({
    organizationId: z.string().uuid(),
    gameId: z.string().uuid(),
    email: z.string().email(),
    locale: z.enum(["en", "fr"]),
  }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "invalid" };
  const user = await getUser();
  if (!user) return { error: "unauthorized" };
  const supabase = await createClient();
  const token = newInviteToken();
  const { error } = await supabase.from("organization_invitations").insert({
    organization_id: parsed.data.organizationId,
    game_id: parsed.data.gameId,
    email: normalizeEmail(parsed.data.email),
    role: "player",
    token_hash: hashInviteToken(token),
    invited_by: user.id,
    expires_at: new Date(Date.now() + INVITE_DAYS * 86400_000).toISOString(),
  });
  if (error) return { error: error.message };
  const origin = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  return { inviteUrl: `${origin}/${parsed.data.locale}/invite/${token}` };
}

export async function acceptInvitation(formData: FormData) {
  const parsed = z.object({
    token: z.string().min(20),
    locale: z.enum(["en", "fr"]),
  }).parse(Object.fromEntries(formData));
  const supabase = await createClient();
  const { error } = await supabase.rpc("accept_invitation", {
    p_token_hash: hashInviteToken(parsed.token),
  });
  if (error) throw new Error(error.message);
  revalidatePath(`/${parsed.locale}/games`);
  redirect(`/${parsed.locale}/games`);
}
