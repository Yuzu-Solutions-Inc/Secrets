import {
  ArrowRight,
  Coins,
  Eye,
  Grab,
  Handshake,
  Lightbulb,
  Link2,
  Lock,
  Megaphone,
  PartyPopper,
  Siren,
  Target,
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

const DOTS = "radial-gradient(circle, var(--pink) 1px, transparent 1px)";

/* Fictional demo game — never real player data. */
const DEMO = {
  game: "Villa Nocturne",
  me: "Mara",
  team: "Ravens",
  accuser: "Mara",
  target: "Théo",
  board: [
    { name: "Jules", amount: "12 100", out: false },
    { name: "Sam", amount: "10 700", out: false },
    { name: "Mara", amount: "9 400", out: false },
    { name: "Priya", amount: "8 300", out: false },
    { name: "Wei", amount: "7 250", out: false },
    { name: "Théo", amount: "6 850", out: true },
  ],
};

/* ---------- device frames ---------- */

function PhoneShell({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-[236px]">
      <div className="rounded-[2.4rem] bg-[var(--ink)] p-[7px] shadow-[0_40px_80px_-18px_rgba(50,20,47,.42)]">
        <div className="relative min-h-[430px] overflow-hidden rounded-[1.95rem] bg-[var(--cream)]">
          <div
            className="pointer-events-none absolute inset-0 opacity-[0.05]"
            style={{ backgroundImage: DOTS, backgroundSize: "22px 22px" }}
          />
          <div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-b from-transparent to-[var(--blush)]" />
          <div className="absolute left-1/2 top-0 h-[20px] w-[96px] -translate-x-1/2 rounded-b-[13px] bg-[var(--ink)]" />
          <div className="relative flex min-h-[430px] flex-col gap-2 px-2.5 pb-2 pt-6">
            {children}
            <div className="mx-auto mt-auto h-1 w-1/3 rounded-full bg-[var(--ink)]/20" />
          </div>
        </div>
      </div>
    </div>
  );
}

function TvShell({ t, children }: { t: T; children: ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-[440px]">
      <div className="rounded-[1rem] bg-[var(--ink)] p-[6px] shadow-[0_40px_80px_-18px_rgba(50,20,47,.42)]">
        <div className="relative aspect-[16/10] overflow-hidden rounded-[0.6rem] bg-gradient-to-br from-[var(--cream)] to-[var(--blush)]">
          <div
            className="pointer-events-none absolute inset-0 opacity-[0.06]"
            style={{ backgroundImage: DOTS, backgroundSize: "26px 26px" }}
          />
          <div className="relative flex h-full flex-col gap-2 p-3">
            <div className="flex items-center justify-between">
              <p className="display text-sm font-black">{DEMO.game}</p>
              <span className="flex items-center gap-1.5 rounded-full bg-white/85 px-2 py-0.5 text-[8px] font-black uppercase tracking-widest text-pink-600 ring-1 ring-[var(--border)]">
                <span className="size-1.5 rounded-full bg-pink-500" />
                {t("display.live")}
              </span>
            </div>
            <div className="flex min-h-0 flex-1 flex-col">{children}</div>
          </div>
        </div>
      </div>
      <div className="mx-auto mt-1.5 h-2.5 w-24 rounded-b-[6px] bg-[var(--ink)]/70" />
      <div className="mx-auto h-1 w-44 rounded-full bg-[var(--ink)]/15" />
    </div>
  );
}

/* ---------- shared phone chrome ---------- */

function PhoneHeader() {
  return (
    <div className="flex items-center gap-2 rounded-2xl border border-[var(--border)] bg-white/85 p-2 backdrop-blur">
      <span className="grid size-8 shrink-0 place-items-center rounded-full bg-gradient-to-br from-pink-400 to-violet-500 text-[11px] font-black text-white">
        {DEMO.me[0]}
      </span>
      <div className="min-w-0 leading-tight">
        <p className="truncate text-xs font-black">{DEMO.me}</p>
        <p className="truncate text-[9px] font-bold text-[var(--muted)]">
          {DEMO.game}
        </p>
      </div>
    </div>
  );
}

function WalletCard({ t }: { t: T }) {
  return (
    <div className="rounded-2xl bg-gradient-to-br from-pink-500 to-fuchsia-700 p-2.5 text-white">
      <p className="flex items-center gap-1.5 text-[10px] font-bold text-white/90">
        <Coins size={12} /> {t("play.wallet")}
      </p>
      <p className="display mt-0.5 text-xl font-black tabular-nums">12 500 ¤</p>
    </div>
  );
}

function MissionRow({ t }: { t: T }) {
  return (
    <div className="rounded-2xl border border-[var(--border)] bg-white/85 p-2.5">
      <p className="flex items-center gap-1.5 text-[10px] font-black text-[var(--muted)]">
        <Target size={11} className="text-pink-500" /> {t("play.mission")}
      </p>
      <p className="mt-0.5 text-[11px] font-bold leading-snug">
        {t("play.newMission")}
      </p>
    </div>
  );
}

/* ---------- in-game moment screens ---------- */

function screensFor(t: T): ReactNode[] {
  return [
    // 1 — someone buzzes (phone)
    <PhoneShell key="buzz">
      <PhoneHeader />
      <WalletCard t={t} />
      <div className="grid flex-1 grid-cols-2 gap-2">
        <div className="flex flex-col items-center justify-center gap-1.5 rounded-2xl bg-red-500 p-2 text-center text-white shadow-lg shadow-red-500/30 ring-4 ring-red-500/25">
          <Megaphone size={19} />
          <span className="text-[11px] font-black leading-tight">
            {t("play.accuse")}
          </span>
        </div>
        <div className="flex flex-col items-center justify-center gap-1.5 rounded-2xl bg-amber-300 p-2 text-center text-amber-950">
          <Lightbulb size={19} />
          <span className="text-[11px] font-black leading-tight">
            {t("play.buyHint")}
          </span>
        </div>
      </div>
      <div className="flex items-center gap-2 rounded-2xl border border-[var(--border)] bg-white/70 p-2 text-[10px] font-bold text-[var(--muted)]">
        <span className="relative flex size-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-pink-500 opacity-75" />
          <span className="relative inline-flex size-2 rounded-full bg-pink-500" />
        </span>
        {t("play.waiting")}
      </div>
    </PhoneShell>,

    // 2 — the room erupts (tv spotlight + balances board behind)
    <TvShell key="spotlight" t={t}>
      <div className="flex h-full flex-col gap-2">
        <div className="rounded-xl bg-[linear-gradient(120deg,#be123c,#7e22ce)] p-3 text-white shadow-[0_14px_36px_rgba(190,18,60,.45)]">
          <p className="flex items-center gap-1.5 text-[9px] font-black uppercase tracking-[.22em] text-rose-50">
            <Siren size={10} /> {t("display.accusation")}
          </p>
          <p className="display mt-1 text-xl font-black leading-none">
            {DEMO.accuser} <span className="text-rose-200">→</span> {DEMO.target}
          </p>
          <p className="mt-1 truncate text-[10px] font-semibold text-white/85">
            &ldquo;{t("landing.moments.1.quote")}&rdquo;
          </p>
        </div>
        <div className="grid flex-1 grid-cols-3 gap-1.5 opacity-75">
          {DEMO.board.slice(0, 3).map((p) => (
            <div
              key={p.name}
              className="flex flex-col justify-center rounded-lg border border-[var(--border)] bg-white/70 p-1.5"
            >
              <p className="truncate text-[9px] font-black">{p.name}</p>
              <p className="display text-[11px] font-black tabular-nums text-pink-700">
                {p.amount} ¤
              </p>
            </div>
          ))}
        </div>
      </div>
    </TvShell>,

    // 3 — cracked it (tv verdict takeover + confetti)
    <TvShell key="verdict" t={t}>
      <div className="relative flex h-full w-full flex-col items-center justify-center overflow-hidden rounded-xl bg-gradient-to-br from-emerald-400 to-emerald-700 p-4 text-center text-white">
        {Array.from({ length: 16 }).map((_, i) => (
          <span
            key={i}
            className="absolute top-0 h-3 w-1"
            style={{
              left: `${(i * 6 + 3) % 100}%`,
              background: `hsl(${(i * 47) % 360} 85% 70%)`,
              transform: `translateY(${(i % 5) * 7}px) rotate(${((i * 53) % 90) - 45}deg)`,
              opacity: 0.9,
            }}
          />
        ))}
        <p className="relative flex items-center gap-1.5 text-[9px] font-black uppercase tracking-[.3em] text-white/90">
          <PartyPopper size={12} /> {t("display.theVerdict")}
        </p>
        <p className="display relative mt-1 text-3xl font-black uppercase leading-none">
          {t("display.verdictCorrect")}
        </p>
        <p className="relative mt-2 text-sm font-black">
          {DEMO.accuser} <span className="opacity-70">→</span> {DEMO.target}
        </p>
      </div>
    </TvShell>,

    // 4 — share or steal (phone)
    <PhoneShell key="dilemma">
      <PhoneHeader />
      <WalletCard t={t} />
      <div className="rounded-2xl border border-[var(--border)] bg-white/85 p-2">
        <p className="flex items-center gap-1.5 text-[10px] font-black">
          <Users size={11} className="text-violet-600" /> {t("play.team")}
        </p>
        <p className="display text-sm font-black">{DEMO.team}</p>
      </div>
      <div className="grid flex-1 grid-cols-2 gap-2">
        <div className="flex flex-col items-center justify-center gap-2 rounded-2xl bg-white text-[var(--ink)] ring-1 ring-[var(--border)]">
          <Handshake size={22} className="text-violet-500" />
          <span className="text-sm font-extrabold">{t("play.share")}</span>
        </div>
        <div className="flex flex-col items-center justify-center gap-2 rounded-2xl bg-gradient-to-br from-[var(--pink)] to-[#a935d0] text-white shadow-lg shadow-pink-500/25">
          <Grab size={22} />
          <span className="text-sm font-extrabold">{t("play.steal")}</span>
        </div>
      </div>
    </PhoneShell>,

    // 5 — secrets spill (tv balances board)
    <TvShell key="balances" t={t}>
      <div className="flex h-full w-full flex-col">
        <p className="text-[9px] font-black uppercase tracking-[.2em] text-pink-600">
          {t("display.balances")}
        </p>
        <div className="mt-1.5 grid flex-1 grid-cols-3 gap-1.5">
          {DEMO.board.map((p) => (
            <div
              key={p.name}
              className={`flex flex-col justify-center gap-0.5 rounded-lg p-1.5 ${
                p.out
                  ? "border-2 border-violet-300 bg-[linear-gradient(150deg,#f5f0ff,#ffffff)] shadow-[0_8px_18px_rgba(124,58,237,.16)]"
                  : "border border-[var(--border)] bg-white shadow-sm"
              }`}
            >
              <p className="flex items-center gap-1 truncate text-[10px] font-black">
                {p.out ? (
                  <Unlock size={9} className="shrink-0 text-violet-600" />
                ) : null}
                {p.name}
              </p>
              <p
                className={`display text-xs font-black tabular-nums ${
                  p.out ? "text-violet-800" : "text-pink-700"
                }`}
              >
                {p.amount} ¤
              </p>
              {p.out ? (
                <span className="text-[7px] font-black uppercase tracking-widest text-violet-600">
                  {t("display.secretOut")}
                </span>
              ) : null}
            </div>
          ))}
        </div>
      </div>
    </TvShell>,
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
        <span className="display flex min-w-0 items-center gap-2 text-xl font-black sm:text-2xl">
          <span className="grid size-9 shrink-0 place-items-center rounded-full bg-pink-500 text-white sm:size-10">
            <Eye size={21} />
          </span>
          <span className="truncate">{t("brand")}</span>
        </span>
        <div className="flex shrink-0 items-center gap-2">
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

        <div className="relative mx-auto w-full max-w-xs">
          <PhoneShell>
            <PhoneHeader />
            <div className="rounded-2xl bg-gradient-to-br from-pink-500 to-violet-600 p-2.5 text-white">
              <p className="text-[10px] font-black uppercase tracking-widest">
                {t("landing.hero.round")}
              </p>
              <p className="display text-base font-black leading-tight">
                {t("landing.hero.phase")}
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-2xl border border-[var(--border)] bg-white/85 p-2">
                <p className="text-[10px] text-[var(--muted)]">
                  {t("play.wallet")}
                </p>
                <p className="display text-sm font-black tabular-nums">
                  12 500 ¤
                </p>
              </div>
              <div className="rounded-2xl border border-[var(--border)] bg-white/85 p-2">
                <p className="text-[10px] text-[var(--muted)]">
                  {t("play.hints")}
                </p>
                <p className="display text-sm font-black">4</p>
              </div>
            </div>
            <MissionRow t={t} />
            <div className="rounded-2xl bg-pink-600 py-2.5 text-center text-sm font-black text-white shadow-lg shadow-pink-500/30">
              {t("landing.hero.buzz")}
            </div>
          </PhoneShell>
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
                <p className="font-mono text-xs font-black text-pink-400">
                  {String(i + 1).padStart(2, "0")} /{" "}
                  {String(moments.length).padStart(2, "0")}
                </p>
                <p className="display mt-1 text-3xl font-black leading-tight sm:text-4xl">
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
          <div className="relative overflow-hidden rounded-[calc(var(--radius)-0.25rem)] bg-gradient-to-br from-pink-500 to-violet-600 p-10 text-center text-white sm:p-16">
            <div
              className="pointer-events-none absolute inset-0 opacity-10"
              style={{ backgroundImage: DOTS, backgroundSize: "28px 28px" }}
            />
            <h2 className="display relative mx-auto max-w-xl text-4xl font-black sm:text-5xl">
              {t("landing.cta.title")}
            </h2>
            <a
              href={`/${locale}/login?mode=signup`}
              className="pill relative mt-8 bg-white text-base text-pink-600"
            >
              <Zap size={19} /> {t("landing.cta.button")}
            </a>
            <p className="relative mt-6 flex items-center justify-center gap-1.5 text-sm text-white/80">
              <Lock size={13} /> {t("landing.fairLine")}
            </p>
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
