import {
  ArrowRight,
  Coins,
  Eye,
  Link2,
  Megaphone,
  PartyPopper,
  Siren,
  Unlock,
  Users,
  Zap,
} from "lucide-react";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { routing } from "@/i18n/routing";

type Params = { params: Promise<{ locale: string }> };
type T = Awaited<ReturnType<typeof getTranslations>>;

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale });
  return {
    title: t("landing.meta.title"),
    description: t("landing.meta.description"),
    alternates: {
      canonical: `/${locale}`,
      languages: Object.fromEntries(
        routing.locales.map((code) => [code, `/${code}`]),
      ),
    },
    openGraph: {
      title: t("landing.meta.title"),
      description: t("landing.meta.description"),
      type: "website",
      locale,
    },
  };
}

/* ---------- device frames ---------- */

function PhoneMock({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-[260px]">
      <div className="rounded-[2.6rem] border-[10px] border-[var(--ink)] bg-[var(--ink)] p-1.5 shadow-[0_34px_70px_rgba(50,20,47,.28)]">
        <div className="relative overflow-hidden rounded-[2rem] bg-gradient-to-b from-[var(--cream)] to-[var(--blush)]">
          <div className="absolute left-1/2 top-2 h-4 w-20 -translate-x-1/2 rounded-full bg-[var(--ink)]" />
          <div className="px-3.5 pb-5 pt-8">{children}</div>
        </div>
      </div>
    </div>
  );
}

function TvMock({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-[420px]">
      <div className="rounded-[1.2rem] border-[6px] border-[var(--ink)] bg-[var(--ink)] p-1.5 shadow-[0_34px_70px_rgba(50,20,47,.28)]">
        <div className="relative aspect-[16/10] overflow-hidden rounded-[0.55rem] bg-gradient-to-br from-[var(--cream)] to-[var(--blush)] p-3.5">
          {children}
        </div>
      </div>
      <div className="mx-auto mt-1 h-3 w-20 rounded-b-lg bg-[var(--ink)]/75" />
    </div>
  );
}

const CONFETTI = [
  { left: "8%", hue: 330, rot: -18 },
  { left: "24%", hue: 45, rot: 12 },
  { left: "42%", hue: 265, rot: -8 },
  { left: "60%", hue: 150, rot: 20 },
  { left: "76%", hue: 330, rot: -14 },
  { left: "90%", hue: 45, rot: 6 },
];

/* ---------- in-game moment screens ---------- */

function screensFor(t: T): ReactNode[] {
  return [
    // 1 — someone buzzes (phone)
    <PhoneMock key="buzz">
      <div className="space-y-3">
        <div className="rounded-2xl bg-gradient-to-br from-pink-500 to-fuchsia-700 p-3 text-white">
          <p className="flex items-center gap-1.5 text-[10px] font-bold text-white/90">
            <Coins size={12} /> {t("play.wallet")}
          </p>
          <p className="display text-2xl font-black tabular-nums">12 500 ¤</p>
        </div>
        <div className="flex min-h-[96px] flex-col justify-between rounded-2xl bg-red-500 p-3 text-white shadow-lg shadow-red-500/30">
          <Megaphone size={20} />
          <span className="flex items-center gap-2 text-sm font-black">
            <span className="relative flex size-2.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white opacity-75" />
              <span className="relative inline-flex size-2.5 rounded-full bg-white" />
            </span>
            {t("play.accuse")}
          </span>
        </div>
      </div>
    </PhoneMock>,

    // 2 — the room erupts (tv spotlight)
    <TvMock key="spotlight">
      <div className="flex h-full items-center">
        <div className="w-full rounded-2xl bg-[linear-gradient(120deg,#be123c,#7e22ce)] p-3.5 text-white shadow-[0_18px_50px_rgba(190,18,60,.5)]">
          <p className="flex items-center gap-1.5 text-[9px] font-black uppercase tracking-[.22em] text-rose-50">
            <Siren size={11} /> {t("display.accusation")}
          </p>
          <p className="display mt-1 text-2xl font-black leading-none">
            Léa <span className="text-rose-100">→</span> Max
          </p>
          <p className="mt-1.5 truncate text-[11px] font-semibold text-white/90">
            &ldquo;{t("landing.moments.1.quote")}&rdquo;
          </p>
        </div>
      </div>
    </TvMock>,

    // 3 — cracked it (tv verdict + confetti)
    <TvMock key="verdict">
      {CONFETTI.map((c, i) => (
        <span
          key={i}
          className="absolute top-0 h-4 w-1.5 rounded-[1px]"
          style={{
            left: c.left,
            background: `hsl(${c.hue} 90% 62%)`,
            transform: `rotate(${c.rot}deg)`,
          }}
        />
      ))}
      <div className="flex h-full flex-col items-center justify-center rounded-xl bg-gradient-to-br from-emerald-400 to-emerald-700 p-4 text-center text-white">
        <p className="flex items-center gap-1.5 text-[9px] font-black uppercase tracking-[.3em] text-white/90">
          <PartyPopper size={12} /> {t("display.theVerdict")}
        </p>
        <p className="display mt-1 text-3xl font-black uppercase leading-none">
          {t("display.verdictCorrect")}
        </p>
        <p className="mt-2 text-sm font-black">
          Léa <span className="opacity-70">→</span> Max
        </p>
      </div>
    </TvMock>,

    // 4 — share or steal (phone)
    <PhoneMock key="dilemma">
      <div className="space-y-3">
        <div className="rounded-2xl border border-pink-200 bg-white p-3">
          <p className="flex items-center gap-1.5 text-xs font-black">
            <Users size={13} className="text-violet-600" /> {t("play.team")}
          </p>
          <p className="display mt-0.5 text-sm font-black">Team Rouge</p>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="flex min-h-16 items-center justify-center rounded-full bg-white text-sm font-extrabold text-[var(--ink)] ring-1 ring-[var(--border)]">
            {t("play.share")}
          </div>
          <div className="flex min-h-16 items-center justify-center rounded-full bg-gradient-to-br from-[var(--pink)] to-[#a935d0] text-sm font-extrabold text-white">
            {t("play.steal")}
          </div>
        </div>
      </div>
    </PhoneMock>,

    // 5 — secrets spill (tv balances board)
    <TvMock key="balances">
      <div className="flex h-full flex-col">
        <p className="text-[9px] font-black uppercase tracking-[.2em] text-pink-600">
          {t("display.balances")}
        </p>
        <div className="mt-2 grid flex-1 grid-cols-2 gap-2">
          <div className="flex flex-col justify-center rounded-xl border border-[var(--border)] bg-white p-2.5 shadow-sm">
            <p className="truncate text-xs font-black">adrien</p>
            <p className="display text-base font-black tabular-nums text-pink-700">
              12 562 ¤
            </p>
          </div>
          <div className="flex flex-col justify-center gap-1 rounded-xl border border-violet-300 bg-violet-50 p-2.5 shadow-sm">
            <p className="truncate text-xs font-black">Dossierly</p>
            <p className="display text-base font-black tabular-nums text-violet-800">
              8 437 ¤
            </p>
            <span className="inline-flex w-fit items-center gap-1 rounded-full bg-violet-600 px-1.5 py-0.5 text-[8px] font-black uppercase tracking-widest text-white">
              <Unlock size={9} /> {t("display.secretOut")}
            </span>
          </div>
        </div>
      </div>
    </TvMock>,
  ];
}

type Moment = { title: string; line: string };
type Format = { name: string; time: string; line: string };

export default async function LandingPage({ params }: Params) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations();

  const ribbon = t.raw("landing.ribbon") as string[];
  const moments = t.raw("landing.moments") as Moment[];
  const formats = t.raw("landing.formats.items") as Format[];
  const screens = screensFor(t);
  const otherLocale = routing.locales.find((code) => code !== locale) ?? locale;

  return (
    <main className="mx-auto min-h-dvh max-w-6xl px-5 py-6 sm:px-8">
      <nav className="flex items-center justify-between gap-3">
        <span className="display flex items-center gap-2 text-2xl font-black">
          <span className="grid size-10 place-items-center rounded-full bg-pink-500 text-white">
            <Eye size={23} />
          </span>
          {t("brand")}
        </span>
        <div className="flex items-center gap-2">
          <a href={`/${locale}/login`} className="pill pill-secondary">
            {t("landing.login")}
          </a>
          <a
            href={`/${locale}/login?mode=signup`}
            className="pill pill-primary hidden sm:inline-flex"
          >
            <Zap size={18} /> {t("landing.start")}
          </a>
        </div>
      </nav>

      {/* hero */}
      <section className="grid items-center gap-10 overflow-x-clip py-14 sm:py-20 lg:grid-cols-[1.05fr_.95fr]">
        <div>
          <p className="mb-4 text-sm font-black uppercase tracking-[.18em] text-pink-600">
            {t("landing.eyebrow")}
          </p>
          <h1 className="display text-5xl font-black leading-[.95] sm:text-7xl">
            {t("landing.title")}
          </h1>
          <p className="mt-6 max-w-md text-lg leading-7 text-[var(--muted)]">
            {t("landing.subtitle")}
          </p>
          <a
            href={`/${locale}/login?mode=signup`}
            className="pill pill-primary mt-8 text-base"
          >
            <Zap size={19} /> {t("landing.start")}
          </a>
          <div className="mt-6 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs font-bold text-[var(--muted)]">
            {ribbon.map((step, i) => (
              <span key={step} className="flex items-center gap-2">
                {i > 0 ? (
                  <ArrowRight size={13} className="text-pink-400" />
                ) : null}
                {step}
              </span>
            ))}
          </div>
        </div>

        <div className="relative mx-auto w-full max-w-sm">
          <PhoneMock>
            <div className="rounded-[1.2rem] bg-gradient-to-br from-pink-500 to-violet-600 p-4 text-white">
              <p className="text-[11px] font-black uppercase tracking-widest">
                {t("landing.hero.round")}
              </p>
              <h2 className="display mt-1 text-2xl font-black">
                {t("landing.hero.phase")}
              </h2>
              <div className="mt-6 grid grid-cols-2 gap-2">
                <div className="rounded-xl bg-white/20 p-2.5">
                  <p className="text-[11px]">{t("play.wallet")}</p>
                  <p className="display text-lg font-black tabular-nums">
                    12 500 ¤
                  </p>
                </div>
                <div className="rounded-xl bg-white/20 p-2.5">
                  <p className="text-[11px]">{t("play.hints")}</p>
                  <p className="display text-lg font-black">4</p>
                </div>
              </div>
              <div className="mt-3 rounded-full bg-white py-2.5 text-center text-sm font-black text-pink-600">
                {t("landing.hero.buzz")}
              </div>
            </div>
          </PhoneMock>
          <div className="absolute -bottom-8 -left-6 -z-10 size-32 rounded-full bg-yellow-200 blur-sm" />
          <div className="absolute -right-8 -top-10 -z-10 size-40 rounded-full bg-pink-200 blur-sm" />
        </div>
      </section>

      {/* moments — watch the game react */}
      <section className="space-y-16 py-12 sm:space-y-24">
        {moments.map((moment, i) => {
          const flip = i % 2 === 1;
          return (
            <div
              key={moment.title}
              className="grid items-center gap-8 lg:grid-cols-2 lg:gap-16"
            >
              <div className={flip ? "lg:order-2" : undefined}>{screens[i]}</div>
              <div className={flip ? "lg:order-1" : undefined}>
                <p className="display text-3xl font-black leading-tight sm:text-4xl">
                  {moment.title}
                </p>
                <p className="mt-2 text-lg text-[var(--muted)]">{moment.line}</p>
              </div>
            </div>
          );
        })}
      </section>

      {/* formats */}
      <section className="py-12">
        <h2 className="display text-3xl font-black sm:text-4xl">
          {t("landing.formats.title")}
        </h2>
        <div className="mt-8 grid gap-4 sm:grid-cols-3">
          {formats.map((format) => (
            <article key={format.name} className="bubble-card p-6">
              <div className="flex items-baseline justify-between gap-3">
                <h3 className="display text-xl font-black">{format.name}</h3>
                <span className="rounded-full bg-violet-100 px-2.5 py-1 text-[11px] font-black uppercase tracking-wider text-violet-700">
                  {format.time}
                </span>
              </div>
              <p className="mt-2 text-[var(--muted)]">{format.line}</p>
            </article>
          ))}
        </div>
      </section>

      {/* final cta */}
      <section className="py-12">
        <div className="bubble-card overflow-hidden p-1">
          <div className="rounded-[calc(var(--radius)-0.25rem)] bg-gradient-to-br from-pink-500 to-violet-600 p-10 text-center text-white sm:p-16">
            <h2 className="display mx-auto max-w-xl text-4xl font-black sm:text-5xl">
              {t("landing.cta.title")}
            </h2>
            <a
              href={`/${locale}/login?mode=signup`}
              className="pill mt-8 bg-white text-base text-pink-600"
            >
              <Zap size={19} /> {t("landing.cta.button")}
            </a>
            <p className="mt-6 text-sm text-white/80">{t("landing.fairLine")}</p>
          </div>
        </div>
      </section>

      <footer className="flex flex-col gap-4 border-t border-[var(--border)] py-8 text-sm text-[var(--muted)] sm:flex-row sm:items-center sm:justify-between">
        <p className="display flex items-center gap-2 text-lg font-black text-[var(--ink)]">
          <span className="grid size-7 place-items-center rounded-full bg-pink-500 text-white">
            <Eye size={16} />
          </span>
          {t("brand")}
        </p>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 font-bold">
          <a href={`/${locale}/login`} className="hover:text-[var(--ink)]">
            {t("landing.login")}
          </a>
          <a
            href={`/${otherLocale}`}
            className="flex items-center gap-1.5 hover:text-[var(--ink)]"
          >
            <Link2 size={14} /> {otherLocale.toUpperCase()}
          </a>
        </div>
      </footer>

      <p className="pb-10 text-xs text-[var(--muted)]">
        {t("landing.footer.rights")}
      </p>
    </main>
  );
}
