"use client";

import { Eye, Maximize2, PartyPopper, Siren, Sparkles, Timer, Unlock, Volume2, VolumeX } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";

import { createClient } from "@/lib/supabase/client";
import { formatMoney } from "@/lib/utils";

type Row = Record<string, unknown>;

const DESIGN_W = 1280;
const DESIGN_H = 800;

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

export type DashboardData = {
  game: Row;
  players: Row[];
  round: Row | null;
  latest_event: Row | null;
  accusation: Accusation | null;
  accusation_queue: number | null;
  verdict: Verdict | null;
};

export function PublicDisplay({ code, initialData }: { locale: string; code: string; initialData: DashboardData }) {
  const t = useTranslations("display");
  const [data, setData] = useState<DashboardData>(initialData);
  const [now, setNow] = useState<number | null>(null);
  const [soundOn, setSoundOn] = useState(true);
  const [alarm, setAlarm] = useState(false);
  const [verdictCard, setVerdictCard] = useState<Verdict | null>(null);

  const stageRef = useRef<HTMLDivElement>(null);
  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null);
  const fetchingRef = useRef(false);
  const debounceRef = useRef<number | null>(null);
  const audioRef = useRef<AudioContext | null>(null);
  const announcedRef = useRef<string | null>(null);
  const verdictSeenRef = useRef<string | null>(null);
  const mountedRef = useRef(false);

  const game = data.game;
  const players = data.players ?? [];
  const round = data.round;
  const latestEvent = data.latest_event;
  const accusation = data.accusation;
  const accusationQueue = data.accusation_queue ?? 0;
  const verdict = data.verdict;
  const gameId = String(game.id);

  const supabase = useCallback(() => {
    if (!supabaseRef.current) supabaseRef.current = createClient();
    return supabaseRef.current;
  }, []);

  const refetch = useCallback(async () => {
    if (fetchingRef.current) return;
    fetchingRef.current = true;
    try {
      const { data: fresh, error } = await supabase().rpc("public_game_dashboard", { p_code: code });
      if (!error && fresh && typeof fresh === "object") setData(fresh as DashboardData);
    } finally {
      fetchingRef.current = false;
    }
  }, [code, supabase]);

  const scheduleRefetch = useCallback(() => {
    if (debounceRef.current) return;
    debounceRef.current = window.setTimeout(() => {
      debounceRef.current = null;
      void refetch();
    }, 120);
  }, [refetch]);

  // ---- audio -------------------------------------------------------------
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
    tone(0, 233, 0.3, "square", 0.28);
    tone(0.34, 175, 0.52, "square", 0.28);
  }, [ensureAudio, tone]);

  const playFanfare = useCallback(
    (result: Verdict["result"]) => {
      const ctx = ensureAudio();
      if (!ctx || ctx.state !== "running") return;
      if (result === "correct") {
        [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone(i * 0.12, f, 0.5, "triangle", 0.32));
        tone(0.5, 1568, 0.6, "sine", 0.16);
      } else if (result === "partial") {
        tone(0, 523.25, 0.28, "triangle", 0.3);
        tone(0.16, 698.46, 0.5, "triangle", 0.3);
      } else {
        tone(0, 196, 0.32, "sawtooth", 0.26);
        tone(0.36, 146.83, 0.6, "sawtooth", 0.26);
      }
    },
    [ensureAudio, tone],
  );

  // ---- live data: realtime cue + poll fallback + focus refetch ----------
  useEffect(() => {
    const client = supabase();
    const channel = client
      .channel(`display:${gameId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "display_cues", filter: `game_id=eq.${gameId}` },
        scheduleRefetch,
      )
      .subscribe();
    const poll = window.setInterval(() => {
      if (document.visibilityState === "visible") void refetch();
    }, 3000);
    const clock = window.setInterval(() => setNow(Date.now()), 1000);
    const onVis = () => {
      if (document.visibilityState === "visible") void refetch();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.clearInterval(poll);
      window.clearInterval(clock);
      document.removeEventListener("visibilitychange", onVis);
      void client.removeChannel(channel);
    };
  }, [gameId, scheduleRefetch, refetch, supabase]);

  // ---- fit the fixed-size stage into exactly one viewport --------------
  useEffect(() => {
    const fit = () => {
      const vw = window.visualViewport?.width ?? window.innerWidth;
      const vh = window.visualViewport?.height ?? window.innerHeight;
      const s = Math.min(vw / DESIGN_W, vh / DESIGN_H);
      stageRef.current?.style.setProperty("--tv-s", String(s));
    };
    fit();
    window.addEventListener("resize", fit);
    window.addEventListener("orientationchange", fit);
    window.visualViewport?.addEventListener("resize", fit);
    return () => {
      window.removeEventListener("resize", fit);
      window.removeEventListener("orientationchange", fit);
      window.visualViewport?.removeEventListener("resize", fit);
    };
  }, []);

  // ---- fire the sting when a new buzz takes the spotlight --------------
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

  // ---- hold the verdict card + celebration after the host rules -------
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

  const cols = players.length <= 4 ? 2 : players.length <= 9 ? 3 : players.length <= 16 ? 4 : 5;

  return (
    <div
      className="screen-safe fixed inset-0 grid place-items-center overflow-hidden bg-[radial-gradient(circle_at_top_left,#ff83c7,transparent_35%),radial-gradient(circle_at_bottom_right,#a855f7,transparent_40%),#2b0a2d] bg-cover bg-center text-white"
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

      {/* Full-viewport overlays (outside the scaled stage). */}
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

      {/* Fixed-size stage, scaled to fit one viewport. */}
      <div
        ref={stageRef}
        className="relative shrink-0 origin-center"
        style={{ width: DESIGN_W, height: DESIGN_H, transform: "scale(var(--tv-s, 1))" }}
      >
        <div className="pointer-events-none absolute inset-0 bg-[#160318]/45" />
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.1]"
          style={{ backgroundImage: "radial-gradient(circle, white 1px, transparent 1px)", backgroundSize: "30px 30px" }}
        />

        <div className="relative z-10 flex h-full flex-col gap-[20px] p-[40px]">
          <header className="flex items-start justify-between gap-[24px]">
            <div className="min-w-0">
              <p className="tv-text-shadow flex items-center gap-[10px] text-[20px] font-black uppercase tracking-[.22em] text-pink-100">
                <Eye size={22} /> #{String(game.public_code)}
              </p>
              <h1 className="tv-text-shadow display mt-[6px] max-w-[820px] truncate text-[52px] font-black leading-none">
                {String(game.title)}
              </h1>
            </div>
            <div className="flex shrink-0 gap-[12px]">
              <button
                onClick={() => {
                  ensureAudio();
                  void document.documentElement.requestFullscreen().catch(() => {});
                }}
                className="grid size-[56px] place-items-center rounded-full bg-white/20 ring-1 ring-white/30 backdrop-blur"
              >
                <Maximize2 size={26} />
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
                className="grid size-[56px] place-items-center rounded-full bg-white/20 ring-1 ring-white/30 backdrop-blur"
              >
                {soundOn ? <Volume2 size={26} /> : <VolumeX size={26} />}
              </button>
            </div>
          </header>

          {accusation ? (
            <div
              key={accusation.id}
              className="secrets-spot flex items-center justify-between gap-[24px] overflow-hidden rounded-[24px] border border-rose-200/60 bg-[linear-gradient(120deg,#be123c,#7e22ce)] px-[32px] py-[18px] shadow-[0_18px_50px_rgba(190,18,60,.5)]"
            >
              <div className="min-w-0">
                <p className="tv-text-shadow flex items-center gap-[10px] text-[16px] font-black uppercase tracking-[.22em] text-rose-50">
                  <Siren size={18} /> {t("accusation")} · {statusLabel(accusation.status)}
                </p>
                <p className="tv-text-shadow display mt-[4px] truncate text-[38px] font-black leading-none text-white">
                  {String(accusation.accuser ?? "?")} <span className="text-rose-100">→</span> {String(accusation.target ?? "?")}
                </p>
                <p className="tv-text-shadow mt-[4px] truncate text-[17px] font-semibold text-white/90">
                  &ldquo;{String(accusation.theory)}&rdquo;
                </p>
              </div>
              {accusationQueue > 0 ? (
                <span className="shrink-0 rounded-full bg-black/30 px-[18px] py-[8px] text-[16px] font-black uppercase tracking-widest text-white">
                  {t("queue", { count: accusationQueue })}
                </span>
              ) : null}
            </div>
          ) : null}

          <div className="grid min-h-0 flex-1 grid-cols-[400px_minmax(0,1fr)] gap-[24px]">
            <aside className="flex min-h-0 flex-col rounded-[28px] border border-white/25 bg-black/35 p-[32px] backdrop-blur-xl">
              <p className="tv-text-shadow text-[18px] font-black uppercase tracking-[.2em] text-pink-100">{t("round")}</p>
              <h2 className="tv-text-shadow display mt-[10px] line-clamp-3 text-[44px] font-black leading-[.98] text-white">
                {String(round?.title ?? t("waiting"))}
              </h2>
              {remaining !== null ? (
                <div className="mt-[20px] flex items-center gap-[14px] text-white">
                  <Timer size={44} />
                  <span className="tv-text-shadow display text-[60px] font-black tabular-nums leading-none">
                    {String(Math.floor(remaining / 60)).padStart(2, "0")}:{String(remaining % 60).padStart(2, "0")}
                  </span>
                </div>
              ) : null}
              <div className="flex-1" />
              {latestEvent ? (
                <div className="rounded-[20px] bg-white p-[20px] text-[#1f1024]">
                  <p className="flex items-center gap-[8px] text-[14px] font-black uppercase tracking-widest text-pink-700">
                    <Sparkles size={16} /> {t("live")}
                  </p>
                  <h3 className="display mt-[6px] line-clamp-2 text-[24px] font-black leading-tight">{String(latestEvent.title)}</h3>
                  <p className="mt-[6px] line-clamp-3 text-[16px] font-medium leading-snug">{String(latestEvent.body ?? "")}</p>
                </div>
              ) : null}
            </aside>

            <article className="flex min-h-0 flex-col rounded-[28px] bg-white p-[28px] text-[#1f1024]">
              <p className="text-[18px] font-black uppercase tracking-[.2em] text-pink-700">{t("balances")}</p>
              <div
                className="mt-[16px] grid min-h-0 flex-1 gap-[14px] overflow-hidden"
                style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gridAutoRows: "minmax(0, 1fr)" }}
              >
                {players.map((player) => {
                  const revealed = Boolean(player.secret_revealed);
                  return (
                    <div
                      key={String(player.id)}
                      className={`flex flex-col justify-center rounded-[18px] px-[18px] py-[14px] ${revealed ? "bg-violet-100 ring-2 ring-violet-500" : "bg-pink-50"}`}
                    >
                      <div className="flex items-center gap-[12px]">
                        <span
                          className={`grid size-[42px] shrink-0 place-items-center rounded-full text-[18px] font-black text-white ${revealed ? "bg-gradient-to-br from-violet-500 to-fuchsia-700" : "bg-gradient-to-br from-pink-400 to-violet-600"}`}
                        >
                          {String(player.display_name ?? "?").slice(0, 1)}
                        </span>
                        <p className="truncate text-[21px] font-black">{String(player.display_name ?? "Player")}</p>
                      </div>
                      <p className={`display mt-[8px] text-[29px] font-black leading-none ${revealed ? "text-violet-800" : "text-pink-700"}`}>
                        {formatMoney(Number(player.balance ?? 0), String(game.currency_symbol))}
                      </p>
                      {revealed ? (
                        <p className="secrets-reveal-badge mt-[8px] inline-flex w-fit items-center gap-[6px] rounded-full bg-violet-600 px-[10px] py-[3px] text-[12px] font-black uppercase tracking-widest text-white">
                          <Unlock size={12} /> {t("secretOut")}
                        </p>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </article>
          </div>
        </div>
      </div>
    </div>
  );
}
