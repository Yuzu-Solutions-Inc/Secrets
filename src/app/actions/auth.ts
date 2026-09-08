"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";

export type AuthState = { error?: string; success?: string };

const authSchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(8).max(128),
  displayName: z.string().trim().min(1).max(80).optional(),
  locale: z.enum(["en", "fr"]).default("fr"),
  mode: z.enum(["signin", "signup"]),
  next: z.string().startsWith("/").optional(),
});

export async function authenticate(
  _state: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const parsed = authSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    displayName: formData.get("displayName") || undefined,
    locale: formData.get("locale") || "fr",
    mode: formData.get("mode"),
    next: formData.get("next") || undefined,
  });
  if (!parsed.success) return { error: "invalid" };

  const supabase = await createClient();
  const { email, password, displayName, locale, mode, next } = parsed.data;
  const safeNext = next?.startsWith(`/${locale}/`) ? next : `/${locale}/games`;
  if (mode === "signup") {
    const origin = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { display_name: displayName, preferred_locale: locale },
        emailRedirectTo: `${origin}/auth/callback?next=${encodeURIComponent(safeNext)}`,
      },
    });
    return error ? { error: "invalid" } : { success: "check_email" };
  }

  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { error: "invalid" };
  redirect(safeNext as Parameters<typeof redirect>[0]);
}

export async function signInWithGoogle(formData: FormData) {
  const locale = formData.get("locale") === "en" ? "en" : "fr";
  const origin = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: `${origin}/auth/callback?next=/${locale}/games`,
    },
  });
  if (error || !data.url) redirect(`/${locale}/login?error=oauth`);
  redirect(data.url as Parameters<typeof redirect>[0]);
}

export async function requestPasswordReset(formData: FormData) {
  const email = z.string().email().safeParse(formData.get("email"));
  const locale = formData.get("locale") === "en" ? "en" : "fr";
  if (!email.success) redirect(`/${locale}/login?error=invalid`);
  const origin = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const supabase = await createClient();
  await supabase.auth.resetPasswordForEmail(email.data, {
    redirectTo: `${origin}/auth/callback?next=/${locale}/reset-password`,
  });
  redirect(`/${locale}/login?sent=reset`);
}

export async function signOut(formData: FormData) {
  const locale = formData.get("locale") === "en" ? "en" : "fr";
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect(`/${locale}`);
}

export async function updatePassword(formData: FormData) {
  const locale = formData.get("locale") === "en" ? "en" : "fr";
  const parsed = z.string().min(8).max(128).safeParse(formData.get("password"));
  if (!parsed.success) redirect(`/${locale}/reset-password?error=invalid`);
  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password: parsed.data });
  if (error) redirect(`/${locale}/reset-password?error=invalid`);
  redirect(`/${locale}/games`);
}
