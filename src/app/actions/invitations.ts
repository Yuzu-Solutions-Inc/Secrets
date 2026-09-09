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

export type AcceptInviteState = { error?: AcceptInviteError };

/** Known rejections raised by the `accept_invitation` Postgres function. */
export type AcceptInviteError =
  | "unauthorized"
  | "invalid_invitation"
  | "email_mismatch"
  | "late_join_closed"
  | "unknown";

const ACCEPT_INVITE_ERRORS: AcceptInviteError[] = [
  "unauthorized",
  "invalid_invitation",
  "email_mismatch",
  "late_join_closed",
];

export async function acceptInvitation(
  _state: AcceptInviteState,
  formData: FormData,
): Promise<AcceptInviteState> {
  const parsed = z
    .object({
      token: z.string().min(20),
      locale: z.enum(["en", "fr"]),
    })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "invalid_invitation" };

  const supabase = await createClient();
  const { error } = await supabase.rpc("accept_invitation", {
    p_token_hash: hashInviteToken(parsed.data.token),
  });
  if (error) {
    // These are expected outcomes (wrong email, game already started, …), not
    // crashes — surface them on the invite page instead of a bare 500.
    const known = ACCEPT_INVITE_ERRORS.find((code) => error.message.includes(code));
    return { error: known ?? "unknown" };
  }

  revalidatePath(`/${parsed.data.locale}/games`);
  redirect(`/${parsed.data.locale}/games`);
}
