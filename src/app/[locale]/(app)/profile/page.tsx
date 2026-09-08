import { Camera, UserRound } from "lucide-react";
import { setRequestLocale } from "next-intl/server";

import { updateProfile } from "@/app/actions/profile";
import { getUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

export default async function ProfilePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const user = await getUser();
  const supabase = await createClient();
  const { data: profile } = await supabase.from("profiles").select("*").eq("id", user!.id).single();

  return (
    <section className="mx-auto max-w-xl">
      <p className="font-bold uppercase tracking-widest text-pink-600">Player identity</p>
      <h1 className="display text-5xl font-black">Your profile</h1>
      <form action={updateProfile} className="bubble-card mt-7 space-y-6 p-6 sm:p-8">
        <div className="mx-auto grid size-28 place-items-center rounded-full bg-pink-100 text-pink-600">
          <UserRound size={52} />
        </div>
        <label className="block font-bold">
          Display name
          <input className="field mt-2" name="displayName" defaultValue={profile?.display_name ?? ""} required />
        </label>
        <label className="block font-bold">
          <span className="flex items-center gap-2"><Camera size={18} /> Profile picture</span>
          <input className="field mt-2" name="avatar" type="file" accept="image/png,image/jpeg,image/webp" />
          <span className="mt-1 block text-xs font-normal text-[var(--muted)]">PNG, JPEG or WebP · 5 MB maximum</span>
        </label>
        <label className="block font-bold">
          Email
          <input className="field mt-2 opacity-70" value={profile?.email ?? user?.email ?? ""} disabled />
        </label>
        <input type="hidden" name="locale" value={locale} />
        <button className="pill pill-primary w-full">Save profile</button>
      </form>
    </section>
  );
}
