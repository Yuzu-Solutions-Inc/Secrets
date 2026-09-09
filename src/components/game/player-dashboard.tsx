"use client";

import {
  Bell,
  BookOpen,
  Coins,
  Lightbulb,
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
  shareHint,
  resolveHintOffer,
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
};

export function PlayerDashboard(props: Props) {
  const t = useTranslations("play");
  const router = useRouter();
  const [modal, setModal] = useState<"accuse" | "hint" | "secret" | null>(null);
  const [secretState, submitSecretAction] = useActionState(submitSecret, { success: false, error: null });
  const targets = useMemo(() => props.players.filter((player) => player.id !== props.playerId), [props.players, props.playerId]);

  useEffect(() => {
    if (secretState.success) setModal(null);
  }, [secretState]);

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`game:${props.game.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "game_events", filter: `game_id=eq.${props.game.id}` }, () => router.refresh())
      .on("postgres_changes", { event: "*", schema: "public", table: "game_rounds", filter: `game_id=eq.${props.game.id}` }, () => router.refresh())
      .on("postgres_changes", { event: "*", schema: "public", table: "wallets", filter: `game_id=eq.${props.game.id}` }, () => router.refresh())
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [props.game.id, router]);

  const mission = props.missions[0]?.missions as Record<string, unknown> | undefined;
  const team = props.teamMember?.teams as Record<string, unknown> | undefined;

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

      {props.game.status === "secret_submission" || props.game.status === "draft" ? (
        <button onClick={() => setModal("secret")} className="pill pill-secondary mt-4 w-full">
          <LockKeyhole size={19} /> Set my private secret
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

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <article className="bubble-card p-5">
          <div className="flex items-center gap-2 font-black"><Zap className="text-pink-600" /> {t("mission")}</div>
          {mission ? (
            <>
              <h3 className="display mt-4 text-2xl font-black">{String(mission.title)}</h3>
              <p className="mt-2 text-sm leading-6 text-[var(--muted)]">{String(mission.instructions)}</p>
              <form action={submitMission} className="mt-4">
                <input type="hidden" name="locale" value={props.locale} />
                <input type="hidden" name="gameId" value={props.game.id} />
                <input type="hidden" name="missionId" value={String(mission.id)} />
                <input type="hidden" name="playerId" value={props.playerId} />
                <button className="pill pill-primary w-full">Mark complete</button>
              </form>
            </>
          ) : <p className="mt-4 text-sm text-[var(--muted)]">{t("waiting")}</p>}
        </article>

        <article className="bubble-card p-5">
          <div className="flex items-center gap-2 font-black"><Users className="text-violet-600" /> {t("team")}</div>
          <h3 className="display mt-4 text-2xl font-black">{team ? String(team.name) : "Solo"}</h3>
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
      </div>

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
              <form action={modal === "accuse" ? accusationBuzz : buyHint} className="mt-5 space-y-4">
                <input type="hidden" name="locale" value={props.locale} />
                <input type="hidden" name="gameId" value={props.game.id} />
                <select className="field" name="targetPlayerId" required defaultValue="">
                  <option value="" disabled>Select a player</option>
                  {targets.map((player) => <option key={player.id} value={player.id}>{player.profiles?.display_name ?? "Player"}</option>)}
                </select>
                {modal === "accuse" ? <textarea className="field min-h-28" name="theory" required placeholder="Their exact secret is…" /> : null}
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
