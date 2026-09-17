"use client";

import {
  Crown,
  HandCoins,
  HelpCircle,
  PartyPopper,
  Search,
  Siren,
  Sparkles,
  Target,
  TrendingDown,
  type LucideIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";

import { formatMoney } from "@/lib/utils";

// Full-screen "game show finale" — the ending mirror of GameShowOpening.
// Runs a short timed sequence — the results are in, the winner's spotlight,
// a few by-the-numbers stats, then a set of funny superlative awards, one at
// a time — before fading out to whatever the public display shows for a
// completed game. Purely presentational: the caller (PublicDisplay) decides
// when to mount it, owns the sound effects (see `onBeat`), and remembers
// that it has run.

const EXIT_MS = 2000;

export type FinaleWinner = {
  playerId: string;
  name: string;
  hasAvatar: boolean;
  balance: number;
};

export type FinaleAwardKey =
  | "gossip"
  | "bigSpender"
  | "rockBottom"
  | "tycoon"
  | "triggerHappy"
  | "masterSleuth"
  | "wildGuesser";

export type FinaleAward = {
  key: FinaleAwardKey;
  playerId: string;
  name: string;
  hasAvatar: boolean;
  value: number;
};

export type FinaleStats = {
  playerCount: number;
  secretsRevealed: number;
  accusationsMade: number;
  roundsPlayed: number;
};

export type FinaleData = {
  currencySymbol: string;
  winner: FinaleWinner | null;
  stats: FinaleStats;
  awards: FinaleAward[];
};

const AWARD_META: Record<FinaleAwardKey, { Icon: LucideIcon; titleKey: string; taglineKey: string; isMoney: boolean }> = {
  gossip: { Icon: Search, titleKey: "awardGossipTitle", taglineKey: "awardGossipTagline", isMoney: false },
  bigSpender: { Icon: HandCoins, titleKey: "awardBigSpenderTitle", taglineKey: "awardBigSpenderTagline", isMoney: true },
  rockBottom: { Icon: TrendingDown, titleKey: "awardRockBottomTitle", taglineKey: "awardRockBottomTagline", isMoney: true },
  tycoon: { Icon: Crown, titleKey: "awardTycoonTitle", taglineKey: "awardTycoonTagline", isMoney: true },
  triggerHappy: { Icon: Siren, titleKey: "awardTriggerHappyTitle", taglineKey: "awardTriggerHappyTagline", isMoney: false },
  masterSleuth: { Icon: Target, titleKey: "awardMasterSleuthTitle", taglineKey: "awardMasterSleuthTagline", isMoney: false },
  wildGuesser: { Icon: HelpCircle, titleKey: "awardWildGuesserTitle", taglineKey: "awardWildGuesserTagline", isMoney: false },
};

type Step =
  | { kind: "presents" }
  | { kind: "winner"; winner: FinaleWinner }
  | { kind: "stats" }
  | { kind: "award"; award: FinaleAward; position: number; total: number }
  | { kind: "outro" };

export function GameShowFinale({
  brand,
  gameTitle,
  code,
  data,
  onDone,
  onBeat,
}: {
  brand: string;
  gameTitle: string;
  code: string;
  data: FinaleData;
  onDone: () => void;
  onBeat?: (kind: "winner" | "award" | "outro") => void;
}) {
  const t = useTranslations("display");

  const reducedMotion =
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const steps = useMemo<Step[]>(() => {
    const list: Step[] = [{ kind: "presents" }];
    if (data.winner) list.push({ kind: "winner", winner: data.winner });
    list.push({ kind: "stats" });
    data.awards.forEach((award, i) =>
      list.push({ kind: "award", award, position: i + 1, total: data.awards.length }),
    );
    list.push({ kind: "outro" });
    return list;
  }, [data]);

  const durationFor = useCallback(
    (step: Step) => {
      if (reducedMotion) {
        return step.kind === "presents" ? 900 : step.kind === "winner" ? 1600 : step.kind === "stats" ? 1400 : step.kind === "award" ? 1300 : 1300;
      }
      return step.kind === "presents" ? 2400 : step.kind === "winner" ? 4200 : step.kind === "stats" ? 3400 : step.kind === "award" ? 3200 : 3400;
    },
    [reducedMotion],
  );

  const [stepIndex, setStepIndex] = useState(0);
  const [exiting, setExiting] = useState(false);
  const step = steps[stepIndex] ?? steps[steps.length - 1];

  const finish = useCallback(() => {
    setExiting((already) => {
      if (already) return already;
      window.setTimeout(onDone, EXIT_MS);
      return true;
    });
  }, [onDone]);

  useEffect(() => {
    if (exiting) return;
    const id = window.setTimeout(() => {
      setStepIndex((i) => (i + 1 < steps.length ? i + 1 : i));
      if (stepIndex + 1 >= steps.length) finish();
    }, durationFor(step));
    return () => window.clearTimeout(id);
  }, [stepIndex, steps.length, exiting, step, durationFor, finish]);

  useEffect(() => {
    if (step.kind === "winner" || step.kind === "award" || step.kind === "outro") onBeat?.(step.kind);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepIndex]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") finish();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [finish]);

  const confetti = useMemo(
    () =>
      Array.from({ length: 40 }, (_, i) => ({
        left: (i * 97) % 100,
        delay: ((i * 53) % 100) / 100,
        dur: 2.4 + (((i * 37) % 100) / 100) * 1.8,
        hue: (i * 47) % 360,
        size: 8 + ((i * 13) % 10),
        drift: ((i % 5) - 2) * 3,
      })),
    [],
  );

  return (
    <div
      className={`fixed inset-0 z-[60] flex items-center justify-center overflow-hidden bg-[radial-gradient(circle_at_50%_-10%,#7c2d67,#2b0a26_60%,#12040f)] text-white ${
        exiting ? "pointer-events-none opacity-0" : "opacity-100"
      }`}
      style={{ transitionProperty: "opacity", transitionDuration: `${EXIT_MS}ms`, transitionTimingFunction: "ease-in" }}
      role="dialog"
      aria-modal="true"
      aria-label={`${brand} — ${gameTitle}`}
    >
      <style>{`
        @keyframes gsfSweep { 0% { transform: translateX(-60%) rotate(8deg); opacity: 0 } 30% { opacity: .5 } 100% { transform: translateX(60%) rotate(8deg); opacity: 0 } }
        @keyframes gsfRise { 0% { transform: translateY(28px) scale(.94); opacity: 0 } 100% { transform: translateY(0) scale(1); opacity: 1 } }
        @keyframes gsfSlam { 0% { transform: scale(2.4); opacity: 0; filter: blur(14px) } 55% { transform: scale(.94); opacity: 1; filter: blur(0) } 75% { transform: scale(1.05) } 100% { transform: scale(1) } }
        @keyframes gsfPop { 0% { transform: scale(.4) rotate(-6deg); opacity: 0 } 60% { transform: scale(1.12) rotate(1deg) } 100% { transform: scale(1) rotate(0); opacity: 1 } }
        @keyframes gsfGlow { 0%,100% { text-shadow: 0 0 20px rgba(255,120,200,.5), 0 0 60px rgba(255,120,200,.25) } 50% { text-shadow: 0 0 32px rgba(255,170,220,.85), 0 0 90px rgba(255,120,200,.45) } }
        @keyframes gsfConfetti { 0% { transform: translate3d(0,-12vh,0) rotate(0); opacity: 1 } 100% { transform: translate3d(var(--dx,0),112vh,0) rotate(720deg); opacity: .9 } }
        @keyframes gsfSpin { to { transform: rotate(360deg) } }
        @keyframes gsfTileIn { 0% { transform: translateY(20px) scale(.92); opacity: 0 } 100% { transform: translateY(0) scale(1); opacity: 1 } }
        .gsf-fade { animation: gsfRise .6s cubic-bezier(.2,1,.3,1) both }
        .gsf-slam { animation: gsfSlam .8s cubic-bezier(.2,1.3,.3,1) both }
        .gsf-pop { animation: gsfPop .6s cubic-bezier(.2,1.5,.3,1) both }
        .gsf-glow { animation: gsfGlow 2.4s ease-in-out infinite }
        .gsf-tile { animation: gsfTileIn .55s cubic-bezier(.2,1.2,.3,1) both }
        .gsf-confetti-piece { position: absolute; top: -12vh; border-radius: 2px; animation: gsfConfetti linear forwards }
        .gsf-sweep { position: absolute; inset: -20% -30%; background: linear-gradient(90deg, transparent, rgba(255,190,235,.22), transparent); animation: gsfSweep 3.4s ease-in-out infinite }
        .gsf-rays { position: absolute; left: 50%; top: 50%; width: 160vmax; height: 160vmax; transform: translate(-50%,-50%); background: repeating-conic-gradient(from 0deg, rgba(255,180,230,.10) 0deg 8deg, transparent 8deg 20deg); animation: gsfSpin 24s linear infinite }
        @media (prefers-reduced-motion: reduce) {
          .gsf-slam, .gsf-pop, .gsf-fade, .gsf-tile { animation-duration: .01ms !important; animation-iteration-count: 1 !important }
          .gsf-glow, .gsf-sweep, .gsf-rays, .gsf-confetti-piece { animation: none !important }
        }
      `}</style>

      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="gsf-sweep" />
        <div
          className="absolute inset-0 opacity-[0.10]"
          style={{ backgroundImage: "radial-gradient(circle, #ff8ad0 1px, transparent 1px)", backgroundSize: "34px 34px" }}
        />
      </div>

      <button
        type="button"
        onClick={finish}
        className="absolute right-5 top-5 z-10 rounded-full bg-white/10 px-4 py-2 text-xs font-black uppercase tracking-widest text-white/80 ring-1 ring-white/20 backdrop-blur hover:bg-white/20"
      >
        {t("openSkip")}
      </button>

      <div className="relative z-[5] w-full max-w-[min(92vw,72rem)] px-6 text-center">
        {step.kind === "presents" ? (
          <div key="presents">
            <p className="gsf-fade text-[clamp(.8rem,1.8vw,1.4rem)] font-black uppercase tracking-[.4em] text-pink-200/80">
              {t("finalePresents")}
            </p>
            <h1 className="gsf-slam gsf-glow display mt-4 text-[clamp(2.6rem,10vw,7.5rem)] font-black uppercase leading-[.9]">
              {t("finaleResultsIn")}
            </h1>
            <p className="gsf-fade mt-6 text-[clamp(.9rem,2vw,1.6rem)] font-bold text-white/70" style={{ animationDelay: "420ms" }}>
              {t("finaleTagline")}
            </p>
          </div>
        ) : null}

        {step.kind === "winner" ? (
          <div key="winner" className="relative flex min-h-[60vh] flex-col items-center justify-center">
            <div className="pointer-events-none absolute inset-0 grid place-items-center">
              <div className="gsf-rays opacity-60" />
            </div>
            {confetti.map((c, i) => (
              <span
                key={i}
                className="gsf-confetti-piece"
                style={{
                  left: `${c.left}%`,
                  width: c.size,
                  height: c.size * 1.6,
                  background: `hsl(${c.hue} 90% 62%)`,
                  animationDuration: `${c.dur}s`,
                  animationDelay: `${c.delay}s`,
                  ["--dx" as string]: `${c.drift}vw`,
                }}
              />
            ))}
            <p className="gsf-fade relative flex items-center gap-3 text-[clamp(.8rem,1.8vw,1.4rem)] font-black uppercase tracking-[.4em] text-pink-200/80">
              <Crown size="1.1em" /> {t("finaleWinnerKicker")}
            </p>
            <div className="gsf-pop relative mt-6">
              <BigAvatar code={code} playerId={step.winner.playerId} name={step.winner.name} hasAvatar={step.winner.hasAvatar} />
            </div>
            <h2 className="gsf-fade display relative mt-6 text-[clamp(2.6rem,9vw,6.5rem)] font-black uppercase leading-[.9]" style={{ animationDelay: "160ms" }}>
              {step.winner.name}
            </h2>
            <p className="gsf-fade relative mt-4 text-[clamp(1rem,2.2vw,1.7rem)] font-bold text-white/85" style={{ animationDelay: "320ms" }}>
              {t("finaleWinnerBalance", { amount: formatMoney(step.winner.balance, data.currencySymbol) })}
            </p>
          </div>
        ) : null}

        {step.kind === "stats" ? (
          <div key="stats">
            <p className="gsf-fade text-[clamp(.8rem,1.8vw,1.4rem)] font-black uppercase tracking-[.4em] text-pink-200/80">
              {t("finaleStatsKicker")}
            </p>
            <div className="mt-8 grid grid-cols-2 gap-[clamp(.75rem,2vw,1.5rem)] sm:grid-cols-4">
              {[
                [t("finaleStatPlayers"), data.stats.playerCount],
                [t("finaleStatSecrets"), data.stats.secretsRevealed],
                [t("finaleStatAccusations"), data.stats.accusationsMade],
                [t("finaleStatRounds"), data.stats.roundsPlayed],
              ].map(([label, value], i) => (
                <div
                  key={String(label)}
                  className="gsf-tile rounded-[24px] border border-white/15 bg-white/10 p-[clamp(1rem,2vw,1.75rem)] backdrop-blur"
                  style={{ animationDelay: reducedMotion ? "0ms" : `${i * 110}ms` }}
                >
                  <p className="display text-[clamp(2rem,5vw,3.5rem)] font-black leading-none">{String(value)}</p>
                  <p className="mt-2 text-[clamp(.65rem,1.1vw,.9rem)] font-black uppercase tracking-widest text-pink-200/80">{label}</p>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {step.kind === "award" ? (() => {
          const meta = AWARD_META[step.award.key];
          const Icon = meta.Icon;
          const value = meta.isMoney ? formatMoney(step.award.value, data.currencySymbol) : String(step.award.value);
          return (
            <div key={`award-${step.award.playerId}-${step.award.key}`} className="relative flex min-h-[60vh] flex-col items-center justify-center">
              <div className="pointer-events-none absolute inset-0 grid place-items-center">
                <div className="gsf-rays opacity-40" />
              </div>
              <p className="gsf-fade relative text-[clamp(.7rem,1.5vw,1.2rem)] font-black uppercase tracking-[.4em] text-pink-200/70">
                {t("finaleAwardsKicker")} · {step.position}/{step.total}
              </p>
              <p className="gsf-pop relative mt-6 flex items-center gap-3 text-[clamp(1.6rem,4vw,2.6rem)] font-black uppercase text-pink-200">
                <Icon size="1em" />
              </p>
              <h2 className="gsf-slam display relative mt-3 text-[clamp(2.2rem,7vw,5rem)] font-black uppercase leading-[.95]">
                {t(meta.titleKey)}
              </h2>
              <div className="gsf-fade relative mt-6" style={{ animationDelay: "220ms" }}>
                <BigAvatar code={code} playerId={step.award.playerId} name={step.award.name} hasAvatar={step.award.hasAvatar} compact />
              </div>
              <p className="gsf-fade display relative mt-4 text-[clamp(1.6rem,4vw,2.6rem)] font-black leading-tight" style={{ animationDelay: "260ms" }}>
                {step.award.name}
              </p>
              <p className="gsf-fade relative mt-3 max-w-[36ch] text-[clamp(.95rem,1.8vw,1.4rem)] font-bold text-white/85" style={{ animationDelay: "340ms" }}>
                {t(meta.taglineKey, { value })}
              </p>
            </div>
          );
        })() : null}

        {step.kind === "outro" ? (
          <div key="outro" className="relative">
            {confetti.map((c, i) => (
              <span
                key={i}
                className="gsf-confetti-piece"
                style={{
                  left: `${c.left}%`,
                  width: c.size,
                  height: c.size * 1.6,
                  background: `hsl(${c.hue} 90% 62%)`,
                  animationDuration: `${c.dur}s`,
                  animationDelay: `${c.delay}s`,
                  ["--dx" as string]: `${c.drift}vw`,
                }}
              />
            ))}
            <p className="gsf-fade flex items-center justify-center gap-3 text-[clamp(.8rem,1.8vw,1.4rem)] font-black uppercase tracking-[.4em] text-pink-200/80">
              <Sparkles size="1.1em" /> {brand}
            </p>
            <h2 className="gsf-pop display mt-4 text-[clamp(2.6rem,9vw,7.5rem)] font-black uppercase leading-[.9]">
              {t("finaleOutroTitle")}
            </h2>
            <p className="gsf-fade mt-6 flex items-center justify-center gap-2 text-[clamp(.9rem,2vw,1.5rem)] font-bold text-white/70" style={{ animationDelay: "360ms" }}>
              <PartyPopper size="1.1em" /> {gameTitle}
            </p>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function BigAvatar({
  code,
  playerId,
  name,
  hasAvatar,
  compact = false,
}: {
  code: string;
  playerId: string;
  name: string;
  hasAvatar: boolean;
  compact?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  const initials = useMemo(() => {
    const parts = name.trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return "?";
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }, [name]);

  const size = compact ? "size-[clamp(90px,12vw,140px)] ring-3" : "size-[clamp(120px,18vw,220px)] ring-4";
  const base = `${size} shrink-0 rounded-full ring-white/40`;
  const src = `/api/assets/avatar/public/${code}/${playerId}`;

  if (!hasAvatar || failed) {
    return (
      <span
        className={`grid place-items-center ${base} bg-gradient-to-br from-pink-400 to-violet-600 ${
          compact ? "text-[clamp(1.6rem,3vw,2.4rem)]" : "text-[clamp(2.5rem,6vw,5rem)]"
        } font-black uppercase leading-none text-white`}
        aria-hidden="true"
      >
        {initials}
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt="" className={`${base} object-cover`} onError={() => setFailed(true)} />
  );
}
