import { Clock3, PartyPopper, Sparkles } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { createGame } from "@/app/actions/game";
import { getMemberships } from "@/lib/auth/session";

export default async function NewGamePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("games");
  const memberships = await getMemberships();
  const organizationId = memberships[0]?.organization_id as string | undefined;

  return (
    <section className="mx-auto max-w-2xl">
      <p className="font-bold uppercase tracking-widest text-pink-600">Game builder</p>
      <h1 className="display text-4xl font-black sm:text-5xl">{t("new")}</h1>
      <form action={createGame} className="bubble-card mt-7 space-y-6 p-6 sm:p-8">
        <input type="hidden" name="locale" value={locale} />
        <input type="hidden" name="organizationId" value={organizationId} />
        <label className="block font-bold">
          {t("name")}
          <input className="field mt-2" name="title" placeholder="The Pink House" required />
        </label>
        <fieldset>
          <legend className="font-bold">{t("format")}</legend>
          <div className="mt-2 grid gap-3 sm:grid-cols-3">
            {[
              ["quick", t("quick"), "3–4 h", PartyPopper],
              ["weekend", t("weekend"), "1–2 days", Clock3],
              ["custom", t("custom"), "You decide", Sparkles],
            ].map(([value, label, duration, Icon]) => {
              const FormatIcon = Icon as typeof Sparkles;
              return (
                <label key={String(value)} className="cursor-pointer rounded-2xl border border-pink-100 bg-white p-4 has-[:checked]:border-pink-500 has-[:checked]:bg-pink-50">
                  <input className="sr-only" type="radio" name="format" value={String(value)} defaultChecked={value === "quick"} />
                  <FormatIcon className="text-pink-600" />
                  <span className="mt-3 block font-black">{String(label)}</span>
                  <span className="text-sm text-[var(--muted)]">{String(duration)}</span>
                </label>
              );
            })}
          </div>
        </fieldset>
        <label className="block font-bold">
          {t("cash")}
          <input className="field mt-2" name="startingCash" type="number" min="0" defaultValue="10000" required />
        </label>
        <button className="pill pill-primary w-full" disabled={!organizationId}>
          <Sparkles size={18} /> {t("create")}
        </button>
      </form>
    </section>
  );
}
