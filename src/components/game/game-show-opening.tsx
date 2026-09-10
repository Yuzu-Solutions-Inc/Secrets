"use client";

import { PartyPopper, Sparkles, Volume2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";

// Full-screen "TV game-show" cold open for the public display. Runs a short
// timed sequence — app name, tonight's game, a few punchy words, each player
// in a solo spotlight, the whole table together — then fades through to the
// live dashboard underneath. Purely presentational: the caller decides when to
// mount it (see PublicDisplay) and remembers that it has run.

const AUDIO_SRC = "/audio/game-show-opening.mp3";
const EXIT_MS = 750;

export type OpeningPlayer = {
  id: string;
  name: string;
  hasAvatar: boolean;
  avatarSrc: string;
};

type Phase = "presents" | "title" | "words" | "solo" | "all" | "begin" | "exit";

export function GameShowOpening({
  brand,
  gameTitle,
  players,
  soundOn,
  onDone,
}: {
  brand: string;
  gameTitle: string;
  players: OpeningPlayer[];
  soundOn: boolean;
  onDone: () => void;
}) {
  const t = useTranslations("display");

  const reducedMotion =
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const words = useMemo<string[]>(() => {
    const raw = t.raw("openWords");
    return Array.isArray(raw) ? raw.map(String).slice(0, 6) : [];
  }, [t]);

  // Each player holds the solo spotlight for a full 3 seconds.
  const perPlayerMs = reducedMotion ? 1200 : 3000;
  const wordMs = reducedMotion ? 260 : 640;

  const durations: Record<Exclude<Phase, "exit">, number> = reducedMotion
    ? { presents: 900, title: 1400, words: 900, solo: 0, all: 1400, begin: 1300 }
    : { presents: 3000, title: 3400, words: Math.max(2400, words.length * wordMs + 500), solo: 0, all: 2600, begin: 3200 };

  const [phase, setPhase] = useState<Phase>("presents");
  const [soloIndex, setSoloIndex] = useState(0);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [needsTap, setNeedsTap] = useState(false);
  const doneRef = useRef(false);

  const finish = useCallback(() => {
    if (doneRef.current) return;
    doneRef.current = true;
    setPhase("exit");
    const el = audioRef.current;
    if (el) {
      const fade = window.setInterval(() => {
        if (!audioRef.current) return window.clearInterval(fade);
        const next = audioRef.current.volume - 0.1;
        if (next <= 0.02) {
          audioRef.current.volume = 0;
          audioRef.current.pause();
          window.clearInterval(fade);
        } else {
          audioRef.current.volume = next;
        }
      }, 55);
    }
    window.setTimeout(onDone, EXIT_MS);
  }, [onDone]);

  // Kick off the theme once, when the show mounts. Autoplay may be blocked
  // until the host interacts with the page — fall back to a one-tap prompt.
  useEffect(() => {
    if (!soundOn) return;
    const el = audioRef.current;
    if (!el) return;
    el.volume = 0.9;
    el.currentTime = 0;
    const attempt = el.play();
    if (attempt && typeof attempt.then === "function") {
      attempt.catch(() => setNeedsTap(true));
    }
  }, [soundOn]);

  // Drive the sequence. The solo phase steps through players on its own clock;
  // every other phase just waits out its duration and hands over.
  useEffect(() => {
    if (phase === "exit") return;

    if (phase === "solo") {
      const atEnd = players.length === 0 || soloIndex >= players.length;
      const id = window.setTimeout(
        () => (atEnd ? setPhase("all") : setSoloIndex((i) => i + 1)),
        atEnd ? 0 : perPlayerMs,
      );
      return () => window.clearTimeout(id);
    }

    const order: Array<Exclude<Phase, "exit">> = ["presents", "title", "words", "solo", "all", "begin"];
    const nextPhase = order[order.indexOf(phase) + 1] ?? null;
    const id = window.setTimeout(() => {
      if (nextPhase) setPhase(nextPhase);
      else finish();
    }, durations[phase as Exclude<Phase, "exit">]);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, soloIndex, players.length, perPlayerMs, finish]);

  // Esc skips straight to the dashboard.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") finish();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [finish]);

  const tapToStart = () => {
    const el = audioRef.current;
    if (el) {
      el.volume = 0.9;
      void el.play().catch(() => {});
    }
    setNeedsTap(false);
  };

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

  const soloPlayer = players[soloIndex] ?? null;

  return (
    <div
      className={`fixed inset-0 z-[60] flex items-center justify-center overflow-hidden bg-[radial-gradient(circle_at_50%_-10%,#7c2d67,#2b0a26_60%,#12040f)] text-white ${
        phase === "exit" ? "pointer-events-none opacity-0" : "opacity-100"
      }`}
      style={{ transitionProperty: "opacity", transitionDuration: `${EXIT_MS}ms`, transitionTimingFunction: "ease-in" }}
      role="dialog"
      aria-modal="true"
      aria-label={`${brand} — ${gameTitle}`}
    >
      <audio ref={audioRef} src={AUDIO_SRC} preload="auto" />

      <style>{`
        @keyframes gsoSweep { 0% { transform: translateX(-60%) rotate(8deg); opacity: 0 } 30% { opacity: .5 } 100% { transform: translateX(60%) rotate(8deg); opacity: 0 } }
        @keyframes gsoRise { 0% { transform: translateY(28px) scale(.94); opacity: 0 } 100% { transform: translateY(0) scale(1); opacity: 1 } }
        @keyframes gsoSlam { 0% { transform: scale(2.4); opacity: 0; filter: blur(14px) } 55% { transform: scale(.94); opacity: 1; filter: blur(0) } 75% { transform: scale(1.05) } 100% { transform: scale(1) } }
        @keyframes gsoPop { 0% { transform: scale(.4) rotate(-6deg); opacity: 0 } 60% { transform: scale(1.12) rotate(1deg) } 100% { transform: scale(1) rotate(0); opacity: 1 } }
        @keyframes gsoWordIn { 0% { transform: translateY(40px) skewX(-10deg); opacity: 0 } 45% { transform: translateY(0) skewX(0); opacity: 1 } 82% { opacity: 1 } 100% { opacity: 0; transform: translateY(-24px) }  }
        @keyframes gsoCardIn { 0% { transform: translateX(120px) rotate(6deg); opacity: 0 } 70% { transform: translateX(-8px) rotate(-1deg) } 100% { transform: translateX(0) rotate(0); opacity: 1 } }
        @keyframes gsoSoloIn { 0% { transform: scale(.7) translateY(30px); opacity: 0 } 60% { transform: scale(1.04) } 100% { transform: scale(1) translateY(0); opacity: 1 } }
        @keyframes gsoNameIn { 0% { transform: translateY(24px); opacity: 0; letter-spacing: .3em } 100% { transform: translateY(0); opacity: 1; letter-spacing: normal } }
        @keyframes gsoGlow { 0%,100% { text-shadow: 0 0 20px rgba(255,120,200,.5), 0 0 60px rgba(255,120,200,.25) } 50% { text-shadow: 0 0 32px rgba(255,170,220,.85), 0 0 90px rgba(255,120,200,.45) } }
        @keyframes gsoConfetti { 0% { transform: translate3d(0,-12vh,0) rotate(0); opacity: 1 } 100% { transform: translate3d(var(--dx,0),112vh,0) rotate(720deg); opacity: .9 } }
        @keyframes gsoPulseRing { 0% { transform: scale(.6); opacity: .7 } 100% { transform: scale(2.4); opacity: 0 } }
        @keyframes gsoSpin { to { transform: rotate(360deg) } }
        .gso-fade { animation: gsoRise .6s cubic-bezier(.2,1,.3,1) both }
        .gso-slam { animation: gsoSlam .8s cubic-bezier(.2,1.3,.3,1) both }
        .gso-pop { animation: gsoPop .6s cubic-bezier(.2,1.5,.3,1) both }
        .gso-glow { animation: gsoGlow 2.4s ease-in-out infinite }
        .gso-word { animation: gsoWordIn 760ms cubic-bezier(.2,1,.3,1) both }
        .gso-card { animation: gsoCardIn .62s cubic-bezier(.2,1.2,.3,1) both }
        .gso-solo { animation: gsoSoloIn .55s cubic-bezier(.2,1.4,.3,1) both }
        .gso-name { animation: gsoNameIn .5s cubic-bezier(.2,1,.3,1) both }
        .gso-confetti-piece { position: absolute; top: -12vh; border-radius: 2px; animation: gsoConfetti linear forwards }
        .gso-sweep { position: absolute; inset: -20% -30%; background: linear-gradient(90deg, transparent, rgba(255,190,235,.22), transparent); animation: gsoSweep 3.4s ease-in-out infinite }
        .gso-rays { position: absolute; left: 50%; top: 50%; width: 160vmax; height: 160vmax; transform: translate(-50%,-50%); background: repeating-conic-gradient(from 0deg, rgba(255,180,230,.10) 0deg 8deg, transparent 8deg 20deg); animation: gsoSpin 24s linear infinite }
        @media (prefers-reduced-motion: reduce) {
          .gso-slam, .gso-pop, .gso-word, .gso-card, .gso-fade, .gso-solo, .gso-name { animation-duration: .01ms !important; animation-iteration-count: 1 !important }
          .gso-glow, .gso-sweep, .gso-rays, .gso-confetti-piece { animation: none !important }
        }
      `}</style>

      {/* moving spotlight sheen */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="gso-sweep" />
        <div
          className="absolute inset-0 opacity-[0.10]"
          style={{ backgroundImage: "radial-gradient(circle, #ff8ad0 1px, transparent 1px)", backgroundSize: "34px 34px" }}
        />
      </div>

      {/* skip */}
      <button
        type="button"
        onClick={finish}
        className="absolute right-5 top-5 z-10 rounded-full bg-white/10 px-4 py-2 text-xs font-black uppercase tracking-widest text-white/80 ring-1 ring-white/20 backdrop-blur hover:bg-white/20"
      >
        {t("openSkip")}
      </button>

      <div className="relative z-[5] w-full max-w-[min(92vw,72rem)] px-6 text-center">
        {phase === "presents" ? (
          <div key="presents">
            <p className="gso-fade text-[clamp(.8rem,1.8vw,1.4rem)] font-black uppercase tracking-[.4em] text-pink-200/80">
              {t("openPresents")}
            </p>
            <h1 className="gso-slam gso-glow display mt-4 text-[clamp(3.5rem,14vw,11rem)] font-black uppercase leading-[.85] tracking-tight">
              {brand}
            </h1>
            <p className="gso-fade mt-6 text-[clamp(.9rem,2vw,1.6rem)] font-bold text-white/70" style={{ animationDelay: "420ms" }}>
              {t("openTagline")}
            </p>
          </div>
        ) : null}

        {phase === "title" ? (
          <div key="title">
            <p className="gso-fade text-[clamp(.8rem,1.8vw,1.4rem)] font-black uppercase tracking-[.4em] text-pink-200/80">
              {t("openTonight")}
            </p>
            <h2 className="gso-slam display mt-4 text-[clamp(2.6rem,9vw,7.5rem)] font-black uppercase leading-[.92]">
              {gameTitle}
            </h2>
            <div className="gso-fade mx-auto mt-8 h-1 w-40 rounded-full bg-gradient-to-r from-transparent via-pink-300 to-transparent" style={{ animationDelay: "360ms" }} />
          </div>
        ) : null}

        {phase === "words" ? (
          <div key="words" className="flex min-h-[40vh] flex-col items-center justify-center gap-3">
            {words.map((word, i) => (
              <p
                key={word + i}
                className="gso-word display text-[clamp(2.4rem,8vw,6.5rem)] font-black uppercase leading-[.9]"
                style={{ animationDelay: `${i * wordMs}ms` }}
              >
                {word}
              </p>
            ))}
          </div>
        ) : null}

        {phase === "solo" && soloPlayer ? (
          <div key={`solo-${soloPlayer.id}`} className="relative flex min-h-[60vh] flex-col items-center justify-center">
            <div className="pointer-events-none absolute inset-0 grid place-items-center">
              <div className="gso-rays opacity-60" />
            </div>
            <p className="gso-fade relative text-[clamp(.7rem,1.5vw,1.2rem)] font-black uppercase tracking-[.4em] text-pink-200/70">
              {t("openWelcome")} · {soloIndex + 1}/{players.length}
            </p>
            <div className="gso-solo relative mt-6">
              <SoloAvatar player={soloPlayer} />
            </div>
            <p className="gso-name display relative mt-6 text-[clamp(2.4rem,8vw,6rem)] font-black uppercase leading-[.9]">
              {soloPlayer.name}
            </p>
          </div>
        ) : null}

        {phase === "all" ? (
          <div key="all">
            <p className="gso-fade text-[clamp(.8rem,1.8vw,1.4rem)] font-black uppercase tracking-[.4em] text-pink-200/80">
              {t("openWelcome")}
            </p>
            <div className="mt-8 flex flex-wrap items-stretch justify-center gap-[clamp(.6rem,1.5vw,1.1rem)]">
              {players.length === 0 ? (
                <p className="gso-fade text-[clamp(1.2rem,3vw,2rem)] font-black text-white/70">{t("waiting")}</p>
              ) : (
                players.map((player, i) => (
                  <div
                    key={player.id}
                    className="gso-card flex w-[clamp(140px,18vw,210px)] flex-col items-center gap-3 rounded-[24px] border border-white/15 bg-white/10 p-[clamp(.9rem,1.6vw,1.4rem)] backdrop-blur"
                    style={{ animationDelay: reducedMotion ? "0ms" : `${i * 90}ms` }}
                  >
                    <SoloAvatar player={player} compact />
                    <p className="w-full truncate text-[clamp(1rem,1.8vw,1.5rem)] font-black leading-tight">{player.name}</p>
                  </div>
                ))
              )}
            </div>
          </div>
        ) : null}

        {phase === "begin" || phase === "exit" ? (
          <div key="begin" className="relative">
            {phase === "begin"
              ? confetti.map((c, i) => (
                  <span
                    key={i}
                    className="gso-confetti-piece"
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
                ))
              : null}
            <p className="gso-fade flex items-center justify-center gap-3 text-[clamp(.8rem,1.8vw,1.4rem)] font-black uppercase tracking-[.4em] text-pink-200/80">
              <Sparkles size="1.1em" /> {brand}
            </p>
            <h2 className="gso-pop display mt-4 text-[clamp(2.6rem,9vw,7.5rem)] font-black uppercase leading-[.9]">
              {t("openLetsBegin")}
            </h2>
            <p className="gso-fade mt-6 flex items-center justify-center gap-2 text-[clamp(.9rem,2vw,1.5rem)] font-bold text-white/70" style={{ animationDelay: "360ms" }}>
              <PartyPopper size="1.1em" /> {gameTitle}
            </p>
          </div>
        ) : null}
      </div>

      {needsTap ? (
        <button
          type="button"
          onClick={tapToStart}
          className="absolute inset-0 z-20 grid place-items-center bg-black/45 backdrop-blur-sm"
        >
          <span className="flex items-center gap-3 rounded-full bg-white px-7 py-4 text-lg font-black text-[#2b0a26] shadow-2xl">
            <span className="relative grid place-items-center">
              <span className="absolute size-10 rounded-full bg-pink-400/50" style={{ animation: "gsoPulseRing 1.4s ease-out infinite" }} />
              <Volume2 />
            </span>
            {t("openTapForSound")}
          </span>
        </button>
      ) : null}
    </div>
  );
}

function SoloAvatar({ player, compact = false }: { player: OpeningPlayer; compact?: boolean }) {
  const [failed, setFailed] = useState(false);
  const initials = useMemo(() => {
    const parts = player.name.trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return "?";
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }, [player.name]);

  const size = compact
    ? "size-[clamp(56px,7vw,84px)] ring-2"
    : "size-[clamp(120px,18vw,220px)] ring-4";
  const base = `${size} shrink-0 rounded-full ring-white/40`;

  if (!player.hasAvatar || failed) {
    return (
      <span
        className={`grid place-items-center ${base} bg-gradient-to-br from-pink-400 to-violet-600 ${
          compact ? "text-[clamp(1.1rem,2vw,1.6rem)]" : "text-[clamp(2.5rem,6vw,5rem)]"
        } font-black uppercase leading-none text-white`}
        aria-hidden="true"
      >
        {initials}
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={player.avatarSrc} alt="" className={`${base} object-cover`} onError={() => setFailed(true)} />
  );
}
