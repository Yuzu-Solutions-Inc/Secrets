"use client";

import {
  Banknote,
  Check,
  CirclePlay,
  Eye,
  Gamepad2,
  History,
  Lightbulb,
  ListChecks,
  Megaphone,
  MonitorUp,
  Pause,
  Shield,
  Sparkles,
  Users,
  Vote,
  X,
} from "lucide-react";
import { useState } from "react";
import { useTranslations } from "next-intl";

import { adjudicateBuzz, hostTransition, stageAccusationBuzz } from "@/app/actions/game";
import {
  addHint,
  addImageHint,
  addHouseClue,
  addSecretHolder,
  assignPower,
  addRound,
  adjustWallet,
  createHouseSecret,
  createMission,
  createTeam,
  duplicateRound,
  moveRound,
  publishEvent,
  replaceSecret,
  settleTeamDilemma,
  saveWinnerFormula,
  setPlayerPlayStatus,
  uploadGameBackground,
  undoTransaction,
  validateMission,
} from "@/app/actions/admin";
import { formatMoney } from "@/lib/utils";
import { InvitePlayerForm } from "./invite-player-form";

type Row = Record<string, unknown>;

export function HostControlRoom({
  locale,
  game,
  players,
  rounds,
  buzzes,
  missions,
  events,
  audit,
  secrets,
  houseSecret,
  teams,
  ledger,
}: {
  locale: string;
  game: Row;
  players: Row[];
  rounds: Row[];
  buzzes: Row[];
  missions: Row[];
  events: Row[];
  audit: Row[];
  secrets: Row[];
  houseSecret: Row | null;
  teams: Row[];
  ledger: Row[];
}) {
  const t = useTranslations("host");
  const [tab, setTab] = useState("players");
  const currentRound = rounds.find((round) => round.id === game.current_round_id);
  const pendingBuzzes = buzzes.filter((buzz) => !["correct", "partial", "wrong", "cancelled", "retracted"].includes(String(buzz.status)));
  const tabs = [
    ["players", t("players"), Users],
    ["rounds", t("rounds"), ListChecks],
    ["secrets", t("secrets"), Eye],
    ["buzzes", t("buzzes"), Megaphone],
    ["missions", t("missions"), Sparkles],
    ["economy", t("economy"), Banknote],
    ["events", t("events"), Shield],
    ["house", "House Secret", Lightbulb],
    ["votes", t("votes"), Vote],
    ["audit", "Audit", History],
  ] as const;

  return (
    <section className="mx-auto max-w-5xl pb-20">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="font-mono text-sm font-black tracking-widest text-pink-600">#{String(game.public_code)} · HOST</p>
          <h1 className="display text-4xl font-black sm:text-5xl">{String(game.title)}</h1>
        </div>
        <a className="pill pill-secondary" target="_blank" href={`/${locale}/display/${String(game.public_code)}`}>
          <MonitorUp size={18} /> {t("display")}
        </a>
      </div>

      <div className="bubble-card mt-6 flex flex-wrap gap-2 p-3">
        <form action={hostTransition}>
          <input type="hidden" name="locale" value={locale} />
          <input type="hidden" name="gameId" value={String(game.id)} />
          <input type="hidden" name="action" value="lock_secrets" />
          <button className="pill pill-secondary"><Eye size={18} /> {t("lock")}</button>
        </form>
        <details className="relative">
          <summary className="pill pill-secondary list-none">Background</summary>
          <form action={uploadGameBackground} className="absolute right-0 top-14 z-20 w-72 space-y-2 rounded-2xl bg-white p-4 shadow-xl">
            <input type="hidden" name="locale" value={locale} />
            <input type="hidden" name="gameId" value={String(game.id)} />
            <input className="field" type="file" name="image" accept="image/png,image/jpeg,image/webp" required />
            <button className="pill pill-primary w-full">Upload</button>
          </form>
        </details>
        <form action={hostTransition}>
          <input type="hidden" name="locale" value={locale} />
          <input type="hidden" name="gameId" value={String(game.id)} />
          <input type="hidden" name="action" value="next_round" />
          <button className="pill pill-primary"><CirclePlay size={18} /> {t("nextRound")}</button>
        </form>
        <form action={hostTransition}>
          <input type="hidden" name="locale" value={locale} />
          <input type="hidden" name="gameId" value={String(game.id)} />
          <input type="hidden" name="action" value={currentRound?.status === "paused" ? "resume" : "pause"} />
          <button className="pill pill-secondary"><Pause size={18} /> Pause / resume</button>
        </form>
      </div>

      <div className="mt-6 flex gap-2 overflow-x-auto pb-2">
        {tabs.map(([key, label, Icon]) => (
          <button key={key} onClick={() => setTab(key)} className={`pill shrink-0 ${tab === key ? "pill-primary" : "pill-secondary"}`}>
            <Icon size={17} /> {label}
            {key === "buzzes" && pendingBuzzes.length ? <span className="grid size-5 place-items-center rounded-full bg-white text-xs text-pink-700">{pendingBuzzes.length}</span> : null}
          </button>
        ))}
      </div>

      <div className="mt-3">
        {tab === "players" ? (
          <>
            <InvitePlayerForm
              locale={locale}
              organizationId={String(game.organization_id)}
              gameId={String(game.id)}
            />
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {players.map((player) => {
              const profile = player.profiles as Row | null;
              const wallets = player.wallets as Row[] | null;
              return (
                <article key={String(player.id)} className="bubble-card p-5">
                  <div className="flex items-center gap-3">
                    <span className="grid size-12 place-items-center rounded-full bg-pink-100 font-black text-pink-700">
                      {String(profile?.display_name ?? "?").slice(0, 1).toUpperCase()}
                    </span>
                    <div className="min-w-0">
                      <h2 className="truncate font-black">{String(profile?.display_name ?? "Player")}</h2>
                      <p className="truncate text-xs text-[var(--muted)]">{String(profile?.email ?? "")}</p>
                    </div>
                  </div>
                  <div className="mt-5 flex items-end justify-between">
                    <p className="display text-2xl font-black">{formatMoney(Number(wallets?.[0]?.balance ?? 0), String(game.currency_symbol))}</p>
                    <span className={`rounded-full px-2 py-1 text-xs font-bold ${player.is_ready ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}>
                      {player.is_ready ? "Ready" : "Waiting"}
                    </span>
                  </div>
                  <form action={setPlayerPlayStatus} className="mt-3">
                    <input type="hidden" name="locale" value={locale} />
                    <input type="hidden" name="gameId" value={String(game.id)} />
                    <input type="hidden" name="playerId" value={String(player.id)} />
                    <input type="hidden" name="status" value={player.play_status === "eliminated" ? "active" : "eliminated"} />
                    <button className="w-full text-xs font-bold text-[var(--muted)] underline">
                      {player.play_status === "eliminated" ? "Return to active play" : "Eliminate (elimination round only)"}
                    </button>
                  </form>
                </article>
              );
              })}
            </div>
          </>
        ) : null}

        {tab === "rounds" ? (
          <div className="space-y-4">
            <form action={addRound} className="bubble-card grid gap-3 p-5 sm:grid-cols-[1fr_11rem_11rem_7rem_auto]">
              <input type="hidden" name="locale" value={locale} />
              <input type="hidden" name="gameId" value={String(game.id)} />
              <input className="field" name="title" placeholder="Round title" required />
              <select className="field" name="kind" defaultValue="solo">
                {["team", "solo", "house_secret", "event", "nomination", "elimination", "finale"].map((kind) => <option key={kind} value={kind}>{kind.replaceAll("_", " ")}</option>)}
              </select>
              <select className="field" name="walletMode" defaultValue="personal">
                <option value="personal">Personal</option>
                <option value="temporary_team">Temporary team pot</option>
                <option value="pooled_personal">Pooled balances</option>
              </select>
              <input className="field" name="durationMinutes" type="number" min="1" defaultValue="45" required />
              <button className="pill pill-primary">Add</button>
            </form>
            {rounds.some((round) => round.kind === "team") ? (
              <details className="bubble-card p-5">
                <summary className="cursor-pointer font-black">Create a team</summary>
                <form action={createTeam} className="mt-4 grid gap-3 sm:grid-cols-2">
                  <input type="hidden" name="locale" value={locale} />
                  <input type="hidden" name="gameId" value={String(game.id)} />
                  <input className="field" name="name" placeholder="Team name" required />
                  <select className="field" name="roundId" required>
                    {rounds.filter((round) => round.kind === "team").map((round) => <option key={String(round.id)} value={String(round.id)}>{String(round.title)}</option>)}
                  </select>
                  <input className="field sm:col-span-2" name="openingCash" type="number" min="0" defaultValue="10000" placeholder="Opening team pot" />
                  <fieldset className="sm:col-span-2">
                    <legend className="font-bold">Members</legend>
                    <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
                      {players.map((player) => {
                        const profile = player.profiles as Row | null;
                        return <label key={String(player.id)} className="rounded-xl bg-pink-50 p-3"><input className="mr-2" type="checkbox" name="playerIds" value={String(player.id)} />{String(profile?.display_name ?? "Player")}</label>;
                      })}
                    </div>
                  </fieldset>
                  <button className="pill pill-primary sm:col-span-2">Create team</button>
                </form>
              </details>
            ) : null}
            {teams.length ? (
              <div className="grid gap-3 sm:grid-cols-2">
                {teams.map((team) => {
                  const walletRows = team.wallets as Row[] | null;
                  return (
                    <div key={String(team.id)} className="bubble-card p-4">
                      <p className="font-black">{String(team.name)}</p>
                      <p className="text-sm text-[var(--muted)]">{formatMoney(Number(walletRows?.[0]?.balance ?? 0), String(game.currency_symbol))}</p>
                      <form action={settleTeamDilemma} className="mt-3">
                        <input type="hidden" name="locale" value={locale} />
                        <input type="hidden" name="gameId" value={String(game.id)} />
                        <input type="hidden" name="teamId" value={String(team.id)} />
                        <button className="pill pill-secondary w-full">Reveal & settle dilemma</button>
                      </form>
                    </div>
                  );
                })}
              </div>
            ) : null}
            <div className="bubble-card divide-y divide-pink-100 overflow-hidden">
              {rounds.map((round, index) => (
                <div key={String(round.id)} className="flex items-center gap-4 p-5">
                  <span className="display grid size-10 shrink-0 place-items-center rounded-full bg-pink-100 font-black text-pink-700">{index + 1}</span>
                  <div className="min-w-0 flex-1">
                    <h2 className="font-black">{String(round.title)}</h2>
                    <p className="text-sm text-[var(--muted)]">{String(round.kind).replaceAll("_", " ")} · {String(round.status)}</p>
                  </div>
                  <div className="flex gap-1">
                    {(["up", "down"] as const).map((direction) => (
                      <form action={moveRound} key={direction}>
                        <input type="hidden" name="locale" value={locale} />
                        <input type="hidden" name="gameId" value={String(game.id)} />
                        <input type="hidden" name="roundId" value={String(round.id)} />
                        <input type="hidden" name="direction" value={direction} />
                        <button className="grid size-9 place-items-center rounded-full bg-pink-50" aria-label={`Move ${direction}`}>{direction === "up" ? "↑" : "↓"}</button>
                      </form>
                    ))}
                    <form action={duplicateRound}>
                      <input type="hidden" name="locale" value={locale} />
                      <input type="hidden" name="gameId" value={String(game.id)} />
                      <input type="hidden" name="roundId" value={String(round.id)} />
                      <button className="grid size-9 place-items-center rounded-full bg-pink-50" aria-label="Duplicate">＋</button>
                    </form>
                  </div>
                </div>
              ))}
              {!rounds.length ? <p className="p-6 text-[var(--muted)]">Add rounds to your custom schedule.</p> : null}
            </div>
          </div>
        ) : null}

        {tab === "secrets" ? (
          <div className="grid gap-4 lg:grid-cols-2">
            {secrets.map((secret) => {
              const holders = secret.secret_holders as Row[] | null;
              const holder = holders?.[0]?.game_players as Row | null;
              const profile = holder?.profiles as Row | null;
              const hintRows = secret.hints as Row[] | null;
              return (
                <article key={String(secret.id)} className="bubble-card p-5">
                  <div className="flex items-center justify-between">
                    <p className="font-black text-pink-600">{String(profile?.display_name ?? "Player")}</p>
                    <span className="rounded-full bg-pink-50 px-3 py-1 text-xs font-black">{String(secret.status)}</span>
                  </div>
                  <p className="display mt-3 text-2xl font-black">{String(secret.value)}</p>
                  <p className="mt-2 text-sm text-[var(--muted)]">{hintRows?.length ?? 0} hints</p>
                  <form action={addSecretHolder} className="mt-3 flex gap-2">
                    <input type="hidden" name="locale" value={locale} />
                    <input type="hidden" name="gameId" value={String(game.id)} />
                    <input type="hidden" name="secretId" value={String(secret.id)} />
                    <select className="field min-w-0" name="playerId" required defaultValue="">
                      <option value="" disabled>Add shared holder…</option>
                      {players.map((player) => {
                        const p = player.profiles as Row | null;
                        return <option key={String(player.id)} value={String(player.id)}>{String(p?.display_name ?? "Player")}</option>;
                      })}
                    </select>
                    <button className="pill pill-secondary shrink-0">Add</button>
                  </form>
                  <details className="mt-4">
                    <summary className="cursor-pointer font-bold">Add hint</summary>
                    <form action={addHint} className="mt-3 grid gap-2 sm:grid-cols-[1fr_7rem_auto]">
                      <input type="hidden" name="locale" value={locale} />
                      <input type="hidden" name="gameId" value={String(game.id)} />
                      <input type="hidden" name="secretId" value={String(secret.id)} />
                      <input className="field" name="text" placeholder="A subtle clue…" required />
                      <input className="field" name="price" type="number" min="0" defaultValue="1000" required />
                      <button className="pill pill-secondary">Add</button>
                    </form>
                  </details>
                  <details className="mt-3">
                    <summary className="cursor-pointer font-bold">Add image hint</summary>
                    <form action={addImageHint} className="mt-3 space-y-2">
                      <input type="hidden" name="locale" value={locale} />
                      <input type="hidden" name="gameId" value={String(game.id)} />
                      <input type="hidden" name="secretId" value={String(secret.id)} />
                      <input className="field" type="file" name="image" accept="image/png,image/jpeg,image/webp" required />
                      <input className="field" name="price" type="number" min="0" defaultValue="1000" required />
                      <button className="pill pill-secondary w-full">Add image</button>
                    </form>
                  </details>
                  <details className="mt-3">
                    <summary className="cursor-pointer font-bold text-red-600">Replace secret</summary>
                    <form action={replaceSecret} className="mt-3 space-y-2">
                      <input type="hidden" name="locale" value={locale} />
                      <input type="hidden" name="gameId" value={String(game.id)} />
                      <input type="hidden" name="secretId" value={String(secret.id)} />
                      <textarea className="field min-h-24" name="value" required defaultValue={String(secret.value)} />
                      <input className="field" name="reason" required placeholder="Required audit reason" />
                      <button className="pill bg-red-500 text-white">Replace with audit</button>
                    </form>
                  </details>
                </article>
              );
            })}
            {!secrets.length ? <Empty icon={Eye} text="Players have not submitted secrets yet." /> : null}
          </div>
        ) : null}

        {tab === "buzzes" ? (
          <div className="space-y-3">
            {buzzes.map((buzz) => {
              const accuser = buzz.accuser as Row | null;
              const target = buzz.target as Row | null;
              const accuserProfile = accuser?.profiles as Row | null;
              const targetProfile = target?.profiles as Row | null;
              const unresolved = !["correct", "partial", "wrong", "cancelled", "retracted"].includes(String(buzz.status));
              return (
                <article key={String(buzz.id)} className="bubble-card p-5">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-sm font-black text-red-600">{String(accuserProfile?.display_name ?? "Player")} → {String(targetProfile?.display_name ?? "Player")}</p>
                      <h2 className="display mt-1 text-2xl font-black">“{String(buzz.theory)}”</h2>
                      <p className="mt-2 text-sm text-[var(--muted)]">Stake {formatMoney(Number(buzz.stake), String(game.currency_symbol))} · {String(buzz.status)}</p>
                    </div>
                    <Megaphone className="shrink-0 text-red-500" />
                  </div>
                  {unresolved ? (
                    <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-5">
                      {buzz.status === "pending" ? (
                        <form action={stageAccusationBuzz}>
                          <input type="hidden" name="locale" value={locale} />
                          <input type="hidden" name="gameId" value={String(game.id)} />
                          <input type="hidden" name="buzzId" value={String(buzz.id)} />
                          <input type="hidden" name="status" value="confrontation" />
                          <button className="pill pill-secondary w-full text-xs">Confront</button>
                        </form>
                      ) : null}
                      {(["correct", "partial", "wrong", "cancelled"] as const).map((result) => (
                        <form action={adjudicateBuzz} key={result}>
                          <input type="hidden" name="locale" value={locale} />
                          <input type="hidden" name="gameId" value={String(game.id)} />
                          <input type="hidden" name="buzzId" value={String(buzz.id)} />
                          <input type="hidden" name="result" value={result} />
                          <button className={`pill w-full text-xs ${result === "correct" ? "bg-emerald-500 text-white" : result === "wrong" ? "bg-red-500 text-white" : "pill-secondary"}`}>
                            {result === "correct" ? <Check size={15} /> : result === "wrong" ? <X size={15} /> : null}{result}
                          </button>
                        </form>
                      ))}
                    </div>
                  ) : null}
                </article>
              );
            })}
            {!buzzes.length ? <Empty icon={Megaphone} text="No buzzes yet." /> : null}
          </div>
        ) : null}

        {tab === "missions" ? (
          <div className="space-y-4">
            <form action={createMission} className="bubble-card grid gap-3 p-5 sm:grid-cols-2">
              <input type="hidden" name="locale" value={locale} />
              <input type="hidden" name="gameId" value={String(game.id)} />
              <input className="field" name="title" placeholder="Mission title" required />
              <select className="field" name="playerId" defaultValue="">
                <option value="">Unassigned draft</option>
                {players.map((player) => {
                  const profile = player.profiles as Row | null;
                  return <option key={String(player.id)} value={String(player.id)}>{String(profile?.display_name ?? "Player")}</option>;
                })}
              </select>
              <select className="field" name="teamId" defaultValue="">
                <option value="">No team assignment</option>
                {teams.map((team) => <option key={String(team.id)} value={String(team.id)}>{String(team.name)}</option>)}
              </select>
              <textarea className="field min-h-24 sm:col-span-2" name="instructions" placeholder="Secret instructions…" required />
              <select className="field" name="visibility" defaultValue="private">
                <option value="private">Private</option><option value="team">Team</option><option value="public">Public</option>
              </select>
              <div className="grid grid-cols-2 gap-2">
                <input className="field" name="reward" type="number" min="0" defaultValue="1000" aria-label="Reward" />
                <input className="field" name="penalty" type="number" min="0" defaultValue="0" aria-label="Penalty" />
              </div>
              <button className="pill pill-primary sm:col-span-2">Create mission</button>
            </form>
            <div className="grid gap-3 sm:grid-cols-2">
              {missions.map((mission) => (
                <article key={String(mission.id)} className="bubble-card p-5">
                  <Sparkles className="text-pink-600" />
                  <h2 className="display mt-4 text-2xl font-black">{String(mission.title)}</h2>
                  <p className="mt-2 text-sm text-[var(--muted)]">{String(mission.instructions)}</p>
                  <p className="mt-4 font-black text-pink-600">+{formatMoney(Number(mission.reward), String(game.currency_symbol))}</p>
                  {((mission.mission_assignments as Row[] | undefined) ?? []).map((assignment) => {
                    const assignedPlayer = assignment.game_players as Row | null;
                    const assignedProfile = assignedPlayer?.profiles as Row | null;
                    return (
                      <div key={String(assignment.id)} className="mt-4 rounded-xl bg-pink-50 p-3">
                        <p className="text-sm font-bold">{String(assignedProfile?.display_name ?? "Player")} · {assignment.submitted_at ? "Submitted" : "In progress"}</p>
                        {assignment.submitted_at ? (
                          <div className="mt-2 grid grid-cols-2 gap-2">
                            {(["approved", "failed"] as const).map((result) => (
                              <form action={validateMission} key={result}>
                                <input type="hidden" name="locale" value={locale} />
                                <input type="hidden" name="gameId" value={String(game.id)} />
                                <input type="hidden" name="missionId" value={String(mission.id)} />
                                <input type="hidden" name="playerId" value={String(assignment.player_id)} />
                                <input type="hidden" name="result" value={result} />
                                <button className={`pill w-full ${result === "approved" ? "pill-primary" : "pill-secondary"}`}>{result}</button>
                              </form>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </article>
              ))}
              {!missions.length ? <Empty icon={Sparkles} text="Create a secret, team or public mission." /> : null}
            </div>
          </div>
        ) : null}

        {tab === "economy" ? (
          <div className="space-y-4">
            <div className="bubble-card p-6">
              <Banknote className="text-emerald-600" />
              <h2 className="display mt-4 text-3xl font-black">Immutable game ledger</h2>
              <p className="mt-2 max-w-xl text-[var(--muted)]">Mission rewards, buzzes, hint sales, team dilemmas and host corrections are recorded as balanced transactions. Direct player-to-player cash transfers are disabled.</p>
            </div>
            <form action={adjustWallet} className="bubble-card grid gap-3 p-5 sm:grid-cols-[1fr_8rem_1fr_auto]">
              <input type="hidden" name="locale" value={locale} />
              <input type="hidden" name="gameId" value={String(game.id)} />
              <select className="field" name="playerId" required defaultValue="">
                <option value="" disabled>Player</option>
                {players.map((player) => {
                  const profile = player.profiles as Row | null;
                  return <option key={String(player.id)} value={String(player.id)}>{String(profile?.display_name ?? "Player")}</option>;
                })}
              </select>
              <input className="field" name="amount" type="number" placeholder="+ / -" required />
              <input className="field" name="reason" placeholder="Audit reason" required />
              <button className="pill pill-primary">Apply</button>
            </form>
            <div className="bubble-card divide-y divide-pink-100 overflow-hidden">
              {ledger.map((transaction) => (
                <details key={String(transaction.id)} className="p-4">
                  <summary className="cursor-pointer font-bold">{String(transaction.type)} · {String(transaction.description ?? "")}</summary>
                  {transaction.reversed_transaction_id ? <p className="mt-2 text-sm text-[var(--muted)]">This is a reversal.</p> : (
                    <form action={undoTransaction} className="mt-3 flex gap-2">
                      <input type="hidden" name="locale" value={locale} />
                      <input type="hidden" name="gameId" value={String(game.id)} />
                      <input type="hidden" name="transactionId" value={String(transaction.id)} />
                      <input className="field min-w-0" name="reason" placeholder="Why undo this?" required />
                      <button className="pill pill-secondary shrink-0">Undo</button>
                    </form>
                  )}
                </details>
              ))}
            </div>
          </div>
        ) : null}

        {tab === "events" ? (
          <div className="space-y-3">
            <form action={publishEvent} className="bubble-card grid gap-3 p-5 sm:grid-cols-[10rem_1fr_auto]">
              <input type="hidden" name="locale" value={locale} />
              <input type="hidden" name="gameId" value={String(game.id)} />
              <select className="field" name="kind">
                {["announcement", "dilemma", "power", "surprise", "clue"].map((kind) => <option key={kind}>{kind}</option>)}
              </select>
              <div className="grid gap-2">
                <input className="field" name="title" placeholder="Big announcement" required />
                <textarea className="field" name="body" placeholder="What everyone should see…" />
              </div>
              <button className="pill pill-primary">Publish</button>
            </form>
            <form action={assignPower} className="bubble-card grid gap-3 p-5 sm:grid-cols-[1fr_1fr_auto]">
              <input type="hidden" name="locale" value={locale} />
              <input type="hidden" name="gameId" value={String(game.id)} />
              <select className="field" name="playerId" required defaultValue="">
                <option value="" disabled>Give power to…</option>
                {players.map((player) => {
                  const profile = player.profiles as Row | null;
                  return <option key={String(player.id)} value={String(player.id)}>{String(profile?.display_name ?? "Player")}</option>;
                })}
              </select>
              <select className="field" name="kind">
                <option value="immunity">Immunity</option><option value="double_vote">Double vote</option><option value="free_hint">Free hint</option><option value="buzz_shield">Buzz shield</option>
              </select>
              <button className="pill pill-secondary">Assign power</button>
            </form>
            {events.map((event) => (
              <article key={String(event.id)} className="bubble-card p-5">
                <Shield className="text-violet-600" />
                <h2 className="display mt-3 text-2xl font-black">{String(event.title)}</h2>
                <p className="text-sm text-[var(--muted)]">{String(event.body ?? "")}</p>
              </article>
            ))}
            {!events.length ? <Empty icon={Gamepad2} text="Trigger a dilemma, power, surprise mission or announcement." /> : null}
          </div>
        ) : null}

        {tab === "house" ? (
          <div className="bubble-card p-6">
            <Lightbulb className="text-amber-500" size={32} />
            <h2 className="display mt-4 text-3xl font-black">House Secret</h2>
            <form action={createHouseSecret} className="mt-5 grid gap-3 sm:grid-cols-2">
              <input type="hidden" name="locale" value={locale} />
              <input type="hidden" name="gameId" value={String(game.id)} />
              <textarea className="field min-h-28 sm:col-span-2" name="answer" required defaultValue={houseSecret ? String(houseSecret.answer) : ""} placeholder="The game-wide mystery answer…" />
              <select className="field" name="mode" defaultValue={houseSecret ? String(houseSecret.mode) : "hybrid"}>
                <option value="competitive">Competitive</option><option value="cooperative">Cooperative</option><option value="hybrid">Hybrid</option>
              </select>
              <div className="grid grid-cols-2 gap-2">
                <input className="field" name="vault" type="number" min="0" defaultValue={houseSecret ? Number(houseSecret.vault) / 100 : 10000} aria-label="Vault" />
                <input className="field" name="attemptCost" type="number" min="0" defaultValue={houseSecret ? Number(houseSecret.attempt_cost) / 100 : 1000} aria-label="Attempt cost" />
              </div>
              <button className="pill pill-primary sm:col-span-2">Save House Secret</button>
            </form>
            {houseSecret ? (
              <form action={addHouseClue} className="mt-6 grid gap-3 border-t border-pink-100 pt-6 sm:grid-cols-[6rem_1fr_auto_auto]">
                <input type="hidden" name="locale" value={locale} />
                <input type="hidden" name="gameId" value={String(game.id)} />
                <input type="hidden" name="houseSecretId" value={String(houseSecret.id)} />
                <input className="field" name="chapter" type="number" min="1" defaultValue="1" aria-label="Chapter" />
                <input className="field" name="text" required placeholder="A clue fragment…" />
                <label className="flex items-center gap-2 rounded-xl bg-pink-50 px-3 font-bold"><input type="checkbox" name="isDecoy" /> Decoy</label>
                <button className="pill pill-secondary">Release clue</button>
              </form>
            ) : null}
          </div>
        ) : null}

        {tab === "votes" ? (
          <div className="bubble-card p-6">
            <Vote className="text-pink-600" />
            <h2 className="display mt-4 text-3xl font-black">Finale formula</h2>
            <p className="mt-2 text-[var(--muted)]">Choose how money, protected secrets, missions, the House Secret and votes determine the winner.</p>
            <form action={saveWinnerFormula} className="mt-5 grid gap-3 sm:grid-cols-2">
              <input type="hidden" name="locale" value={locale} />
              <input type="hidden" name="gameId" value={String(game.id)} />
              {[
                ["moneyWeight", "Money multiplier", "1"],
                ["protectedSecretBonus", "Protected secret bonus", "5000"],
                ["houseSecretBonus", "House Secret bonus", "5000"],
                ["missionBonus", "Per mission bonus", "500"],
                ["voteBonus", "Per finale vote", "1000"],
              ].map(([name, label, value]) => (
                <label key={name} className="font-bold">{label}<input className="field mt-1" name={name} type="number" min="0" step={name === "moneyWeight" ? ".1" : "1"} defaultValue={value} /></label>
              ))}
              <button className="pill pill-primary sm:col-span-2">Save winner formula</button>
            </form>
            <a className="pill pill-secondary mt-3 w-full" href={`/api/games/${String(game.id)}/results`}>Export results CSV</a>
          </div>
        ) : null}

        {tab === "audit" ? (
          <div className="bubble-card divide-y divide-pink-100 overflow-hidden">
            {audit.map((entry) => (
              <div key={String(entry.id)} className="p-4">
                <p className="font-bold">{String(entry.action)}</p>
                <p className="text-xs text-[var(--muted)]">{new Date(String(entry.created_at)).toLocaleString(locale)}</p>
              </div>
            ))}
            {!audit.length ? <p className="p-5 text-[var(--muted)]">Host actions and corrections will be recorded here.</p> : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}

function Empty({ icon: Icon, text }: { icon: typeof Lightbulb; text: string }) {
  return (
    <div className="bubble-card col-span-full p-8 text-center">
      <Icon className="mx-auto text-pink-400" size={34} />
      <p className="mt-4 text-[var(--muted)]">{text}</p>
    </div>
  );
}
