import { ArrowRight, CalendarClock, Plus, Settings2, Sparkles } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { CreateOrganizationForm } from "./create-organization-form";
import { getMemberships } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

export default async function GamesPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("games");
  const tStatus = await getTranslations("gameStatus");
  const memberships = await getMemberships();

  if (!memberships.length) {
    return (
      <section className="mx-auto max-w-lg py-12">
        <div className="bubble-card p-7">
          <Sparkles className="text-pink-600" />
          <h1 className="display mt-4 text-4xl font-black">{t("orgTitle")}</h1>
          <p className="mt-2 leading-7 text-[var(--muted)]">{t("orgBlurb")}</p>
          <CreateOrganizationForm locale={locale} label={t("create")} />
        </div>
      </section>
    );
  }

  const organizationId = memberships[0].organization_id as string;
  const isOrgAdmin = memberships[0].role === "admin";
  const supabase = await createClient();
  const { data: games } = await supabase
    .from("games")
    .select("id,title,status,format,public_code,updated_at")
    .eq("organization_id", organizationId)
    .order("updated_at", { ascending: false });

  return (
    <section>
      <div className="flex items-end justify-between gap-4">
        <div>
          <p className="font-bold uppercase tracking-widest text-pink-600">{t("playTogether")}</p>
          <h1 className="display text-4xl font-black sm:text-5xl">{t("title")}</h1>
        </div>
        <a className="pill pill-primary hidden sm:inline-flex" href={`/${locale}/games/new`}>
          <Plus size={18} /> {t("new")}
        </a>
      </div>

      {!games?.length ? (
        <div className="bubble-card mt-8 p-8 text-center">
          <Sparkles className="mx-auto text-pink-500" size={38} />
          <p className="mt-4 text-[var(--muted)]">{t("empty")}</p>
          <a className="pill pill-primary mt-5" href={`/${locale}/games/new`}>{t("new")}</a>
        </div>
      ) : (
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {games.map((game) => (
            <div key={game.id} className="bubble-card group relative p-6 transition hover:-translate-y-1">
              <a href={`/${locale}/games/${game.id}`} className="absolute inset-0" aria-label={game.title} />
              <div className="flex items-center justify-between">
                <span className="rounded-full bg-pink-100 px-3 py-1 text-xs font-black uppercase text-pink-700">
                  {tStatus.has(game.status) ? tStatus(game.status) : game.status.replaceAll("_", " ")}
                </span>
                <ArrowRight className="transition group-hover:translate-x-1" />
              </div>
              <h2 className="display mt-7 text-3xl font-black">{game.title}</h2>
              <div className="mt-5 flex items-center justify-between text-sm text-[var(--muted)]">
                <span className="flex items-center gap-2"><CalendarClock size={16} /> {game.format}</span>
                <span className="font-mono font-bold">{game.public_code}</span>
              </div>
              {isOrgAdmin ? (
                <a
                  href={`/${locale}/games/${game.id}/host`}
                  className="pill relative z-10 mt-4 inline-flex items-center gap-2 bg-white text-sm"
                >
                  <Settings2 size={16} /> {t("hostControls")}
                </a>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
