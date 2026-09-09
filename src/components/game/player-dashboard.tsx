"use client";

import {
  Bell,
  BookOpen,
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
import { useEffect, useMemo, useState, useActionState } from "react";
import { useFormStatus } from "react-dom";
import { useTranslations } from "next-intl";

import {
  accusationBuzz,
  buyHint,
  createHintOffer,
  setDilemmaChoice,
  saveTheoryNote,
  savePlayerNote,
  shareHint,
  resolveHintOffer,
  revealMySecret,
  submitSecret,
  submitMission,
  submitHouseTheory,
  stageAccusationBuzz,
} from "@/app/actions/game";
import { castVote } from "@/app/actions/admin";
import { createClient } from "@/lib/supabase/client";
import { formatMoney } from "@/lib/utils";

type Player = {
  id: string;
  user_id: string;
  is_ready: boolean;
  play_status: string;
  profiles: { display_name?: string | null; avatar_path?: string | null } | null;
};

type VaultMission = {
  id: string;
  title: string;
  instructions: string;
  status: string;
  reward: number;
  penalty: number;
  visibility: string;
  submitted_at: string | null;
};

type VaultHint = {
  id: string;
  kind: string;
  text: string | null;
  position: number;
  about_player_id: string | null;
  about_player_name: string | null;
  source?: "granted" | "revealed";
};

type VaultNote = { target_player_id: string | null; body: string; updated_at: string };
type VaultPlayer = { id: string; name: string | null };

type VaultData = {
  secret: { has: boolean; status: string | null };
  missions: VaultMission[];
  hints: VaultHint[];
  notes: VaultNote[];
  players: VaultPlayer[];
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
  players: Player[];
  round: { id: string; title: string; kind: string; status: string; config: unknown; ends_at: string | null } | null;
  balance: number;
  missions: Array<Record<string, unknown>>;
  hints: Array<Record<string, unknown>>;
  notes: Array<Record<string, unknown>>;
  teamMember: Record<string, unknown> | null;
  hintOffers: Array<Record<string, unknown>>;
  houseSecret: Record<string, unknown> | null;
  activeBuzzes: Array<Record<string, unknown>>;
  vault: Record<string, unknown> | null;
};

export function PlayerDashboard(props: Props) {
  const t = useTranslations("play");
  const router = useRouter();
  const [modal, setModal] = useState<"accuse" | "hint" | "secret" | null>(null);
  const [secretState, submitSecretAction] = useActionState(submitSecret, { success: false, error: null });
  const [buzzState, buzzFormAction] = useActionState(accusationBuzz, { success: false, error: null });
  const [hintState, hintFormAction] = useActionState(buyHint, { success: false, error: null });
  const targets = useMemo(() => props.players.filter((player) => player.id !== props.playerId), [props.players, props.playerId]);

  const vault = (props.vault ?? null) as unknown as VaultData | null;

  const [vaultOpen, setVaultOpen] = useState(false);
  const [revealedSecret, setRevealedSecret] = useState<string | null>(null);
  const [revealArmed, setRevealArmed] = useState(false);
  const [revealing, setRevealing] = useState(false);

  const hasSecret = Boolean(vault?.secret?.has);
  const secretStatus = vault?.secret?.status ?? null;
  const submissionOpen = props.game.status === "draft" || props.game.status === "secret_submission";
  const gameEnded = props.game.status === "completed" || props.game.status === "archived";
  // Show the secret entry point whenever the player can still act on it: they
  // have no secret yet (covers players invited after submission closed), or the
  // draft window is still open for edits.
  const canSetSecret = !gameEnded && (!hasSecret || (submissionOpen && secretStatus === "draft"));

  const hintsByPlayer = useMemo(() => {
    const groups = new Map<string, { id: string; name: string; hints: VaultHint[] }>();
    for (const hint of ((props.vault ?? null) as unknown as VaultData | null)?.hints ?? []) {
      const id = hint.about_player_id ?? "unknown";
      if (!groups.has(id)) {
        groups.set(id, { id, name: hint.about_player_name ?? "Unknown player", hints: [] });
      }
      groups.get(id)!.hints.push(hint);
    }
    return [...groups.values()];
  }, [props.vault]);

  useEffect(() => {
    // Close the open modal once its server action reports success. This is the
    // supported way to react to a useActionState result; it runs once per
    // settled submission, not on every render.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (secretState.success || buzzState.success || hintState.success) setModal(null);
  }, [secretState, buzzState, hintState]);

  useEffect(() => {
    const supabase = createClient();
    let last = 0;
    // display_cues is the single "something changed, re-fetch" signal for this
    // game. A DB trigger inserts one on every round / wallet / event change and
    // on every accusation buzz created or resolved, so the whole table refreshes
    // in lock-step with the TV dashboard.
    const channel = supabase
      .channel(`game-refresh:${props.game.id}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "display_cues", filter: `game_id=eq.${props.game.id}` },
        () => {
          const ts = Date.now();
          if (ts - last < 300) return; // collapse trigger bursts
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
      setRevealedSecret(value ?? "No secret found.");
    } catch {
      setRevealedSecret("Could not load your secret. Try again.");
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
  const team = props.teamMember?.teams as Record<string, unknown> | undefined;
  const isTeamRound = props.round?.kind === "team";
  const modalError = modal === "accuse" ? buzzState.error : modal === "hint" ? hintState.error : null;

  return (
    <section className="mx-auto max-w-3xl pb-24">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="font-mono text-sm font-black tracking-widest text-pink-600">#{props.game.public_code}</p>
          <h1 className="display text-4xl font-black">{props.game.title}</h1>
        </div>
        <span className="rounded-full bg-white px-3 py-2 text-xs font-black uppercase shadow-sm">{props.game.status.replaceAll("_", " ")}</span>
      </div>

      <div className="mt-6 grid grid-cols-2 gap-3">
        <article className="bubble-card bg-gradient-to-br from-pink-500 to-fuchsia-700 p-5 text-white">
          <Coins size={20} />
          <p className="mt-5 text-sm font-bold">{t("wallet")}</p>
          <p className="display text-3xl font-black">{formatMoney(props.balance, props.game.currency_symbol)}</p>
        </article>
        <article className="bubble-card p-5">
          <Lightbulb className="text-amber-500" size={20} />
          <p className="mt-5 text-sm font-bold">{t("hints")}</p>
          <p className="display text-3xl font-black">{props.hints.length}</p>
        </article>
      </div>

      <article className="bubble-card mt-4 overflow-hidden">
        <div className="bg-gradient-to-r from-violet-600 to-pink-500 p-5 text-white">
          <p className="text-xs font-black uppercase tracking-[.18em]">Current round</p>
          <h2 className="display mt-1 text-3xl font-black">{props.round?.title ?? t("waiting")}</h2>
        </div>
        <div className="grid grid-cols-2 gap-3 p-4">
          <button onClick={() => setModal("accuse")} className="min-h-28 rounded-3xl bg-red-500 p-4 text-left font-black text-white shadow-lg shadow-red-200">
            <Megaphone className="mb-4" /> {t("accuse")}
          </button>
          <button onClick={() => setModal("hint")} className="min-h-28 rounded-3xl bg-amber-300 p-4 text-left font-black text-amber-950 shadow-lg shadow-amber-100">
            <Lightbulb className="mb-4" /> {t("buyHint")}
          </button>
        </div>
      </article>

      {props.activeBuzzes.map((buzz) => {
        const target = buzz.target as Record<string, unknown> | undefined;
        const profile = target?.profiles as Record<string, unknown> | undefined;
        return (
          <article key={String(buzz.id)} className="bubble-card mt-4 border-red-200 p-5">
            <p className="text-xs font-black uppercase tracking-widest text-red-600">Active accusation · {String(buzz.status)}</p>
            <h3 className="display mt-2 text-2xl font-black">{String(profile?.display_name ?? "Player")}: “{String(buzz.theory)}”</h3>
            {buzz.status !== "confirmed" ? (
              <div className="mt-4 grid grid-cols-2 gap-2">
                {buzz.status === "confrontation" ? (
                  <form action={stageAccusationBuzz}>
                    <input type="hidden" name="locale" value={props.locale} />
                    <input type="hidden" name="gameId" value={props.game.id} />
                    <input type="hidden" name="buzzId" value={String(buzz.id)} />
                    <input type="hidden" name="status" value="confirmed" />
                    <button className="pill bg-red-500 text-white w-full">Confirm</button>
                  </form>
                ) : <span />}
                <form action={stageAccusationBuzz}>
                  <input type="hidden" name="locale" value={props.locale} />
                  <input type="hidden" name="gameId" value={props.game.id} />
                  <input type="hidden" name="buzzId" value={String(buzz.id)} />
                  <input type="hidden" name="status" value="retracted" />
                  <button className="pill pill-secondary w-full">Retract</button>
                </form>
              </div>
            ) : null}
          </article>
        );
      })}

      {canSetSecret ? (
        <button onClick={() => setModal("secret")} className="pill pill-secondary mt-4 w-full">
          <LockKeyhole size={19} /> {hasSecret ? "Edit my secret" : "Set my private secret"}
        </button>
      ) : null}

      {props.round && ["nomination", "finale", "elimination"].includes(props.round.kind) ? (
        <article className="bubble-card mt-4 p-5">
          <div className="flex items-center gap-2 font-black"><Users className="text-pink-600" /> Secret ballot</div>
          <form action={castVote} className="mt-4 space-y-2">
            <input type="hidden" name="locale" value={props.locale} />
            <input type="hidden" name="gameId" value={props.game.id} />
            <input type="hidden" name="roundId" value={props.round.id} />
            <input type="hidden" name="voterPlayerId" value={props.playerId} />
            <input type="hidden" name="kind" value={props.round.kind === "finale" ? "finale" : "nominate"} />
            <select className="field" name="targetPlayerId" required defaultValue="">
              <option value="" disabled>Choose privately</option>
              {targets.map((player) => <option key={player.id} value={player.id}>{player.profiles?.display_name ?? "Player"}</option>)}
            </select>
            <button className="pill pill-primary w-full">Lock my vote</button>
          </form>
        </article>
      ) : null}

      {mission || isTeamRound ? (
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          {mission ? (
            <article className="bubble-card p-5">
              <div className="flex items-center gap-2 font-black"><Zap className="text-pink-600" /> {t("mission")}</div>
              <h3 className="display mt-4 text-2xl font-black">{String(mission.title)}</h3>
              <p className="mt-2 text-sm leading-6 text-[var(--muted)]">{String(mission.instructions)}</p>
              <form action={submitMission} className="mt-4">
                <input type="hidden" name="locale" value={props.locale} />
                <input type="hidden" name="gameId" value={props.game.id} />
                <input type="hidden" name="missionId" value={String(mission.id)} />
                <input type="hidden" name="playerId" value={props.playerId} />
                <button className="pill pill-primary w-full">Mark complete</button>
              </form>
            </article>
          ) : null}

          {isTeamRound ? (
            <article className="bubble-card p-5">
              <div className="flex items-center gap-2 font-black"><Users className="text-violet-600" /> {t("team")}</div>
              <h3 className="display mt-4 text-2xl font-black">{team ? String(team.name) : "Not assigned yet"}</h3>
              {team && !props.teamMember?.dilemma_choice ? (
                <div className="mt-4 grid grid-cols-2 gap-2">
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
            </article>
          ) : null}
        </div>
      ) : null}

      {props.hints.length ? (
        <article className="bubble-card mt-4 p-5">
          <div className="flex items-center gap-2 font-black"><Lightbulb className="text-amber-500" /> {t("hints")}</div>
          <div className="mt-4 space-y-3">
            {props.hints.map((grant) => {
              const hint = grant.hints as Record<string, unknown> | undefined;
              return (
                <details key={String(grant.id)} className="rounded-2xl bg-amber-50 p-4">
                  <summary className="cursor-pointer font-bold">{String(hint?.text ?? "Image hint")}</summary>
                  {hint?.kind === "image" ? (
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
                        <option value="" disabled>Share with…</option>
                        {targets.map((player) => <option key={player.id} value={player.id}>{player.profiles?.display_name ?? "Player"}</option>)}
                      </select>
                      <button className="pill pill-secondary">Share free</button>
                    </form>
                    <form action={createHintOffer} className="grid gap-2">
                      <input type="hidden" name="locale" value={props.locale} />
                      <input type="hidden" name="gameId" value={props.game.id} />
                      <input type="hidden" name="hintId" value={String(hint?.id)} />
                      <select className="field" name="buyerPlayerId" required defaultValue="">
                        <option value="" disabled>Sell to…</option>
                        {targets.map((player) => <option key={player.id} value={player.id}>{player.profiles?.display_name ?? "Player"}</option>)}
                      </select>
                      <div className="flex gap-2">
                        <input className="field min-w-0" name="price" type="number" min="1" placeholder="Price" required />
                        <button className="pill pill-primary shrink-0">Offer</button>
                      </div>
                    </form>
                  </div>
                </details>
              );
            })}
          </div>
        </article>
      ) : null}

      {props.hintOffers.length ? (
        <article className="bubble-card mt-4 p-5">
          <div className="flex items-center gap-2 font-black"><Coins className="text-pink-600" /> Hint offers</div>
          <div className="mt-3 space-y-2">
            {props.hintOffers.map((offer) => {
              const seller = offer.seller as Record<string, unknown> | undefined;
              const sellerProfile = seller?.profiles as Record<string, unknown> | undefined;
              const hint = offer.hints as Record<string, unknown> | undefined;
              return (
                <div key={String(offer.id)} className="rounded-2xl bg-pink-50 p-4">
                  <p className="font-bold">{String(sellerProfile?.display_name ?? "A player")} offers “{String(hint?.text ?? "an image hint")}” for {formatMoney(Number(offer.price), props.game.currency_symbol)}</p>
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    {[["true", "Accept"], ["false", "Decline"]].map(([accept, label]) => (
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
        </article>
      ) : null}

      <article className="bubble-card mt-4 p-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 font-black"><BookOpen className="text-pink-600" /> {t("notes")}</div>
          <span className="text-xs font-bold text-[var(--muted)]">{props.notes.length} notes</span>
        </div>
        <form action={saveTheoryNote} className="mt-4 space-y-2">
          <input type="hidden" name="locale" value={props.locale} />
          <input type="hidden" name="gameId" value={props.game.id} />
          <input type="hidden" name="playerId" value={props.playerId} />
          <textarea className="field min-h-28" name="body" required placeholder="What are your friends hiding?" />
          <button className="pill pill-secondary w-full">Save private note</button>
        </form>
      </article>

      {vault ? (
        <article className="bubble-card mt-4 p-5">
          <button
            type="button"
            onClick={() => setVaultOpen((open) => !open)}
            className="flex w-full items-center justify-between gap-2 font-black"
          >
            <span className="flex items-center gap-2"><Lock className="text-violet-600" /> Vault</span>
            <span className="text-xs font-bold text-[var(--muted)]">{vaultOpen ? "Close" : "Open"}</span>
          </button>

          {vaultOpen ? (
            <div className="mt-4 space-y-6">
              <div className="rounded-2xl bg-violet-50 p-4">
                <p className="text-xs font-black uppercase tracking-widest text-violet-700">My secret</p>
                {!hasSecret ? (
                  <p className="mt-2 text-sm text-[var(--muted)]">You haven&apos;t set a secret yet.</p>
                ) : revealedSecret !== null ? (
                  <>
                    <p className="mt-2 text-lg font-bold break-words">{revealedSecret}</p>
                    <button type="button" onClick={hideSecret} className="pill pill-secondary mt-3">
                      <EyeOff size={16} /> Hide
                    </button>
                  </>
                ) : (
                  <>
                    <p className="mt-2 select-none text-lg font-black tracking-[.3em] text-violet-300">••••••••</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={handleReveal}
                        disabled={revealing}
                        className={`pill ${revealArmed ? "bg-red-500 text-white" : "pill-secondary"} disabled:opacity-60`}
                      >
                        <Eye size={16} />
                        {revealing ? "Opening…" : revealArmed ? "Tap again to reveal" : "Reveal my secret"}
                      </button>
                      {revealArmed ? (
                        <button type="button" onClick={() => setRevealArmed(false)} className="pill pill-secondary">
                          Cancel
                        </button>
                      ) : null}
                    </div>
                    <p className="mt-2 text-xs text-[var(--muted)]">Kept hidden until you tap twice, so a glance at your screen won&apos;t give it away.</p>
                  </>
                )}
              </div>

              {vault.missions.length ? (
                <div>
                  <p className="text-xs font-black uppercase tracking-widest text-[var(--muted)]">My missions</p>
                  <div className="mt-3 space-y-3">
                    {vault.missions.map((item) => (
                      <div key={item.id} className="rounded-2xl bg-pink-50 p-4">
                        <div className="flex items-center justify-between gap-2">
                          <h4 className="font-black">{item.title}</h4>
                          <span className="rounded-full bg-white px-2 py-1 text-[10px] font-black uppercase">{item.submitted_at ? "submitted" : item.status}</span>
                        </div>
                        <p className="mt-1 text-sm leading-6 text-[var(--muted)]">{item.instructions}</p>
                        <p className="mt-2 text-xs font-bold text-[var(--muted)]">
                          Reward {formatMoney(item.reward, props.game.currency_symbol)} · Penalty {formatMoney(item.penalty, props.game.currency_symbol)}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              {hintsByPlayer.length ? (
                <div>
                  <p className="text-xs font-black uppercase tracking-widest text-[var(--muted)]">Hints by player</p>
                  <div className="mt-3 space-y-3">
                    {hintsByPlayer.map((group) => {
                      const anyRevealed = group.hints.some((hint) => hint.source === "revealed");
                      return (
                        <div key={group.id} className={`rounded-2xl p-4 ${anyRevealed ? "bg-violet-50 ring-1 ring-violet-200" : "bg-amber-50"}`}>
                          <p className="flex items-center gap-2 font-black">
                            {group.name}
                            {anyRevealed ? (
                              <span className="rounded-full bg-violet-600 px-2 py-0.5 text-[10px] font-black uppercase tracking-widest text-white">
                                Secret out
                              </span>
                            ) : null}
                          </p>
                          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
                            {group.hints.map((hint) => (
                              <li key={hint.id}>{hint.kind === "image" ? "Image hint — open the Hints panel to view" : hint.text}</li>
                            ))}
                          </ul>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : null}

              {vault.players.length ? (
                <div>
                  <p className="text-xs font-black uppercase tracking-widest text-[var(--muted)]">Notes on players</p>
                  <div className="mt-3 space-y-3">
                    {vault.players.map((player) => {
                      const existing = vault.notes.find((note) => note.target_player_id === player.id);
                      return (
                        <form
                          key={`${player.id}:${existing?.updated_at ?? "new"}`}
                          action={savePlayerNote}
                          className="rounded-2xl bg-white p-4 shadow-sm"
                        >
                          <input type="hidden" name="locale" value={props.locale} />
                          <input type="hidden" name="gameId" value={props.game.id} />
                          <input type="hidden" name="playerId" value={props.playerId} />
                          <input type="hidden" name="targetPlayerId" value={player.id} />
                          <p className="font-bold">{player.name ?? "Player"}</p>
                          <textarea
                            name="body"
                            defaultValue={existing?.body ?? ""}
                            className="field mt-2 min-h-20"
                            maxLength={3000}
                            placeholder={`What is ${player.name ?? "this player"} hiding?`}
                          />
                          <button className="pill pill-secondary mt-2 w-full">Save note</button>
                        </form>
                      );
                    })}
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
        </article>
      ) : null}

      <article className="bubble-card mt-4 p-5">
        <div className="flex items-center gap-2 font-black"><ShieldQuestion className="text-violet-600" /> {t("houseSecret")}</div>
        <p className="mt-3 text-sm leading-6 text-[var(--muted)]">
          {props.houseSecret
            ? `${String(props.houseSecret.mode)} · Vault ${formatMoney(Number(props.houseSecret.vault ?? 0), props.game.currency_symbol)}`
            : "Collect fragments across rounds and submit your theory when the board opens."}
        </p>
        {props.houseSecret ? (
          <>
            <div className="mt-3 flex flex-wrap gap-2">
              {((props.houseSecret.clues as Array<Record<string, unknown>> | undefined) ?? []).map((clue) => (
                <span key={String(clue.id)} className="rounded-full bg-violet-100 px-3 py-2 text-sm font-bold">{String(clue.text ?? "Image clue")}</span>
              ))}
            </div>
            <form action={submitHouseTheory} className="mt-4 space-y-2">
              <input type="hidden" name="locale" value={props.locale} />
              <input type="hidden" name="gameId" value={props.game.id} />
              <input type="hidden" name="houseSecretId" value={String(props.houseSecret.id)} />
              <input type="hidden" name="playerId" value={props.playerId} />
              <textarea className="field min-h-24" name="theory" required placeholder="My House Secret theory…" />
              <button className="pill pill-secondary w-full">Submit theory</button>
            </form>
          </>
        ) : null}
      </article>

      {modal ? (
        <div className="fixed inset-0 z-50 grid items-end bg-[rgba(50,10,40,.45)] p-3 backdrop-blur-sm sm:place-items-center" role="dialog" aria-modal="true">
          <div className="bubble-card safe-bottom w-full max-w-lg p-5">
            <div className="flex items-center justify-between">
              <h2 className="display text-3xl font-black">
                {modal === "accuse" ? t("accuse") : modal === "hint" ? t("buyHint") : "My secret"}
              </h2>
              <button onClick={() => setModal(null)} className="grid size-11 place-items-center rounded-full bg-pink-50"><X /></button>
            </div>
            {modal === "secret" ? (
              <form action={submitSecretAction} className="mt-5 space-y-4">
                <input type="hidden" name="locale" value={props.locale} />
                <input type="hidden" name="gameId" value={props.game.id} />
                <input type="hidden" name="playerId" value={props.playerId} />
                <textarea name="value" className="field min-h-32" maxLength={500} required placeholder="I once…" />
                <p className="text-xs text-[var(--muted)]">Only you and game admins can see this before it is revealed.</p>
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
                  <option value="" disabled>Select a player</option>
                  {targets.map((player) => <option key={player.id} value={player.id}>{player.profiles?.display_name ?? "Player"}</option>)}
                </select>
                {modal === "accuse" ? <textarea className="field min-h-28" name="theory" required placeholder="Their exact secret is…" /> : null}
                {modalError ? (
                  <p role="alert" className="text-sm font-semibold text-red-600">{modalError}</p>
                ) : null}
                <button className={`pill w-full ${modal === "accuse" ? "bg-red-500 text-white" : "bg-amber-300 text-amber-950"}`}>
                  {modal === "accuse" ? <Megaphone size={18} /> : <Lightbulb size={18} />}
                  Confirm buzz
                </button>
              </form>
            )}
          </div>
        </div>
      ) : null}

      <div className="pointer-events-none fixed right-4 top-20 z-40 rounded-full bg-white p-3 shadow-lg">
        <Bell size={18} className="text-pink-600" />
      </div>
    </section>
  );
}

function SaveSecretButton() {
  const { pending } = useFormStatus();
  return (
    <button
      className="pill pill-primary w-full disabled:cursor-not-allowed disabled:opacity-60"
      type="submit"
      disabled={pending}
      aria-busy={pending}
    >
      <LockKeyhole size={18} /> {pending ? "Saving…" : "Save privately"}
    </button>
  );
}
