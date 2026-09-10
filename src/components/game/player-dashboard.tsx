"use client";

import {
  Coins,
  Eye,
  EyeOff,
  Lightbulb,
  Lock,
  LockKeyhole,
  Megaphone,
  ShieldQuestion,
  Users,
  X,
  Zap,
} from "lucide-react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { useEffect, useMemo, useRef, useState, useActionState } from "react";
import { useFormStatus } from "react-dom";
import { useTranslations } from "next-intl";

import {
  accusationBuzz,
  buyHint,
  createHintOffer,
  setDilemmaChoice,
  respondToDilemma,
  savePlayerNote,
  saveHouseNote,
  submitHouseTheory,
  shareHint,
  resolveHintOffer,
  revealMySecret,
  submitSecret,
  submitMission,
  markMissionSeen,
  stageAccusationBuzz,
} from "@/app/actions/game";
import { castVote } from "@/app/actions/admin";
import { createClient } from "@/lib/supabase/client";
import { formatMoney } from "@/lib/utils";
import { Avatar } from "./avatar";
import { HintIcon, isIconHint } from "./hint-icon";

type Player = {
  id: string;
  user_id: string;
  is_ready: boolean;
  play_status: string;
  profiles: { display_name?: string | null; avatar_path?: string | null } | null;
};

type VaultHint = {
  id: string;
  kind: string;
  text: string | null;
  has_image?: boolean;
  image_ref?: string | null;
  position: number;
  about_player_id: string | null;
  about_player_name: string | null;
};

type VaultNote = { target_player_id: string | null; body: string; updated_at: string };
type VaultAccusation = {
  target_player_id: string;
  theory: string;
  status: string;
  created_at: string;
  resolved_at: string | null;
};
type VaultPlayer = {
  id: string;
  user_id: string | null;
  name: string | null;
  avatar_path: string | null;
  secret_revealed: boolean;
  secret_text: string | null;
  hint_count: number;
};
type VaultHouse = {
  id: string;
  revealed: boolean;
  answer: string | null;
  note: string | null;
} | null;

type VaultData = {
  secret: { has: boolean; status: string | null };
  hints: VaultHint[];
  notes: VaultNote[];
  accusations: VaultAccusation[];
  players: VaultPlayer[];
  house: VaultHouse;
};

type Props = {
  locale: string;
  game: {
    id: string;
    title: string;
    status: string;
    currency_symbol: string;
    public_code: string;
    settings: unknown;
  };
  playerId: string;
  currentUserId: string;
  players: Player[];
  round: { id: string; title: string; kind: string; status: string; config: unknown; ends_at: string | null } | null;
  balance: number;
  missions: Array<Record<string, unknown>>;
  hints: Array<Record<string, unknown>>;
  notes: Array<Record<string, unknown>>;
  teamMember: Record<string, unknown> | null;
  hintOffers: Array<Record<string, unknown>>;
  houseSecret: Record<string, unknown> | null;
  houseAccusationOpen: boolean;
  activeBuzzes: Array<Record<string, unknown>>;
  vault: Record<string, unknown> | null;
  dilemmas?: Array<{ id: string; prompt: string; myChoice: "accept" | "refuse" | null }>;
  perks?: Array<{ id: string; kind: string; uses: number; expiresAt: string | null }>;
  latestBroadcast?: { id: string; kind: string; title: string; body: string | null } | null;
};

export function PlayerDashboard(props: Props) {
  const t = useTranslations("play");
  const router = useRouter();
  // Localised game-status label, falling back to the raw enum with underscores
  // spaced out if a status has no translation yet.
  const statusLabel = (status: string) =>
    t.has(`status.${status}`) ? t(`status.${status}`) : status.replaceAll("_", " ");
  const [modal, setModal] = useState<"accuse" | "hint" | "secret" | null>(null);
  const [secretState, submitSecretAction] = useActionState(submitSecret, { success: false, error: null });
  const [buzzState, buzzFormAction] = useActionState(accusationBuzz, { success: false, error: null });
  const [hintState, hintFormAction] = useActionState(buyHint, { success: false, error: null });
  const [houseState, houseFormAction] = useActionState(submitHouseTheory, { success: false, error: null });
  const targets = useMemo(
    () => props.players.filter((player) => player.id !== props.playerId),
    [props.players, props.playerId],
  );

  const vault = (props.vault ?? null) as unknown as VaultData | null;
  const me = useMemo(
    () => props.players.find((player) => player.id === props.playerId) ?? null,
    [props.players, props.playerId],
  );

  const [vaultOpen, setVaultOpen] = useState(false);
  const [ackedMissionIds, setAckedMissionIds] = useState<string[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [revealedSecret, setRevealedSecret] = useState<string | null>(null);
  const [revealArmed, setRevealArmed] = useState(false);
  const [revealing, setRevealing] = useState(false);

  const hasSecret = Boolean(vault?.secret?.has);
  const secretStatus = vault?.secret?.status ?? null;
  const submissionOpen = props.game.status === "draft" || props.game.status === "secret_submission";
  const gameEnded = props.game.status === "completed" || props.game.status === "archived";
  const canSetSecret = !gameEnded && (!hasSecret || (submissionOpen && secretStatus === "draft"));

  const hintsByPlayer = useMemo(() => {
    const groups = new Map<string, VaultHint[]>();
    for (const hint of vault?.hints ?? []) {
      const id = hint.about_player_id ?? "unknown";
      if (!groups.has(id)) groups.set(id, []);
      groups.get(id)!.push(hint);
    }
    return groups;
  }, [vault]);

  const houseClues = (props.houseSecret?.clues as Array<Record<string, unknown>> | undefined) ?? [];

  // 5s flash + blip when a new broadcast lands while the phone is open (item 23).
  const [flash, setFlash] = useState<Props["latestBroadcast"] | null>(null);
  const broadcastSeenRef = useRef<string | null>(null);
  useEffect(() => {
    broadcastSeenRef.current = props.latestBroadcast?.id ?? null;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const id = props.latestBroadcast?.id ?? null;
    if (!id || id === broadcastSeenRef.current) return;
    broadcastSeenRef.current = id;
    setFlash(props.latestBroadcast ?? null);
    try {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (Ctor) {
        const ctx = new Ctor();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "triangle";
        osc.frequency.setValueAtTime(660, ctx.currentTime);
        osc.frequency.setValueAtTime(880, ctx.currentTime + 0.12);
        gain.gain.setValueAtTime(0.0001, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.5);
        osc.connect(gain).connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.55);
        window.setTimeout(() => void ctx.close(), 800);
      }
    } catch {
      /* audio not available — the visual flash is enough */
    }
    const clear = window.setTimeout(() => setFlash(null), 5000);
    return () => window.clearTimeout(clear);
  }, [props.latestBroadcast]);

  useEffect(() => {
    // Close the open modal once its server action reports success.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (secretState.success || buzzState.success || hintState.success) setModal(null);
  }, [secretState, buzzState, hintState]);

  useEffect(() => {
    const supabase = createClient();
    let last = 0;
    const channel = supabase
      .channel(`game-refresh:${props.game.id}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "display_cues", filter: `game_id=eq.${props.game.id}` },
        () => {
          const ts = Date.now();
          if (ts - last < 300) return;
          last = ts;
          router.refresh();
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [props.game.id, router]);

  async function handleReveal() {
    if (!revealArmed) {
      setRevealArmed(true);
      return;
    }
    setRevealing(true);
    try {
      const value = await revealMySecret(props.game.id);
      setRevealedSecret(value ?? t("noSecretFound"));
    } catch {
      setRevealedSecret(t("secretLoadError"));
    } finally {
      setRevealing(false);
      setRevealArmed(false);
    }
  }

  function hideSecret() {
    setRevealedSecret(null);
    setRevealArmed(false);
  }

  const mission = props.missions[0]?.missions as Record<string, unknown> | undefined;

  // A mission the host has started that this player has not opened yet. Drives
  // the "new mission" indicator; acknowledging it also writes seen_at so the
  // dot does not reappear on the player's other devices.
  const unseenMissionIds = props.missions
    .filter((row) => {
      const m = row.missions as Record<string, unknown> | undefined;
      return m?.status === "offered" && !row.submitted_at && !row.seen_at;
    })
    .map((row) => String((row.missions as Record<string, unknown>).id));
  const showMissionAlert = unseenMissionIds.some((id) => !ackedMissionIds.includes(id));

  function ackMissions() {
    if (!unseenMissionIds.length) return;
    setAckedMissionIds((prev) => Array.from(new Set([...prev, ...unseenMissionIds])));
    for (const id of unseenMissionIds) {
      const data = new FormData();
      data.set("locale", props.locale);
      data.set("gameId", props.game.id);
      data.set("missionId", id);
      data.set("playerId", props.playerId);
      void markMissionSeen(data);
    }
  }

  const team = props.teamMember?.teams as Record<string, unknown> | undefined;
  const isTeamRound = props.round?.kind === "team";
  const modalError = modal === "accuse" ? buzzState.error : modal === "hint" ? hintState.error : null;
  const showBallot = Boolean(props.round && ["nomination", "finale", "elimination"].includes(props.round.kind));
  const hasMyGame =
    canSetSecret ||
    hasSecret ||
    showBallot ||
    props.activeBuzzes.length > 0 ||
    Boolean(mission) ||
    isTeamRound ||
    props.hints.length > 0 ||
    props.hintOffers.length > 0;

  const selectedPlayer =
    selected && selected !== "house"
      ? vault?.players.find((player) => player.id === selected) ?? null
      : null;
  const houseOpen = selected === "house";
  const selectedHints = selectedPlayer ? hintsByPlayer.get(selectedPlayer.id) ?? [] : [];
  const selectedAccusations = selectedPlayer
    ? (vault?.accusations ?? []).filter((a) => a.target_player_id === selectedPlayer.id)
    : [];

  return (
    <section className="mx-auto max-w-3xl pb-24">
      {flash ? (
        <div className="fixed inset-x-3 top-3 z-50 rounded-2xl bg-gradient-to-br from-pink-500 to-fuchsia-600 p-4 text-white shadow-[0_20px_50px_rgba(190,18,120,.4)]">
          <p className="flex items-center gap-2 text-xs font-black uppercase tracking-widest text-white/90">
            <Megaphone size={14} /> {flash.kind}
          </p>
          <p className="display mt-1 text-lg font-black leading-tight">{flash.title}</p>
          {flash.body ? <p className="mt-1 text-sm font-medium text-white/95">{flash.body}</p> : null}
        </div>
      ) : null}
      {/* 1. Player profile */}
      <article className="bubble-card flex items-center gap-4 p-5">
        <Avatar userId={props.currentUserId} name={me?.profiles?.display_name ?? null} size={56} />
        <div className="min-w-0">
          <h1 className="display truncate text-2xl font-black leading-tight">{me?.profiles?.display_name ?? t("you")}</h1>
          <p className="mt-0.5 font-mono text-xs font-black uppercase tracking-widest text-pink-600">
            #{props.game.public_code} · {statusLabel(props.game.status)}
          </p>
        </div>
      </article>

      {/* New mission from the host */}
      {showMissionAlert ? (
        <button
          type="button"
          onClick={() => {
            setVaultOpen(true);
            ackMissions();
          }}
          className="mt-4 flex w-full items-center gap-3 rounded-3xl bg-pink-600 p-4 text-left font-black text-white shadow-lg shadow-pink-500/25"
        >
          <span className="relative flex h-3 w-3 shrink-0">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white opacity-75" />
            <span className="relative inline-flex h-3 w-3 rounded-full bg-white" />
          </span>
          <Zap /> {t("newMission")}
        </button>
      ) : null}

      {/* 2. Money */}
      <article className="mt-4 rounded-[var(--radius)] bg-gradient-to-br from-pink-500 to-fuchsia-700 p-5 text-white shadow-[var(--shadow)]">
        <p className="flex items-center gap-2 text-sm font-bold text-white/90">
          <Coins size={18} /> {t("wallet")}
        </p>
        <p className="display mt-1 text-4xl font-black tabular-nums">{formatMoney(props.balance, props.game.currency_symbol)}</p>
      </article>

      {/* 3. Buzz buttons */}
      <div className="mt-4 grid grid-cols-2 gap-3">
        <button
          onClick={() => setModal("accuse")}
          className="flex min-h-24 flex-col justify-between gap-3 rounded-3xl bg-red-500 p-4 text-left text-base font-black text-white shadow-lg shadow-red-500/25"
        >
          <Megaphone size={22} /> <span>{t("accuse")}</span>
        </button>
        <button
          onClick={() => setModal("hint")}
          className="flex min-h-24 flex-col justify-between gap-3 rounded-3xl bg-amber-300 p-4 text-left text-base font-black text-amber-950 shadow-lg shadow-amber-500/25"
        >
          <Lightbulb size={22} /> <span>{t("buyHint")}</span>
        </button>
      </div>

      {/* 4. Vault */}
      <article className="bubble-card mt-4 p-5">
        <button
          type="button"
          onClick={() => {
            if (!vaultOpen) ackMissions();
            setVaultOpen((open) => !open);
          }}
          className="flex w-full items-center justify-between gap-2 font-black"
        >
          <span className="flex items-center gap-2 text-lg">
            <Lock className="text-violet-600" /> {t("vault")}
            {showMissionAlert ? <span className="h-2.5 w-2.5 rounded-full bg-pink-600" /> : null}
          </span>
          <span className="text-xs font-bold text-[var(--muted)]">{vaultOpen ? t("close") : t("open")}</span>
        </button>

        {vaultOpen ? (
          <div className="mt-5 space-y-6">
            {hasMyGame ? (
              <MyGame
                {...props}
                hasSecret={hasSecret}
                canSetSecret={canSetSecret}
                showBallot={showBallot}
                mission={mission}
                team={team}
                isTeamRound={isTeamRound}
                targets={targets}
                revealedSecret={revealedSecret}
                revealArmed={revealArmed}
                revealing={revealing}
                onReveal={handleReveal}
                onHideSecret={hideSecret}
                onEditSecret={() => setModal("secret")}
                onDisarm={() => setRevealArmed(false)}
              />
            ) : null}

            <div>
              <p className="text-xs font-black uppercase tracking-widest text-[var(--muted)]">{t("everyonesSecrets")}</p>
              <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
                {(vault?.players ?? []).map((player) => {
                  const count = player.hint_count || (hintsByPlayer.get(player.id)?.length ?? 0);
                  return (
                    <button
                      key={player.id}
                      type="button"
                      onClick={() => setSelected(player.id)}
                      className="flex flex-col items-center gap-2 rounded-2xl border border-pink-100 bg-white p-3 text-center"
                    >
                      <Avatar userId={player.user_id} name={player.name} size={56} />
                      <p className="w-full truncate text-sm font-black">{player.name ?? t("player")}</p>
                      <div className="flex flex-wrap justify-center gap-1">
                        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-black text-amber-900">
                          {t("hintCount", { count })}
                        </span>
                        {player.secret_revealed ? (
                          <span className="rounded-full bg-red-500 px-2 py-0.5 text-[10px] font-black uppercase text-white">{t("secretOut")}</span>
                        ) : null}
                      </div>
                    </button>
                  );
                })}

                {vault?.house || props.houseSecret ? (
                  <button
                    type="button"
                    onClick={() => setSelected("house")}
                    className="flex flex-col items-center gap-2 rounded-3xl bg-white p-3 text-center shadow-sm"
                  >
                    <span className="grid size-14 shrink-0 place-items-center rounded-full bg-violet-100 text-violet-600">
                      <ShieldQuestion size={28} />
                    </span>
                    <p className="w-full truncate text-sm font-black">{t("houseSecret")}</p>
                    <div className="flex flex-wrap justify-center gap-1">
                      <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-black text-violet-900">
                        {t("clueCount", { count: houseClues.length })}
                      </span>
                      {vault?.house?.revealed ? (
                        <span className="rounded-full bg-red-500 px-2 py-0.5 text-[10px] font-black uppercase text-white">{t("revealed")}</span>
                      ) : null}
                    </div>
                  </button>
                ) : null}
              </div>
            </div>
          </div>
        ) : null}
      </article>

      {/* Roster detail sheet — player */}
      {selectedPlayer ? (
        <DetailSheet title={selectedPlayer.name ?? t("player")} onClose={() => setSelected(null)}>
          <div className="mt-4 space-y-5">
            {selectedPlayer.secret_revealed && selectedPlayer.secret_text ? (
              <div className="rounded-2xl bg-red-50 p-4">
                <p className="text-xs font-black uppercase tracking-widest text-red-600">{t("secretRevealed")}</p>
                <p className="mt-2 text-lg font-bold break-words">{selectedPlayer.secret_text}</p>
              </div>
            ) : null}

            <div>
              <p className="text-xs font-black uppercase tracking-widest text-[var(--muted)]">{t("hintsYouHold")}</p>
              {selectedHints.length ? (
                <ul className="mt-3 space-y-2">
                  {selectedHints.map((hint) => (
                    <li key={hint.id} className="space-y-2 rounded-2xl bg-amber-50 p-3 text-sm">
                      {hint.text ? <p>{hint.text}</p> : null}
                      {isIconHint(hint) ? (
                        <HintIcon refValue={hint.image_ref} className="flex items-center justify-center rounded-xl bg-white/70 py-6" />
                      ) : hint.has_image || hint.kind === "image" ? (
                        <Image
                          className="h-auto w-full rounded-xl"
                          src={`/api/assets/hints/${hint.id}`}
                          alt="Hint"
                          width={800}
                          height={500}
                          unoptimized
                        />
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-sm text-[var(--muted)]">{t("noHintsOnPlayer")}</p>
              )}
            </div>

            {selectedAccusations.length ? (
              <div>
                <p className="text-xs font-black uppercase tracking-widest text-[var(--muted)]">{t("yourAccusations")}</p>
                <ul className="mt-3 space-y-2">
                  {selectedAccusations.map((a, index) => (
                    <li key={index} className="rounded-2xl bg-pink-50 p-3 text-sm">
                      <span className="font-bold">“{a.theory}”</span>
                      <span className="ml-2 rounded-full bg-white px-2 py-0.5 text-[10px] font-black uppercase">{a.status}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            <div>
              <p className="text-xs font-black uppercase tracking-widest text-[var(--muted)]">{t("yourComments")}</p>
              <NoteField
                action={savePlayerNote}
                hidden={{
                  locale: props.locale,
                  gameId: props.game.id,
                  playerId: props.playerId,
                  targetPlayerId: selectedPlayer.id,
                }}
                initial={vault?.notes.find((note) => note.target_player_id === selectedPlayer.id)?.body ?? ""}
                placeholder={t("whatIsHiding", { name: selectedPlayer.name ?? t("player") })}
              />
            </div>
          </div>
        </DetailSheet>
      ) : null}

      {/* Roster detail sheet — house */}
      {houseOpen ? (
        <DetailSheet title={t("houseSecret")} onClose={() => setSelected(null)}>
          <div className="mt-4 space-y-5">
            {vault?.house?.revealed && vault.house.answer ? (
              <div className="rounded-2xl bg-red-50 p-4">
                <p className="text-xs font-black uppercase tracking-widest text-red-600">{t("answerRevealed")}</p>
                <p className="mt-2 text-lg font-bold break-words">{vault.house.answer}</p>
              </div>
            ) : null}

            <div>
              <p className="text-xs font-black uppercase tracking-widest text-[var(--muted)]">{t("fragments")}</p>
              {houseClues.length ? (
                <ul className="mt-3 space-y-2">
                  {houseClues.map((clue) => (
                    <li key={String(clue.id)} className="space-y-2 rounded-2xl bg-violet-50 p-3 text-sm">
                      {clue.text ? <p className="font-bold">{String(clue.text)}</p> : null}
                      {clue.asset_path ? (
                        <Image
                          className="h-auto w-full rounded-xl"
                          src={`/api/assets/house-clues/${String(clue.id)}`}
                          alt="Clue"
                          width={800}
                          height={500}
                          unoptimized
                        />
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-sm text-[var(--muted)]">{t("noFragments")}</p>
              )}
            </div>

            {vault?.house && !vault.house.revealed ? (
              <div>
                <p className="text-xs font-black uppercase tracking-widest text-[var(--muted)]">{t("accuseHouse")}</p>
                {props.houseAccusationOpen ? (
                  <form action={houseFormAction} className="mt-3 space-y-2">
                    <input type="hidden" name="locale" value={props.locale} />
                    <input type="hidden" name="gameId" value={props.game.id} />
                    <input type="hidden" name="houseSecretId" value={vault.house.id} />
                    <input type="hidden" name="playerId" value={props.playerId} />
                    <textarea
                      className="field min-h-20 w-full"
                      name="theory"
                      required
                      minLength={3}
                      maxLength={500}
                      placeholder={t("houseTheoryPlaceholder")}
                    />
                    {houseState.error ? (
                      <p className="text-sm font-bold text-red-600">{houseState.error}</p>
                    ) : null}
                    {houseState.success ? (
                      <p className="text-sm font-bold text-emerald-700">{t("houseTheorySubmitted")}</p>
                    ) : null}
                    <button className="pill pill-primary w-full">{t("accuseHouseCta")}</button>
                  </form>
                ) : (
                  <p className="mt-2 text-sm text-[var(--muted)]">{t("houseClosed")}</p>
                )}
              </div>
            ) : null}

            {vault?.house ? (
              <div>
                <p className="text-xs font-black uppercase tracking-widest text-[var(--muted)]">{t("yourComments")}</p>
                <NoteField
                  action={saveHouseNote}
                  hidden={{
                    locale: props.locale,
                    gameId: props.game.id,
                    playerId: props.playerId,
                    houseSecretId: vault.house.id,
                  }}
                  initial={vault.house.note ?? ""}
                  placeholder={t("whatIsHouseHiding")}
                />
              </div>
            ) : null}
          </div>
        </DetailSheet>
      ) : null}

      {/* Buzz / secret modals */}
      {modal ? (
        <div className="fixed inset-0 z-50 grid items-end bg-[rgba(50,10,40,.45)] p-3 backdrop-blur-sm sm:place-items-center" role="dialog" aria-modal="true">
          <div className="bubble-card safe-bottom w-full max-w-lg p-5">
            <div className="flex items-center justify-between">
              <h2 className="display text-3xl font-black">
                {modal === "accuse" ? t("accuse") : modal === "hint" ? t("buyHint") : t("mySecret")}
              </h2>
              <button onClick={() => setModal(null)} className="grid size-11 place-items-center rounded-full bg-pink-50"><X /></button>
            </div>
            {modal === "secret" ? (
              <form action={submitSecretAction} className="mt-5 space-y-4">
                <input type="hidden" name="locale" value={props.locale} />
                <input type="hidden" name="gameId" value={props.game.id} />
                <input type="hidden" name="playerId" value={props.playerId} />
                <textarea name="value" className="field min-h-32" maxLength={500} required placeholder={t("secretPlaceholder")} />
                <p className="text-xs text-[var(--muted)]">{t("secretVisibilityNote")}</p>
                {secretState.error ? (
                  <p role="alert" className="text-sm font-semibold text-red-600">{secretState.error}</p>
                ) : null}
                <SaveSecretButton />
              </form>
            ) : (
              <form action={modal === "accuse" ? buzzFormAction : hintFormAction} className="mt-5 space-y-4">
                <input type="hidden" name="locale" value={props.locale} />
                <input type="hidden" name="gameId" value={props.game.id} />
                <select className="field" name="targetPlayerId" required defaultValue="">
                  <option value="" disabled>{t("selectPlayer")}</option>
                  {targets.map((player) => <option key={player.id} value={player.id}>{player.profiles?.display_name ?? t("player")}</option>)}
                </select>
                {modal === "accuse" ? <textarea className="field min-h-28" name="theory" required placeholder={t("theoryPlaceholder")} /> : null}
                {modalError ? (
                  <p role="alert" className="text-sm font-semibold text-red-600">{modalError}</p>
                ) : null}
                <button className={`pill w-full ${modal === "accuse" ? "bg-red-500 text-white" : "bg-amber-300 text-amber-950"}`}>
                  {modal === "accuse" ? <Megaphone size={18} /> : <Lightbulb size={18} />}
                  {t("confirmBuzz")}
                </button>
              </form>
            )}
          </div>
        </div>
      ) : null}
    </section>
  );
}

function DetailSheet({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-50 grid items-end bg-[rgba(50,10,40,.45)] p-3 backdrop-blur-sm sm:place-items-center"
      role="dialog"
      aria-modal="true"
    >
      <div className="bubble-card safe-bottom max-h-[85vh] w-full max-w-lg overflow-y-auto p-5">
        <div className="flex items-center justify-between">
          <h2 className="display text-2xl font-black">{title}</h2>
          <button onClick={onClose} className="grid size-11 place-items-center rounded-full bg-pink-50"><X /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

function NoteField({
  action,
  hidden,
  initial,
  placeholder,
}: {
  action: (formData: FormData) => void | Promise<void>;
  hidden: Record<string, string>;
  initial: string;
  placeholder: string;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dirty = useRef(false);
  const [value, setValue] = useState(initial);

  function flush() {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    if (dirty.current) {
      dirty.current = false;
      formRef.current?.requestSubmit();
    }
  }

  useEffect(() => {
    return () => flush();
  }, []);

  return (
    <form ref={formRef} action={action} className="mt-3">
      {Object.entries(hidden).map(([key, val]) => (
        <input key={key} type="hidden" name={key} value={val} />
      ))}
      <textarea
        name="body"
        value={value}
        onChange={(event) => {
          setValue(event.target.value);
          dirty.current = true;
          if (timer.current) clearTimeout(timer.current);
          timer.current = setTimeout(flush, 800);
        }}
        onBlur={flush}
        className="field min-h-24 w-full"
        maxLength={3000}
        placeholder={placeholder}
      />
      <SaveHint />
    </form>
  );
}

function SaveHint() {
  const { pending } = useFormStatus();
  const t = useTranslations("play");
  return <p className="mt-1 text-xs font-bold text-[var(--muted)]">{pending ? t("saving") : t("savesAutomatically")}</p>;
}

type MyGameProps = Props & {
  hasSecret: boolean;
  canSetSecret: boolean;
  showBallot: boolean;
  mission: Record<string, unknown> | undefined;
  team: Record<string, unknown> | undefined;
  isTeamRound: boolean;
  targets: Player[];
  revealedSecret: string | null;
  revealArmed: boolean;
  revealing: boolean;
  onReveal: () => void;
  onHideSecret: () => void;
  onEditSecret: () => void;
  onDisarm: () => void;
};

function MyGame(props: MyGameProps) {
  const t = useTranslations("play");
  const {
    hasSecret,
    canSetSecret,
    showBallot,
    mission,
    team,
    isTeamRound,
    targets,
    revealedSecret,
    revealArmed,
    revealing,
  } = props;
  const [nowMs] = useState(() => Date.now());
  const activePerks = (props.perks ?? []).filter((p) => !p.expiresAt || Date.parse(p.expiresAt) > nowMs);

  return (
    <div className="space-y-5">
      <p className="text-xs font-black uppercase tracking-widest text-[var(--muted)]">{t("myGame")}</p>

      {/* My secret */}
      <div className="rounded-2xl bg-violet-50 p-4">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-black uppercase tracking-widest text-violet-700">{t("mySecret")}</p>
          {canSetSecret ? (
            <button type="button" onClick={props.onEditSecret} className="pill pill-secondary text-xs">
              <LockKeyhole size={14} /> {hasSecret ? t("edit") : t("set")}
            </button>
          ) : null}
        </div>
        {!hasSecret ? (
          <p className="mt-2 text-sm text-[var(--muted)]">{t("noSecretYet")}</p>
        ) : revealedSecret !== null ? (
          <>
            <p className="mt-2 text-lg font-bold break-words">{revealedSecret}</p>
            <button type="button" onClick={props.onHideSecret} className="pill pill-secondary mt-3">
              <EyeOff size={16} /> {t("hide")}
            </button>
          </>
        ) : (
          <>
            <p className="mt-2 select-none text-lg font-black tracking-[.3em] text-violet-300">••••••••</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={props.onReveal}
                disabled={revealing}
                className={`pill ${revealArmed ? "bg-red-500 text-white" : "pill-secondary"} disabled:opacity-60`}
              >
                <Eye size={16} />
                {revealing ? t("opening") : revealArmed ? t("revealAgain") : t("revealMySecret")}
              </button>
              {revealArmed ? (
                <button type="button" onClick={props.onDisarm} className="pill pill-secondary">
                  {t("cancel")}
                </button>
              ) : null}
            </div>
            <p className="mt-2 text-xs text-[var(--muted)]">{t("revealNote")}</p>
          </>
        )}
      </div>

      {activePerks.length ? (
        <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-pink-100 bg-white p-3">
          <span className="text-xs font-black uppercase tracking-widest text-pink-600">{t("perks")}</span>
          {activePerks.map((perk) => {
            const label =
              perk.kind === "free_hint" ? t("perkFreeHint") : perk.kind === "free_buzz" ? t("perkFreeBuzz") : t("perkBuzzImmunity");
            const detail =
              perk.kind === "buzz_immunity" && perk.expiresAt
                ? ` · ${t("perkUntil", { time: new Date(perk.expiresAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) })}`
                : perk.uses > 1
                  ? ` ×${perk.uses}`
                  : "";
            return (
              <span key={perk.id} className="rounded-full bg-pink-50 px-2 py-1 text-xs font-bold text-pink-700">
                {label}
                {detail}
              </span>
            );
          })}
        </div>
      ) : null}

      {/* Broadcast dilemmas — Accept or Refuse a one-sentence offer */}
      {(props.dilemmas ?? []).map((dilemma) => (
        <div key={dilemma.id} className="rounded-2xl border border-pink-200 bg-white p-4">
          <div className="flex items-center gap-2 font-black"><ShieldQuestion className="text-pink-600" /> {dilemma.prompt}</div>
          <div className="mt-3 grid grid-cols-2 gap-2">
            {(["accept", "refuse"] as const).map((choice) => {
              const chosen = dilemma.myChoice === choice;
              return (
                <form key={choice} action={respondToDilemma}>
                  <input type="hidden" name="locale" value={props.locale} />
                  <input type="hidden" name="gameId" value={props.game.id} />
                  <input type="hidden" name="eventId" value={dilemma.id} />
                  <input type="hidden" name="playerId" value={props.playerId} />
                  <input type="hidden" name="choice" value={choice} />
                  <button className={`pill w-full ${chosen ? "pill-primary" : "pill-secondary"}`}>
                    {choice === "accept" ? t("accept") : t("refuse")}
                  </button>
                </form>
              );
            })}
          </div>
          {dilemma.myChoice ? (
            <p className="mt-2 text-xs font-bold text-[var(--muted)]">
              {dilemma.myChoice === "accept" ? t("dilemmaAccepted") : t("dilemmaRefused")}
            </p>
          ) : null}
        </div>
      ))}

      {/* Secret ballot */}
      {showBallot && props.round ? (
        <div className="rounded-2xl border border-pink-100 bg-white p-4">
          <div className="flex items-center gap-2 font-black"><Users className="text-pink-600" /> {t("secretBallot")}</div>
          <form action={castVote} className="mt-3 space-y-2">
            <input type="hidden" name="locale" value={props.locale} />
            <input type="hidden" name="gameId" value={props.game.id} />
            <input type="hidden" name="roundId" value={props.round.id} />
            <input type="hidden" name="voterPlayerId" value={props.playerId} />
            <input type="hidden" name="kind" value={props.round.kind === "finale" ? "finale" : "nominate"} />
            <select className="field" name="targetPlayerId" required defaultValue="">
              <option value="" disabled>{t("choosePrivately")}</option>
              {targets.map((player) => <option key={player.id} value={player.id}>{player.profiles?.display_name ?? t("player")}</option>)}
            </select>
            <button className="pill pill-primary w-full">{t("lockMyVote")}</button>
          </form>
        </div>
      ) : null}

      {/* Accusations I raised */}
      {props.activeBuzzes.map((buzz) => {
        const target = buzz.target as Record<string, unknown> | undefined;
        const profile = target?.profiles as Record<string, unknown> | undefined;
        return (
          <div key={String(buzz.id)} className="rounded-2xl border border-red-200 bg-white p-4">
            <p className="text-xs font-black uppercase tracking-widest text-red-600">{t("activeAccusation")} · {String(buzz.status)}</p>
            <h3 className="display mt-2 text-xl font-black">{String(profile?.display_name ?? t("player"))}: “{String(buzz.theory)}”</h3>
            {buzz.status !== "confirmed" ? (
              <div className="mt-3 grid grid-cols-2 gap-2">
                {buzz.status === "confrontation" ? (
                  <form action={stageAccusationBuzz}>
                    <input type="hidden" name="locale" value={props.locale} />
                    <input type="hidden" name="gameId" value={props.game.id} />
                    <input type="hidden" name="buzzId" value={String(buzz.id)} />
                    <input type="hidden" name="status" value="confirmed" />
                    <button className="pill bg-red-500 text-white w-full">{t("confirm")}</button>
                  </form>
                ) : <span />}
                <form action={stageAccusationBuzz}>
                  <input type="hidden" name="locale" value={props.locale} />
                  <input type="hidden" name="gameId" value={props.game.id} />
                  <input type="hidden" name="buzzId" value={String(buzz.id)} />
                  <input type="hidden" name="status" value="retracted" />
                  <button className="pill pill-secondary w-full">{t("retract")}</button>
                </form>
              </div>
            ) : null}
          </div>
        );
      })}

      {/* Mission */}
      {mission ? (
        <div className="rounded-2xl border border-pink-100 bg-white p-4">
          <div className="flex items-center gap-2 font-black"><Zap className="text-pink-600" /> {t("mission")}</div>
          <h3 className="display mt-3 text-xl font-black">{String(mission.title)}</h3>
          <p className="mt-2 text-sm leading-6 text-[var(--muted)]">{String(mission.instructions)}</p>
          <p className="mt-3 text-sm font-black">
            <span className="text-emerald-600">
              {t("rewardIfApproved", { amount: formatMoney(Number(mission.reward), props.game.currency_symbol) })}
            </span>
            {Number(mission.penalty) > 0 ? (
              <span className="mt-1 block text-red-600">
                {t("penaltyIfFailed", { amount: formatMoney(Number(mission.penalty), props.game.currency_symbol) })}
              </span>
            ) : null}
          </p>
          <form action={submitMission} className="mt-3">
            <input type="hidden" name="locale" value={props.locale} />
            <input type="hidden" name="gameId" value={props.game.id} />
            <input type="hidden" name="missionId" value={String(mission.id)} />
            <input type="hidden" name="playerId" value={props.playerId} />
            <button className="pill pill-primary w-full">{t("markComplete")}</button>
          </form>
        </div>
      ) : null}

      {/* Team */}
      {isTeamRound ? (
        <div className="rounded-2xl border border-pink-100 bg-white p-4">
          <div className="flex items-center gap-2 font-black"><Users className="text-violet-600" /> {t("team")}</div>
          <h3 className="display mt-3 text-xl font-black">{team ? String(team.name) : t("notAssignedYet")}</h3>
          {team && !props.teamMember?.dilemma_choice ? (
            <div className="mt-3 grid grid-cols-2 gap-2">
              {(["share", "steal"] as const).map((choice) => (
                <form action={setDilemmaChoice} key={choice}>
                  <input type="hidden" name="locale" value={props.locale} />
                  <input type="hidden" name="gameId" value={props.game.id} />
                  <input type="hidden" name="teamId" value={String(props.teamMember?.team_id)} />
                  <input type="hidden" name="playerId" value={props.playerId} />
                  <input type="hidden" name="choice" value={choice} />
                  <button className={`pill w-full ${choice === "share" ? "pill-secondary" : "pill-primary"}`}>
                    {t(choice)}
                  </button>
                </form>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {/* My hint inventory */}
      {props.hints.length ? (
        <div className="rounded-2xl border border-pink-100 bg-white p-4">
          <div className="flex items-center gap-2 font-black"><Lightbulb className="text-amber-500" /> {t("hints")}</div>
          <div className="mt-3 space-y-3">
            {props.hints.map((grant) => {
              const hint = grant.hints as Record<string, unknown> | undefined;
              return (
                <details key={String(grant.id)} className="rounded-2xl bg-amber-50 p-4">
                  <summary className="cursor-pointer font-bold">{String(hint?.text ?? t("imageHint"))}</summary>
                  {isIconHint(hint as { image_ref?: string | null; asset_path?: string | null } | undefined) ? (
                    <HintIcon refValue={hint?.image_ref as string | null | undefined} className="mt-3 flex items-center justify-center rounded-xl bg-white/70 py-8" />
                  ) : hint?.asset_path || hint?.kind === "image" ? (
                    <Image
                      className="mt-3 h-auto w-full rounded-xl"
                      src={`/api/assets/hints/${String(hint.id)}`}
                      alt="Private hint"
                      width={800}
                      height={500}
                      unoptimized
                    />
                  ) : null}
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    <form action={shareHint} className="grid gap-2">
                      <input type="hidden" name="locale" value={props.locale} />
                      <input type="hidden" name="gameId" value={props.game.id} />
                      <input type="hidden" name="hintId" value={String(hint?.id)} />
                      <select className="field" name="recipientPlayerId" required defaultValue="">
                        <option value="" disabled>{t("shareWith")}</option>
                        {targets.map((player) => <option key={player.id} value={player.id}>{player.profiles?.display_name ?? t("player")}</option>)}
                      </select>
                      <button className="pill pill-secondary">{t("shareFree")}</button>
                    </form>
                    <form action={createHintOffer} className="grid gap-2">
                      <input type="hidden" name="locale" value={props.locale} />
                      <input type="hidden" name="gameId" value={props.game.id} />
                      <input type="hidden" name="hintId" value={String(hint?.id)} />
                      <select className="field" name="buyerPlayerId" required defaultValue="">
                        <option value="" disabled>{t("sellTo")}</option>
                        {targets.map((player) => <option key={player.id} value={player.id}>{player.profiles?.display_name ?? t("player")}</option>)}
                      </select>
                      <div className="flex gap-2">
                        <input className="field min-w-0" name="price" type="number" min="1" placeholder={t("price")} required />
                        <button className="pill pill-primary shrink-0">{t("offer")}</button>
                      </div>
                    </form>
                  </div>
                </details>
              );
            })}
          </div>
        </div>
      ) : null}

      {/* Hint offers to me */}
      {props.hintOffers.length ? (
        <div className="rounded-2xl border border-pink-100 bg-white p-4">
          <div className="flex items-center gap-2 font-black"><Coins className="text-pink-600" /> {t("hintOffers")}</div>
          <div className="mt-3 space-y-2">
            {props.hintOffers.map((offer) => {
              const seller = offer.seller as Record<string, unknown> | undefined;
              const sellerProfile = seller?.profiles as Record<string, unknown> | undefined;
              const hint = offer.hints as Record<string, unknown> | undefined;
              return (
                <div key={String(offer.id)} className="rounded-2xl bg-pink-50 p-4">
                  <p className="font-bold">
                    {t("hintOfferLine", {
                      seller: String(sellerProfile?.display_name ?? t("aPlayer")),
                      hint: String(hint?.text ?? t("anImageHint")),
                      price: formatMoney(Number(offer.price), props.game.currency_symbol),
                    })}
                  </p>
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    {[["true", t("accept")], ["false", t("decline")]].map(([accept, label]) => (
                      <form action={resolveHintOffer} key={accept}>
                        <input type="hidden" name="locale" value={props.locale} />
                        <input type="hidden" name="gameId" value={props.game.id} />
                        <input type="hidden" name="offerId" value={String(offer.id)} />
                        <input type="hidden" name="accept" value={accept} />
                        <button className={`pill w-full ${accept === "true" ? "pill-primary" : "pill-secondary"}`}>{label}</button>
                      </form>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function SaveSecretButton() {
  const { pending } = useFormStatus();
  const t = useTranslations("play");
  return (
    <button
      className="pill pill-primary w-full disabled:cursor-not-allowed disabled:opacity-60"
      type="submit"
      disabled={pending}
      aria-busy={pending}
    >
      <LockKeyhole size={18} /> {pending ? t("saving") : t("savePrivately")}
    </button>
  );
}
