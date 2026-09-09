"use client";

import { Eye, Maximize2, Siren, Sparkles, Timer, Volume2, VolumeX } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
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

export function PublicDisplay({
  game,
  players,
  round,
  latestEvent,
  accusation,
  accusationQueue,
}: {
  locale: string;
  game: Row;
  players: Row[];
  round: Row | null;
  latestEvent: Row | null;
  accusation: Accusation | null;
  accusationQueue: number;
}) {
  const t = useTranslations("display");
  const router = useRouter();
  const [now, setNow] = useState<number | null>(null);
  const [soundOn, setSoundOn] = useState(true);
  const [alarm, setAlarm] = useState(false);

  const audioRef = useRef<AudioContext | null>(null);
  const announcedRef = useRef<string | null>(null);
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

  const playBuzzer = useCallback(() => {
    const ctx = ensureAudio();
    if (!ctx || ctx.state !== "running") return;
    const t0 = ctx.currentTime;
    // Two descending square-wave blasts — a game-show "wrong answer" buzzer.
    const blasts: Array<[number, number, number]> = [
      [0, 233, 0.3],
      [0.34, 175, 0.52],
    ];
    for (const [start, freq, dur] of blasts) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "square";
      osc.frequency.setValueAtTime(freq, t0 + start);
      gain.gain.setValueAtTime(0.0001, t0 + start);
      gain.gain.exponentialRampToValueAtTime(0.3, t0 + start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + start + dur);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t0 + start);
      osc.stop(t0 + start + dur + 0.05);
    }
  }, [ensureAudio]);

  // Clock + realtime display-cue subscription. Any queued cue (round change,
  // wallet move, published event, accusation created/resolved) re-fetches.
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
      return;
    }
    if (id && id !== announcedRef.current) {
      announcedRef.current = id;
      setAlarm(true);
      if (soundOn) playBuzzer();
      const clear = window.setTimeout(() => setAlarm(false), 2600);
      return () => window.clearTimeout(clear);
    }
  }, [accusation?.id, soundOn, playBuzzer]);

  const end = round?.ends_at ? new Date(String(round.ends_at)).getTime() : null;
  const remaining = end && now ? Math.max(0, Math.floor((end - now) / 1000)) : null;

  const statusLabel = (status: string) => {
    if (status === "confrontation") return t("faceOff");
    if (status === "confirmed") return t("awaitingRuling");
    return t("onBuzzer");
  };

  return (
    <main
      className="screen-safe relative min-h-dvh overflow-hidden bg-[radial-gradient(circle_at_top_left,#ff83c7,transparent_35%),radial-gradient(circle_at_bottom_right,#a855f7,transparent_40%),#2b0a2d] bg-cover bg-center text-white"
      style={game.background_path ? { backgroundImage: `linear-gradient(rgba(43,10,45,.74),rgba(43,10,45,.86)),url(/api/assets/background/${String(game.public_code)})` } : undefined}
    >
      <style>{`
        @keyframes secretsAlarmFlash { 0%,100% { opacity: 0 } 8% { opacity: .92 } 55% { opacity: .28 } }
        @keyframes secretsAlarmSlam { 0% { transform: scale(.4) rotate(-8deg); opacity: 0 } 40% { transform: scale(1.08) rotate(2deg); opacity: 1 } 60% { transform: scale(.98) rotate(-1deg) } 100% { transform: scale(1) rotate(0); opacity: 1 } }
        @keyframes secretsSpotIn { 0% { transform: translateY(24px) scale(.96); opacity: 0 } 100% { transform: translateY(0) scale(1); opacity: 1 } }
        .secrets-alarm { animation: secretsAlarmFlash 2.6s ease-out forwards }
        .secrets-alarm-word { animation: secretsAlarmSlam .7s cubic-bezier(.2,1.4,.3,1) forwards }
        .secrets-spot { animation: secretsSpotIn .45s cubic-bezier(.2,1,.3,1) both }
      `}</style>

      {alarm ? (
        <div className="pointer-events-none absolute inset-0 z-40 grid place-items-center">
          <div className="secrets-alarm absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(244,63,94,.65),rgba(127,6,34,.9))]" />
          <p className="secrets-alarm-word display relative flex items-center gap-4 text-[clamp(3rem,9vw,9rem)] font-black uppercase tracking-tight text-white drop-shadow-[0_8px_24px_rgba(0,0,0,.5)]">
            <Siren size="1em" /> {t("accusation")}
          </p>
        </div>
      ) : null}

      <div className="absolute inset-0 opacity-20" style={{ backgroundImage: "radial-gradient(circle, white 1px, transparent 1px)", backgroundSize: "28px 28px" }} />
      <section className="relative z-10 flex min-h-[calc(100dvh-8vw)] flex-col">
        <header className="flex items-start justify-between gap-6">
          <div>
            <p className="flex items-center gap-3 text-[clamp(.8rem,1.2vw,1.4rem)] font-black uppercase tracking-[.22em] text-pink-200">
              <Eye /> #{String(game.public_code)}
            </p>
            <h1 className="display mt-2 text-[clamp(3rem,7vw,8rem)] font-black leading-none">{String(game.title)}</h1>
          </div>
          <div className="flex gap-3">
            <button
              onClick={() => {
                ensureAudio();
                void document.documentElement.requestFullscreen();
              }}
              className="grid size-[clamp(3.5rem,5vw,6rem)] place-items-center rounded-full bg-white/15 backdrop-blur"
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
              className="grid size-[clamp(3.5rem,5vw,6rem)] place-items-center rounded-full bg-white/15 backdrop-blur"
            >
              {soundOn ? <Volume2 size="45%" /> : <VolumeX size="45%" />}
            </button>
          </div>
        </header>

        {accusation ? (
          <div
            key={accusation.id}
            className="secrets-spot relative mt-[clamp(1.5rem,3vw,3rem)] overflow-hidden rounded-[clamp(1.75rem,3vw,3rem)] border border-rose-300/50 bg-[linear-gradient(120deg,#e11d48,#9333ea)] p-[clamp(1.5rem,3vw,3.5rem)] shadow-[0_24px_80px_rgba(225,29,72,.45)]"
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="flex items-center gap-3 text-[clamp(.9rem,1.4vw,1.6rem)] font-black uppercase tracking-[.24em] text-rose-100">
                <Siren size="1.1em" /> {t("accusation")} · {statusLabel(accusation.status)}
              </p>
              {accusationQueue > 0 ? (
                <span className="rounded-full bg-white/20 px-[clamp(.8rem,1.4vw,1.4rem)] py-[clamp(.25rem,.6vw,.6rem)] text-[clamp(.85rem,1.3vw,1.4rem)] font-black uppercase tracking-widest">
                  {t("queue", { count: accusationQueue })}
                </span>
              ) : null}
            </div>
            <h2 className="display mt-[clamp(.75rem,1.6vw,1.5rem)] text-[clamp(2rem,4.4vw,5.5rem)] font-black leading-[.95]">
              {String(accusation.accuser ?? "?")} <span className="text-rose-200">→</span> {String(accusation.target ?? "?")}
            </h2>
            <p className="mt-[clamp(.5rem,1.4vw,1.25rem)] max-w-[26ch] text-[clamp(1.1rem,2vw,2.4rem)] font-semibold text-white/95 sm:max-w-none">
              &ldquo;{String(accusation.theory)}&rdquo;
            </p>
            <p className="mt-[clamp(.75rem,1.6vw,1.5rem)] text-[clamp(.85rem,1.2vw,1.3rem)] font-bold uppercase tracking-[.18em] text-rose-100/80">
              {t("awaitRuling")}
            </p>
          </div>
        ) : null}

        <div className="mt-[clamp(2rem,4vw,5rem)] grid flex-1 gap-[clamp(1rem,2vw,2.5rem)] lg:grid-cols-[.8fr_1.2fr]">
          <article className="flex flex-col justify-between rounded-[clamp(2rem,4vw,4rem)] border border-white/20 bg-white/12 p-[clamp(2rem,4vw,5rem)] backdrop-blur-xl">
            <div>
              <p className="text-[clamp(1rem,1.4vw,1.6rem)] font-black uppercase tracking-[.2em] text-pink-200">{t("round")}</p>
              <h2 className="display mt-4 text-[clamp(3rem,5vw,6.5rem)] font-black leading-[.95]">{String(round?.title ?? t("waiting"))}</h2>
            </div>
            {remaining !== null ? (
              <div className="mt-8 flex items-center gap-4">
                <Timer size="9%" />
                <span className="display text-[clamp(3rem,6vw,7rem)] font-black tabular-nums">
                  {String(Math.floor(remaining / 60)).padStart(2, "0")}:{String(remaining % 60).padStart(2, "0")}
                </span>
              </div>
            ) : null}
            {latestEvent ? (
              <div className="mt-8 rounded-[2rem] bg-white p-[clamp(1.5rem,2.5vw,3rem)] text-[var(--ink)]">
                <p className="flex items-center gap-2 font-black uppercase tracking-widest text-pink-600"><Sparkles /> Live</p>
                <h3 className="display mt-2 text-[clamp(2rem,3vw,4rem)] font-black">{String(latestEvent.title)}</h3>
                <p className="mt-2 text-[clamp(1rem,1.4vw,1.6rem)]">{String(latestEvent.body ?? "")}</p>
              </div>
            ) : null}
          </article>

          <article className="rounded-[clamp(2rem,4vw,4rem)] bg-white p-[clamp(2rem,3vw,4rem)] text-[var(--ink)]">
            <p className="text-[clamp(1rem,1.4vw,1.6rem)] font-black uppercase tracking-[.2em] text-pink-600">{t("balances")}</p>
            <div className="mt-[clamp(1rem,2vw,2rem)] grid grid-cols-2 gap-[clamp(.7rem,1.4vw,1.5rem)] xl:grid-cols-3">
              {players.map((player) => {
                return (
                  <div key={String(player.id)} className="rounded-[clamp(1.2rem,2vw,2rem)] bg-pink-50 p-[clamp(1rem,1.7vw,2rem)]">
                    <div className="flex items-center gap-3">
                      <span className="grid size-[clamp(2.5rem,4vw,5rem)] place-items-center rounded-full bg-gradient-to-br from-pink-400 to-violet-600 text-[clamp(1rem,2vw,2rem)] font-black text-white">
                        {String(player.display_name ?? "?").slice(0, 1)}
                      </span>
                      <p className="truncate text-[clamp(1rem,1.7vw,2rem)] font-black">{String(player.display_name ?? "Player")}</p>
                    </div>
                    <p className="display mt-3 text-[clamp(1.5rem,2.4vw,3rem)] font-black text-pink-700">
                      {formatMoney(Number(player.balance ?? 0), String(game.currency_symbol))}
                    </p>
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
