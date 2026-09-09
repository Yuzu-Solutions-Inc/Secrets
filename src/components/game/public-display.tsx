"use client";

import { Eye, Maximize2, PartyPopper, Siren, Sparkles, Timer, Unlock, Volume2, VolumeX } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";

import { createClient } from "@/lib/supabase/client";
import { formatMoney } from "@/lib/utils";

type Row = Record<string, unknown>;

type Accusation = {
  id: string;
  theory: string;
  stake: number;
  status: string;
  created_at: string;
  accuser: string | null;
  target: string | null;
};

type Verdict = {
  id: string;
  result: "correct" | "partial" | "wrong";
  theory: string;
  resolved_at: string;
  accuser: string | null;
  target: string | null;
  secret_revealed: boolean;
};

export function PublicDisplay({
  game,
  players,
  round,
  latestEvent,
  accusation,
  accusationQueue,
  verdict,
}: {
  locale: string;
  game: Row;
  players: Row[];
  round: Row | null;
  latestEvent: Row | null;
  accusation: Accusation | null;
  accusationQueue: number;
  verdict: Verdict | null;
}) {
  const t = useTranslations("display");
  const router = useRouter();
  const [now, setNow] = useState<number | null>(null);
  const [soundOn, setSoundOn] = useState(true);
  const [alarm, setAlarm] = useState(false);
  const [verdictCard, setVerdictCard] = useState<Verdict | null>(null);

  const audioRef = useRef<AudioContext | null>(null);
  const announcedRef = useRef<string | null>(null);
  const verdictSeenRef = useRef<string | null>(null);
  const mountedRef = useRef(false);
  const lastRefreshRef = useRef(0);

  // Lazily create / resume the AudioContext. Browsers keep it suspended until a
  // user gesture, so this is also called from the Fullscreen / sound buttons.
  const ensureAudio = useCallback(() => {
    if (typeof window === "undefined") return null;
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    if (!audioRef.current) audioRef.current = new Ctor();
    if (audioRef.current.state === "suspended") void audioRef.current.resume();
    return audioRef.current;
  }, []);

  const tone = useCallback(
    (start: number, freq: number, dur: number, type: OscillatorType, peak = 0.3) => {
      const ctx = audioRef.current;
      if (!ctx) return;
      const t0 = ctx.currentTime + start;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, t0);
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(peak, t0 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t0);
      osc.stop(t0 + dur + 0.05);
    },
    [],
  );

  const playBuzzer = useCallback(() => {
    const ctx = ensureAudio();
    if (!ctx || ctx.state !== "running") return;
    // Two descending square-wave blasts — a game-show "wrong answer" buzzer.
    tone(0, 233, 0.3, "square", 0.28);
    tone(0.34, 175, 0.52, "square", 0.28);
  }, [ensureAudio, tone]);

  const playFanfare = useCallback(
    (result: Verdict["result"]) => {
      const ctx = ensureAudio();
      if (!ctx || ctx.state !== "running") return;
      if (result === "correct") {
        // Bright rising arpeggio + sparkle.
        [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone(i * 0.12, f, 0.5, "triangle", 0.32));
        tone(0.5, 1568, 0.6, "sine", 0.16);
      } else if (result === "partial") {
        tone(0, 523.25, 0.28, "triangle", 0.3);
        tone(0.16, 698.46, 0.5, "triangle", 0.3);
      } else {
        // "womp womp"
        tone(0, 196, 0.32, "sawtooth", 0.26);
        tone(0.36, 146.83, 0.6, "sawtooth", 0.26);
      }
    },
    [ensureAudio, tone],
  );

  // Clock + realtime display-cue subscription. Any queued cue (round change,
  // wallet move, published event, accusation created / resolved) re-fetches.
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    const supabase = createClient();
    const channel = supabase
      .channel(`display:${String(game.id)}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "display_cues", filter: `game_id=eq.${String(game.id)}` },
        () => {
          const ts = Date.now();
          if (ts - lastRefreshRef.current < 300) return; // collapse trigger bursts
          lastRefreshRef.current = ts;
          router.refresh();
        },
      )
      .subscribe();
    return () => {
      window.clearInterval(timer);
      void supabase.removeChannel(channel);
    };
  }, [game.id, router]);

  // Fire the sting + flash when a brand-new buzz takes the spotlight. A buzz
  // that was already live when this TV connected is seeded silently.
  useEffect(() => {
    const id = accusation?.id ?? null;
    if (!mountedRef.current) {
      mountedRef.current = true;
      announcedRef.current = id;
      verdictSeenRef.current = verdict?.id ?? null;
      return;
    }
    if (id && id !== announcedRef.current) {
      announcedRef.current = id;
      setAlarm(true);
      if (soundOn) playBuzzer();
      const clear = window.setTimeout(() => setAlarm(false), 2600);
      return () => window.clearTimeout(clear);
    }
  }, [accusation?.id, verdict?.id, soundOn, playBuzzer]);

  // Hold the verdict card + celebration for a few seconds after the host rules.
  useEffect(() => {
    if (!verdict || verdict.id === verdictSeenRef.current) return;
    verdictSeenRef.current = verdict.id;
    setVerdictCard(verdict);
    if (soundOn) playFanfare(verdict.result);
    const clear = window.setTimeout(() => setVerdictCard(null), 6200);
    return () => window.clearTimeout(clear);
  }, [verdict, soundOn, playFanfare]);

  const confetti = useMemo(
    () =>
      Array.from({ length: 44 }, (_, i) => ({
        left: (i * 97) % 100,
        delay: ((i * 53) % 100) / 100,
        dur: 2.6 + (((i * 37) % 100) / 100) * 1.8,
        hue: (i * 47) % 360,
        size: 8 + ((i * 13) % 10),
        drift: ((i % 5) - 2) * 3,
      })),
    [],
  );

  const end = round?.ends_at ? new Date(String(round.ends_at)).getTime() : null;
  const remaining = end && now ? Math.max(0, Math.floor((end - now) / 1000)) : null;

  const statusLabel = (status: string) => {
    if (status === "confrontation") return t("faceOff");
    if (status === "confirmed") return t("awaitingRuling");
    return t("onBuzzer");
  };

  const verdictTitle = (result: Verdict["result"]) =>
    result === "correct" ? t("verdictCorrect") : result === "partial" ? t("verdictPartial") : t("verdictWrong");

  const verdictTint =
    verdictCard?.result === "correct"
      ? "from-emerald-500/95 via-teal-600/95 to-green-700/95"
      : verdictCard?.result === "partial"
        ? "from-amber-400/95 via-orange-500/95 to-amber-600/95"
        : "from-rose-600/95 via-rose-800/95 to-slate-900/95";

  return (
    <main
      className="screen-safe relative min-h-dvh overflow-hidden bg-[radial-gradient(circle_at_top_left,#ff83c7,transparent_35%),radial-gradient(circle_at_bottom_right,#a855f7,transparent_40%),#2b0a2d] bg-cover bg-center text-white"
      style={game.background_path ? { backgroundImage: `linear-gradient(rgba(43,10,45,.74),rgba(43,10,45,.86)),url(/api/assets/background/${String(game.public_code)})` } : undefined}
    >
      <style>{`
        @keyframes secretsAlarmFlash { 0%,100% { opacity: 0 } 8% { opacity: .92 } 55% { opacity: .28 } }
        @keyframes secretsAlarmSlam { 0% { transform: scale(.4) rotate(-8deg); opacity: 0 } 40% { transform: scale(1.08) rotate(2deg); opacity: 1 } 60% { transform: scale(.98) rotate(-1deg) } 100% { transform: scale(1) rotate(0); opacity: 1 } }
        @keyframes secretsSpotIn { 0% { transform: translateY(24px) scale(.96); opacity: 0 } 100% { transform: translateY(0) scale(1); opacity: 1 } }
        @keyframes secretsVerdictIn { 0% { transform: scale(.7); opacity: 0 } 55% { transform: scale(1.04) } 100% { transform: scale(1); opacity: 1 } }
        @keyframes secretsVerdictOut { to { opacity: 0 } }
        @keyframes secretsShake { 0%,100% { transform: translateX(0) } 20% { transform: translateX(-12px) } 40% { transform: translateX(10px) } 60% { transform: translateX(-7px) } 80% { transform: translateX(4px) } }
        @keyframes secretsConfetti { 0% { transform: translate3d(0,-12vh,0) rotate(0); opacity: 1 } 100% { transform: translate3d(var(--dx,0), 112vh, 0) rotate(720deg); opacity: .9 } }
        @keyframes secretsRevealPop { 0% { transform: scale(.5); opacity: 0 } 70% { transform: scale(1.12) } 100% { transform: scale(1); opacity: 1 } }
        .secrets-alarm { animation: secretsAlarmFlash 2.6s ease-out forwards }
        .secrets-alarm-word { animation: secretsAlarmSlam .7s cubic-bezier(.2,1.4,.3,1) forwards }
        .secrets-spot { animation: secretsSpotIn .45s cubic-bezier(.2,1,.3,1) both }
        .secrets-verdict { animation: secretsVerdictIn .55s cubic-bezier(.2,1.5,.3,1) both, secretsVerdictOut .6s ease-in 5.6s forwards }
        .secrets-verdict-shake { animation: secretsVerdictIn .5s ease-out both, secretsShake .6s ease-in-out .4s, secretsVerdictOut .6s ease-in 5.6s forwards }
        .secrets-confetti-piece { position: absolute; top: -12vh; border-radius: 2px; animation: secretsConfetti linear forwards }
        .secrets-reveal-badge { animation: secretsRevealPop .5s cubic-bezier(.2,1.6,.35,1) both }
        .tv-text-shadow { text-shadow: 0 2px 14px rgba(0,0,0,.55), 0 0 2px rgba(0,0,0,.35) }
      `}</style>

      {/* Legibility scrim over the bright brand gradient. */}
      <div className="pointer-events-none absolute inset-0 bg-[#160318]/45" />
      <div className="pointer-events-none absolute inset-0 opacity-[0.12]" style={{ backgroundImage: "radial-gradient(circle, white 1px, transparent 1px)", backgroundSize: "28px 28px" }} />

      {alarm ? (
        <div className="pointer-events-none absolute inset-0 z-40 grid place-items-center">
          <div className="secrets-alarm absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(244,63,94,.7),rgba(120,6,32,.94))]" />
          <p className="secrets-alarm-word display relative flex items-center gap-4 text-[clamp(3rem,9vw,9rem)] font-black uppercase tracking-tight text-white drop-shadow-[0_8px_24px_rgba(0,0,0,.6)]">
            <Siren size="1em" /> {t("accusation")}
          </p>
        </div>
      ) : null}

      {verdictCard ? (
        <div className="pointer-events-none absolute inset-0 z-50 grid place-items-center overflow-hidden p-[clamp(1rem,4vw,4rem)]">
          {verdictCard.result !== "wrong"
            ? confetti.map((c, i) => (
                <span
                  key={i}
                  className="secrets-confetti-piece"
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
          <div
            className={`${verdictCard.result === "wrong" ? "secrets-verdict-shake" : "secrets-verdict"} relative w-full max-w-[min(90vw,60rem)] rounded-[clamp(2rem,4vw,4rem)] border border-white/25 bg-gradient-to-br ${verdictTint} p-[clamp(2rem,5vw,5rem)] text-center shadow-[0_40px_120px_rgba(0,0,0,.55)] backdrop-blur-md`}
          >
            <p className="tv-text-shadow flex items-center justify-center gap-4 text-[clamp(.9rem,1.6vw,1.8rem)] font-black uppercase tracking-[.3em] text-white/90">
              {verdictCard.result === "wrong" ? <Siren size="1.2em" /> : <PartyPopper size="1.2em" />} {t("theVerdict")}
            </p>
            <h2 className="tv-text-shadow display mt-[clamp(.5rem,1.5vw,1.25rem)] text-[clamp(3rem,10vw,9rem)] font-black uppercase leading-[.9] text-white">
              {verdictTitle(verdictCard.result)}
            </h2>
            <p className="tv-text-shadow mt-[clamp(.5rem,1.6vw,1.5rem)] text-[clamp(1.25rem,3vw,3rem)] font-black text-white">
              {String(verdictCard.accuser ?? "?")} <span className="opacity-70">→</span> {String(verdictCard.target ?? "?")}
            </p>
            {verdictCard.secret_revealed ? (
              <p className="tv-text-shadow mx-auto mt-[clamp(.75rem,2vw,1.75rem)] max-w-[34ch] text-[clamp(1rem,1.8vw,1.7rem)] font-bold text-white/95">
                {t("hintsInVault", { name: String(verdictCard.target ?? "them") })}
              </p>
            ) : null}
          </div>
        </div>
      ) : null}

      <section className="relative z-10 flex min-h-[calc(100dvh-8vw)] flex-col">
        <header className="flex items-start justify-between gap-6">
          <div>
            <p className="tv-text-shadow flex items-center gap-3 text-[clamp(.8rem,1.2vw,1.4rem)] font-black uppercase tracking-[.22em] text-pink-100">
              <Eye /> #{String(game.public_code)}
            </p>
            <h1 className="tv-text-shadow display mt-2 text-[clamp(3rem,7vw,8rem)] font-black leading-none">{String(game.title)}</h1>
          </div>
          <div className="flex gap-3">
            <button
              onClick={() => {
                ensureAudio();
                void document.documentElement.requestFullscreen();
              }}
              className="grid size-[clamp(3.5rem,5vw,6rem)] place-items-center rounded-full bg-white/20 ring-1 ring-white/30 backdrop-blur"
            >
              <Maximize2 size="45%" />
            </button>
            <button
              onClick={() => {
                const next = !soundOn;
                setSoundOn(next);
                if (next) {
                  ensureAudio();
                  playBuzzer();
                }
              }}
              aria-label={t("sound")}
              aria-pressed={soundOn}
              className="grid size-[clamp(3.5rem,5vw,6rem)] place-items-center rounded-full bg-white/20 ring-1 ring-white/30 backdrop-blur"
            >
              {soundOn ? <Volume2 size="45%" /> : <VolumeX size="45%" />}
            </button>
          </div>
        </header>

        {accusation ? (
          <div
            key={accusation.id}
            className="secrets-spot relative mt-[clamp(1.5rem,3vw,3rem)] overflow-hidden rounded-[clamp(1.75rem,3vw,3rem)] border border-rose-200/60 bg-[linear-gradient(120deg,#be123c,#7e22ce)] p-[clamp(1.5rem,3vw,3.5rem)] shadow-[0_24px_80px_rgba(190,18,60,.5)]"
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="tv-text-shadow flex items-center gap-3 text-[clamp(.9rem,1.4vw,1.6rem)] font-black uppercase tracking-[.24em] text-rose-50">
                <Siren size="1.1em" /> {t("accusation")} · {statusLabel(accusation.status)}
              </p>
              {accusationQueue > 0 ? (
                <span className="rounded-full bg-black/30 px-[clamp(.8rem,1.4vw,1.4rem)] py-[clamp(.25rem,.6vw,.6rem)] text-[clamp(.85rem,1.3vw,1.4rem)] font-black uppercase tracking-widest text-white">
                  {t("queue", { count: accusationQueue })}
                </span>
              ) : null}
            </div>
            <h2 className="tv-text-shadow display mt-[clamp(.75rem,1.6vw,1.5rem)] text-[clamp(2rem,4.4vw,5.5rem)] font-black leading-[.95] text-white">
              {String(accusation.accuser ?? "?")} <span className="text-rose-100">→</span> {String(accusation.target ?? "?")}
            </h2>
            <p className="tv-text-shadow mt-[clamp(.5rem,1.4vw,1.25rem)] text-[clamp(1.1rem,2vw,2.4rem)] font-bold text-white">
              &ldquo;{String(accusation.theory)}&rdquo;
            </p>
            <p className="mt-[clamp(.75rem,1.6vw,1.5rem)] text-[clamp(.85rem,1.2vw,1.3rem)] font-bold uppercase tracking-[.18em] text-rose-50/90">
              {t("awaitRuling")}
            </p>
          </div>
        ) : null}

        <div className="mt-[clamp(2rem,4vw,5rem)] grid flex-1 gap-[clamp(1rem,2vw,2.5rem)] lg:grid-cols-[.8fr_1.2fr]">
          <article className="flex flex-col justify-between rounded-[clamp(2rem,4vw,4rem)] border border-white/25 bg-black/30 p-[clamp(2rem,4vw,5rem)] backdrop-blur-xl">
            <div>
              <p className="tv-text-shadow text-[clamp(1rem,1.4vw,1.6rem)] font-black uppercase tracking-[.2em] text-pink-100">{t("round")}</p>
              <h2 className="tv-text-shadow display mt-4 text-[clamp(3rem,5vw,6.5rem)] font-black leading-[.95] text-white">{String(round?.title ?? t("waiting"))}</h2>
            </div>
            {remaining !== null ? (
              <div className="mt-8 flex items-center gap-4 text-white">
                <Timer size="9%" />
                <span className="tv-text-shadow display text-[clamp(3rem,6vw,7rem)] font-black tabular-nums">
                  {String(Math.floor(remaining / 60)).padStart(2, "0")}:{String(remaining % 60).padStart(2, "0")}
                </span>
              </div>
            ) : null}
            {latestEvent ? (
              <div className="mt-8 rounded-[2rem] bg-white p-[clamp(1.5rem,2.5vw,3rem)] text-[#1f1024]">
                <p className="flex items-center gap-2 font-black uppercase tracking-widest text-pink-700"><Sparkles /> {t("live")}</p>
                <h3 className="display mt-2 text-[clamp(2rem,3vw,4rem)] font-black">{String(latestEvent.title)}</h3>
                <p className="mt-2 text-[clamp(1rem,1.4vw,1.6rem)] font-medium">{String(latestEvent.body ?? "")}</p>
              </div>
            ) : null}
          </article>

          <article className="rounded-[clamp(2rem,4vw,4rem)] bg-white p-[clamp(2rem,3vw,4rem)] text-[#1f1024]">
            <p className="text-[clamp(1rem,1.4vw,1.6rem)] font-black uppercase tracking-[.2em] text-pink-700">{t("balances")}</p>
            <div className="mt-[clamp(1rem,2vw,2rem)] grid grid-cols-2 gap-[clamp(.7rem,1.4vw,1.5rem)] xl:grid-cols-3">
              {players.map((player) => {
                const revealed = Boolean(player.secret_revealed);
                return (
                  <div
                    key={String(player.id)}
                    className={`rounded-[clamp(1.2rem,2vw,2rem)] p-[clamp(1rem,1.7vw,2rem)] ${revealed ? "bg-violet-100 ring-2 ring-violet-500" : "bg-pink-50"}`}
                  >
                    <div className="flex items-center gap-3">
                      <span className={`grid size-[clamp(2.5rem,4vw,5rem)] place-items-center rounded-full text-[clamp(1rem,2vw,2rem)] font-black text-white ${revealed ? "bg-gradient-to-br from-violet-500 to-fuchsia-700" : "bg-gradient-to-br from-pink-400 to-violet-600"}`}>
                        {String(player.display_name ?? "?").slice(0, 1)}
                      </span>
                      <p className="truncate text-[clamp(1rem,1.7vw,2rem)] font-black">{String(player.display_name ?? "Player")}</p>
                    </div>
                    <p className={`display mt-3 text-[clamp(1.5rem,2.4vw,3rem)] font-black ${revealed ? "text-violet-800" : "text-pink-700"}`}>
                      {formatMoney(Number(player.balance ?? 0), String(game.currency_symbol))}
                    </p>
                    {revealed ? (
                      <p className="secrets-reveal-badge mt-2 inline-flex items-center gap-1.5 rounded-full bg-violet-600 px-[clamp(.6rem,1vw,1rem)] py-[clamp(.15rem,.4vw,.4rem)] text-[clamp(.7rem,1vw,1.05rem)] font-black uppercase tracking-widest text-white">
                        <Unlock size="1em" /> {t("secretOut")}
                      </p>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </article>
        </div>
      </section>
    </main>
  );
}
