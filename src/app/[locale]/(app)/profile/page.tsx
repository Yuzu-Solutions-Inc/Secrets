import { Camera, LogOut, UserRound } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { signOut } from "@/app/actions/auth";
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
  const t = await getTranslations("profile");
  const user = await getUser();
  const supabase = await createClient();
  const { data: profile } = await supabase.from("profiles").select("*").eq("id", user!.id).single();

  return (
    <section className="mx-auto max-w-xl">
      <p className="font-bold uppercase tracking-widest text-pink-600">{t("eyebrow")}</p>
      <h1 className="display text-5xl font-black">{t("title")}</h1>
      <form action={updateProfile} className="bubble-card mt-7 space-y-6 p-6 sm:p-8">
        <div className="mx-auto size-28 overflow-hidden rounded-full bg-pink-100 text-pink-600">
          {profile?.avatar_path ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={`/api/assets/avatar/${user!.id}?v=${encodeURIComponent(String(profile.updated_at ?? ""))}`}
              alt={profile.display_name ?? t("picture")}
              className="size-full object-cover"
            />
          ) : (
            <span className="grid size-full place-items-center">
              <UserRound size={52} />
            </span>
          )}
        </div>
        <label className="block font-bold">
          {t("displayName")}
          <input className="field mt-2" name="displayName" defaultValue={profile?.display_name ?? ""} required />
        </label>
        <label className="block font-bold">
          <span className="flex items-center gap-2"><Camera size={18} /> {t("picture")}</span>
          <input className="field mt-2" name="avatar" type="file" accept="image/png,image/jpeg,image/webp" />
          <span className="mt-1 block text-xs font-normal text-[var(--muted)]">{t("pictureHint")}</span>
        </label>
        <label className="block font-bold">
          {t("email")}
          <input className="field mt-2 opacity-70" value={profile?.email ?? user?.email ?? ""} disabled />
        </label>
        <input type="hidden" name="locale" value={locale} />
        <button className="pill pill-primary w-full">{t("save")}</button>
      </form>
      <form action={signOut} className="mt-6 border-t border-pink-100 pt-6">
        <input type="hidden" name="locale" value={locale} />
        <button className="pill w-full bg-white text-pink-700">
          <LogOut size={18} /> {t("signOut")}
        </button>
      </form>
    </section>
  );
}
