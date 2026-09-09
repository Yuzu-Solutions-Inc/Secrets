"use client";

import { Lightbulb, Maximize2, Megaphone, PartyPopper, ShieldQuestion, Siren, Sparkles, Timer, Unlock, Volume2, VolumeX, Zap } from "lucide-react";
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

export type DashboardData = {
  game: Row;
  players: Row[];
  round: Row | null;
  latest_event: Row | null;
  recent_events: Row[] | null;
  accusation: Accusation | null;
  accusation_queue: number | null;
  verdict: Verdict | null;
};

// A broadcast event holds the screen full-size for a minute, then lives on in
// the history column (item 18). Phones show it for 5s (player dashboard).
const TAKEOVER_MS = 60_000;

const EVENT_META: Record<string, { icon: typeof Megaphone; tint: string; label: string }> = {
  announcement: { icon: Megaphone, tint: "from-pink-500 to-fuchsia-600", label: "Announcement" },
  clue: { icon: Lightbulb, tint: "from-amber-400 to-orange-500", label: "Clue" },
  dilemma: { icon: ShieldQuestion, tint: "from-violet-500 to-indigo-600", label: "Dilemma" },
  power: { icon: Zap, tint: "from-emerald-500 to-teal-600", label: "Power" },
};

export function PublicDisplay({ code, initialData }: { locale: string; code: string; initialData: DashboardData }) {
  const t = useTranslations("display");
  const [data, setData] = useState<DashboardData>(initialData);
  const [now, setNow] = useState<number | null>(null);
  const [soundOn, setSoundOn] = useState(true);
  const [alarm, setAlarm] = useState(false);
  const [verdictCard, setVerdictCard] = useState<Verdict | null>(null);
  const [takeover, setTakeover] = useState<Row | null>(null);

  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null);
  const fetchingRef = useRef(false);
  const debounceRef = useRef<number | null>(null);
  const audioRef = useRef<AudioContext | null>(null);
  const announcedRef = useRef<string | null>(null);
  const verdictSeenRef = useRef<string | null>(null);
  const eventSeenRef = useRef<string | null>(null);
  const mountedRef = useRef(false);

  const game = data.game;
  const players = useMemo(() => data.players ?? [], [data.players]);
  const round = data.round;
  const recentEvents = useMemo(() => data.recent_events ?? [], [data.recent_events]);
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

  const playEventChime = useCallback(
    (kind: string) => {
      const ctx = ensureAudio();
      if (!ctx || ctx.state !== "running") return;
      if (kind === "clue") {
        tone(0, 880, 0.18, "sine", 0.22);
        tone(0.14, 1174.7, 0.4, "sine", 0.22);
      } else if (kind === "dilemma") {
        tone(0, 392, 0.22, "triangle", 0.24);
        tone(0.18, 523.25, 0.22, "triangle", 0.24);
        tone(0.36, 392, 0.4, "triangle", 0.2);
      } else if (kind === "power") {
        tone(0, 659.25, 0.14, "square", 0.2);
        tone(0.12, 987.77, 0.5, "square", 0.2);
      } else {
        tone(0, 587.33, 0.16, "triangle", 0.26);
        tone(0.16, 783.99, 0.5, "triangle", 0.26);
      }
    },
    [ensureAudio, tone],
  );

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

  // Seed the "last seen event" once, so the first paint never fires a takeover.
  const eventSeededRef = useRef(false);
  useEffect(() => {
    if (eventSeededRef.current) return;
    eventSeededRef.current = true;
    eventSeenRef.current = recentEvents[0] ? String(recentEvents[0].id) : null;
  }, [recentEvents]);

  // ---- new broadcast: full-screen takeover, then it drops into history ----
  useEffect(() => {
    if (!eventSeededRef.current) return;
    const newest = recentEvents[0];
    const id = newest ? String(newest.id) : null;
    if (!id || id === eventSeenRef.current) return;
    eventSeenRef.current = id;
    setTakeover(newest);
    if (soundOn) playEventChime(String(newest.kind ?? "announcement"));
    const clear = window.setTimeout(() => setTakeover(null), TAKEOVER_MS);
    return () => window.clearTimeout(clear);
  }, [recentEvents, soundOn, playEventChime]);

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

  // ---- balances board: paginate + auto-rotate when players overflow ----
  // A stable signature of only the fields the cards render. The 1s clock tick
  // and no-op refetches (poll every 3s) still re-render the shell, but this
  // keeps `boardPlayers` referentially stable so the card grid is not rebuilt
  // and the page-turn animation is not restarted unless something changed.
  const playersSig = useMemo(
    () =>
      players
        .map((p) => `${String(p.id)}:${String(p.display_name ?? "")}:${Number(p.balance ?? 0)}:${p.secret_revealed ? 1 : 0}`)
        .sort()
        .join("|"),
    [players],
  );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const boardPlayers = useMemo(() => players, [playersSig]);

  // Up to 9 cards fit legibly on the board; beyond that, split into balanced
  // pages that auto-advance every 5s.
  const MAX_PER_PAGE = 9;
  const pageCount = Math.max(1, Math.ceil(boardPlayers.length / MAX_PER_PAGE));
  const perPage = Math.ceil(boardPlayers.length / pageCount) || 1;
  const paginated = pageCount > 1;
  const [boardPage, setBoardPage] = useState(0);
  const safePage = boardPage % pageCount;

  useEffect(() => {
    if (pageCount <= 1) return;
    const id = window.setInterval(() => setBoardPage((p) => (p + 1) % pageCount), 5000);
    return () => window.clearInterval(id);
  }, [pageCount]);

  const pagePlayers = paginated
    ? boardPlayers.slice(safePage * perPage, safePage * perPage + perPage)
    : boardPlayers;

  const cardGrid = useMemo(
    () => (
      <div
        key={safePage}
        className="secrets-cards-page grid content-start gap-[clamp(.5rem,1.2vw,1rem)] overflow-y-auto"
        style={{
          // Cards have a real min and max width and a capped height — they don't
          // stretch to consume empty space when there are only a few players.
          gridTemplateColumns: "repeat(auto-fill, minmax(clamp(180px, 20vw, 300px), 1fr))",
          gridAutoRows: "minmax(clamp(96px, 13vh, 150px), auto)",
        }}
      >
        {pagePlayers.map((player) => {
          const revealed = Boolean(player.secret_revealed);
          return (
            <div
              key={String(player.id)}
              className={`flex flex-col justify-center rounded-[18px] px-[clamp(.75rem,1.4vw,1.25rem)] py-[clamp(.6rem,1.1vw,1rem)] ${revealed ? "bg-violet-100 ring-2 ring-violet-500" : "bg-pink-50"}`}
            >
              <div className="flex items-center gap-[clamp(.5rem,1vw,.85rem)]">
                <BoardAvatar
                  src={`/api/assets/avatar/public/${code}/${String(player.id)}`}
                  name={String(player.display_name ?? "?")}
                  revealed={revealed}
                />
                <p className="truncate text-[clamp(.95rem,1.5vw,1.4rem)] font-black">{String(player.display_name ?? "Player")}</p>
              </div>
              <p className={`display mt-[clamp(.35rem,.8vw,.6rem)] text-[clamp(1.2rem,2.1vw,1.9rem)] font-black leading-none ${revealed ? "text-violet-800" : "text-pink-700"}`}>
                {formatMoney(Number(player.balance ?? 0), String(game.currency_symbol))}
              </p>
              {revealed ? (
                <p className="secrets-reveal-badge mt-[clamp(.35rem,.8vw,.6rem)] inline-flex w-fit items-center gap-[6px] rounded-full bg-violet-600 px-[10px] py-[3px] text-[clamp(.6rem,.9vw,.78rem)] font-black uppercase tracking-widest text-white">
                  <Unlock size={12} /> {t("secretOut")}
                </p>
              ) : null}
            </div>
          );
        })}
      </div>
    ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [playersSig, safePage],
  );

  return (
    <div
      className="fixed inset-0 flex flex-col overflow-hidden bg-[radial-gradient(circle_at_8%_5%,rgba(255,134,200,.34),transparent_28rem),radial-gradient(circle_at_92%_16%,rgba(190,140,255,.24),transparent_24rem),linear-gradient(160deg,var(--cream),var(--blush))] bg-cover bg-center text-[color:var(--ink)]"
      style={game.background_path ? { backgroundImage: `linear-gradient(rgba(255,250,252,.86),rgba(255,240,248,.9)),url(/api/assets/background/${String(game.public_code)})` } : undefined}
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
        @keyframes secretsPageIn { 0% { opacity: 0; transform: translateY(20px) } 100% { opacity: 1; transform: translateY(0) } }
        .secrets-cards-page { animation: secretsPageIn .7s cubic-bezier(.2,1,.3,1) both }
        .secrets-alarm { animation: secretsAlarmFlash 2.6s ease-out forwards }
        .secrets-alarm-word { animation: secretsAlarmSlam .7s cubic-bezier(.2,1.4,.3,1) forwards }
        .secrets-spot { animation: secretsSpotIn .45s cubic-bezier(.2,1,.3,1) both }
        .secrets-verdict { animation: secretsVerdictIn .55s cubic-bezier(.2,1.5,.3,1) both, secretsVerdictOut .6s ease-in 5.6s forwards }
        .secrets-verdict-shake { animation: secretsVerdictIn .5s ease-out both, secretsShake .6s ease-in-out .4s, secretsVerdictOut .6s ease-in 5.6s forwards }
        .secrets-confetti-piece { position: absolute; top: -12vh; border-radius: 2px; animation: secretsConfetti linear forwards }
        .secrets-reveal-badge { animation: secretsRevealPop .5s cubic-bezier(.2,1.6,.35,1) both }
        .tv-text-shadow { text-shadow: 0 1px 3px rgba(255,255,255,.7) }
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

      {takeover ? (() => {
        const meta = EVENT_META[String(takeover.kind)] ?? EVENT_META.announcement;
        const Icon = meta.icon;
        return (
          <div className="pointer-events-none absolute inset-0 z-[45] grid place-items-center overflow-hidden p-[clamp(1rem,4vw,4rem)]">
            <div className={`secrets-verdict relative w-full max-w-[min(90vw,64rem)] rounded-[clamp(2rem,4vw,4rem)] border border-white/25 bg-gradient-to-br ${meta.tint} p-[clamp(2rem,5vw,5rem)] text-center shadow-[0_40px_120px_rgba(0,0,0,.5)] backdrop-blur-md`}>
              <p className="tv-text-shadow flex items-center justify-center gap-4 text-[clamp(.9rem,1.6vw,1.8rem)] font-black uppercase tracking-[.3em] text-white/90">
                <Icon size="1.2em" /> {meta.label}
              </p>
              <h2 className="tv-text-shadow display mt-[clamp(.5rem,1.5vw,1.25rem)] text-[clamp(2rem,6vw,5rem)] font-black leading-[1] text-white">
                {String(takeover.title)}
              </h2>
              {takeover.body ? (
                <p className="tv-text-shadow mx-auto mt-[clamp(.5rem,1.6vw,1.5rem)] max-w-[40ch] text-[clamp(1rem,2vw,2rem)] font-bold text-white/95">
                  {String(takeover.body)}
                </p>
              ) : null}
            </div>
          </div>
        );
      })() : null}

      {/* Fluid layout — fills the viewport in fullscreen and maximises the
          available space when windowed, instead of a fixed stage scaled down. */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.06]"
        style={{ backgroundImage: "radial-gradient(circle, var(--pink) 1px, transparent 1px)", backgroundSize: "30px 30px" }}
      />

      <div className="screen-safe relative z-10 flex min-h-0 flex-1 flex-col gap-[clamp(.75rem,2vh,1.5rem)]">
        <header className="flex items-start justify-between gap-[clamp(1rem,3vw,2.5rem)]">
          <h1 className="tv-text-shadow display line-clamp-2 min-w-0 text-[clamp(1.75rem,4.4vw,4rem)] font-black leading-[1.02] text-[color:var(--ink)]">
            {String(game.title)}
          </h1>
          <div className="flex shrink-0 items-start gap-[clamp(.5rem,1.5vw,1rem)]">
            <div className="text-right">
              <p className="text-[clamp(.7rem,1.3vw,1.05rem)] font-black uppercase tracking-[.2em] text-pink-600">
                {String(round?.title ?? t("waiting"))}
              </p>
              {remaining !== null ? (
                <div className="mt-[4px] flex items-center justify-end gap-[clamp(.4rem,1vw,.75rem)] text-[color:var(--ink)]">
                  <Timer className="size-[clamp(1.4rem,2.6vw,2.4rem)] text-pink-500" />
                  <span className="display text-[clamp(1.9rem,4.4vw,3.75rem)] font-black tabular-nums leading-none">
                    {String(Math.floor(remaining / 60)).padStart(2, "0")}:{String(remaining % 60).padStart(2, "0")}
                  </span>
                </div>
              ) : null}
            </div>
            <button
              onClick={() => {
                ensureAudio();
                void document.documentElement.requestFullscreen().catch(() => {});
              }}
              aria-label={t("fullscreen")}
              className="grid size-[clamp(40px,4vw,56px)] shrink-0 place-items-center rounded-full bg-white text-[color:var(--ink)] ring-1 ring-[var(--border)] shadow-sm"
            >
              <Maximize2 className="size-1/2" />
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
              className="grid size-[clamp(40px,4vw,56px)] shrink-0 place-items-center rounded-full bg-white text-[color:var(--ink)] ring-1 ring-[var(--border)] shadow-sm"
            >
              {soundOn ? <Volume2 className="size-1/2" /> : <VolumeX className="size-1/2" />}
            </button>
          </div>
        </header>

        {accusation ? (
          <div
            key={accusation.id}
            className="secrets-spot flex items-center justify-between gap-[clamp(1rem,3vw,1.5rem)] overflow-hidden rounded-[24px] border border-rose-200/60 bg-[linear-gradient(120deg,#be123c,#7e22ce)] px-[clamp(1.25rem,3vw,2rem)] py-[clamp(.75rem,1.6vw,1.15rem)] shadow-[0_18px_50px_rgba(190,18,60,.5)]"
          >
            <div className="min-w-0">
              <p className="tv-text-shadow flex items-center gap-[10px] text-[clamp(.7rem,1.1vw,1rem)] font-black uppercase tracking-[.22em] text-rose-50">
                <Siren className="size-[1em]" /> {t("accusation")} · {statusLabel(accusation.status)}
              </p>
              <p className="tv-text-shadow display mt-[4px] truncate text-[clamp(1.5rem,3.4vw,2.4rem)] font-black leading-none text-white">
                {String(accusation.accuser ?? "?")} <span className="text-rose-100">→</span> {String(accusation.target ?? "?")}
              </p>
              <p className="tv-text-shadow mt-[4px] truncate text-[clamp(.85rem,1.4vw,1.1rem)] font-semibold text-white/90">
                &ldquo;{String(accusation.theory)}&rdquo;
              </p>
            </div>
            {accusationQueue > 0 ? (
              <span className="shrink-0 rounded-full bg-black/30 px-[clamp(.75rem,1.6vw,1.15rem)] py-[8px] text-[clamp(.8rem,1.1vw,1rem)] font-black uppercase tracking-widest text-white">
                {t("queue", { count: accusationQueue })}
              </span>
            ) : null}
          </div>
        ) : null}

        <div className="grid min-h-0 flex-1 gap-[clamp(.75rem,2vw,1.5rem)] lg:grid-cols-[1fr_2fr]">
          <aside className="flex min-h-0 flex-col gap-[clamp(.75rem,1.5vw,1rem)] overflow-hidden rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-[clamp(1.25rem,2.5vw,2rem)] shadow-[var(--shadow)] backdrop-blur-xl">
            <p className="flex items-center gap-[8px] text-[clamp(.7rem,1.2vw,1rem)] font-black uppercase tracking-[.2em] text-pink-600">
              <Sparkles className="size-[1em]" /> {t("live")}
            </p>
            <div className="flex min-h-0 flex-1 flex-col gap-[clamp(.5rem,1vw,.75rem)] overflow-y-auto">
              {recentEvents.length ? (
                recentEvents.map((event, index) => {
                  const meta = EVENT_META[String(event.kind)] ?? EVENT_META.announcement;
                  const Icon = meta.icon;
                  return (
                    <div
                      key={String(event.id)}
                      className={`rounded-[18px] border border-[var(--border)] bg-[var(--blush)] p-[clamp(.85rem,1.5vw,1.15rem)] text-[color:var(--ink)] ${index === 0 ? "" : "opacity-70"}`}
                    >
                      <p className="flex items-center gap-[6px] text-[clamp(.6rem,.9vw,.75rem)] font-black uppercase tracking-widest text-pink-600">
                        <Icon size="1em" /> {meta.label}
                      </p>
                      <h3 className="display mt-[4px] line-clamp-2 text-[clamp(1rem,1.7vw,1.4rem)] font-black leading-tight">{String(event.title)}</h3>
                      {event.body ? <p className="mt-[4px] line-clamp-3 text-[clamp(.8rem,1.2vw,1rem)] font-medium leading-snug text-[color:var(--muted)]">{String(event.body)}</p> : null}
                    </div>
                  );
                })
              ) : (
                <p className="text-[clamp(.85rem,1.3vw,1.05rem)] font-semibold text-[color:var(--muted)]">{t("waiting")}</p>
              )}
            </div>
          </aside>

          <article className="flex min-h-0 flex-col rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-[clamp(1.25rem,2.2vw,1.75rem)] text-[color:var(--ink)] shadow-[var(--shadow)] backdrop-blur-xl">
            <div className="flex items-baseline justify-between gap-[16px]">
              <p className="text-[clamp(.7rem,1.2vw,1rem)] font-black uppercase tracking-[.2em] text-pink-600">{t("balances")}</p>
              {paginated ? (
                <p className="text-[clamp(.75rem,1vw,.95rem)] font-black tabular-nums text-pink-400">{safePage + 1}/{pageCount}</p>
              ) : null}
            </div>
            <div className="relative mt-[clamp(.75rem,1.5vw,1rem)] min-h-0 flex-1">{cardGrid}</div>
            {paginated ? (
              <div className="mt-[14px] flex items-center justify-center gap-[8px]">
                {Array.from({ length: pageCount }).map((_, i) => (
                  <span
                    key={i}
                    className="h-[8px] rounded-full transition-all duration-500 ease-out"
                    style={{ width: i === safePage ? 30 : 8, background: i === safePage ? "#db2777" : "#f9d3e6" }}
                  />
                ))}
              </div>
            ) : null}
          </article>
        </div>
      </div>
    </div>
  );
}

// Player photo on the balances board; falls back to the gradient initial circle
// when there is no avatar or it fails to load.
function BoardAvatar({ src, name, revealed }: { src: string; name: string; revealed: boolean }) {
  const [failed, setFailed] = useState(false);
  const base =
    "size-[clamp(30px,3vw,44px)] shrink-0 rounded-full " +
    (revealed ? "bg-gradient-to-br from-violet-500 to-fuchsia-700" : "bg-gradient-to-br from-pink-400 to-violet-600");
  if (failed) {
    return (
      <span className={`grid place-items-center ${base} text-[clamp(.85rem,1.4vw,1.15rem)] font-black text-white`}>
        {name.slice(0, 1)}
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      className={`${base} object-cover`}
      onError={() => setFailed(true)}
    />
  );
}
