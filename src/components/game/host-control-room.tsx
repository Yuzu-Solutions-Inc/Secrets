"use client";

import {
  Banknote,
  Check,
  CirclePlay,
  Eye,
  Lightbulb,
  ListChecks,
  Lock,
  LockOpen,
  Megaphone,
  MonitorUp,
  Pause,
  Pencil,
  Skull,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  UserRoundCheck,
  Users,
  Vote,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { adjudicateBuzz, hostTransition, stageAccusationBuzz } from "@/app/actions/game";
import {
  addHint,
  editHint,
  editSecret,
  deleteHint,
  addHouseClue,
  editHouseClue,
  deleteHouseClue,
  releaseHouseClue,
  releaseRandomHouseClue,
  adjustWallet,
  createHouseSecret,
  createMission,
  createTeam,
  deleteGame,
  deleteTeam,
  setTeamMembers,
  fillBankSecrets,
  replaceSecret,
  settleTeamDilemma,
  saveFinaleConfig,
  resolveFinale,
  saveWinnerFormula,
  setPlayerPlayStatus,
  removeGamePlayer,
  startMission,
  updateGameSettings,
  uploadGameBackground,
  validateMission,
} from "@/app/actions/admin";
import { removeFromWhitelist } from "@/app/actions/invitations";
import { createClient } from "@/lib/supabase/client";
import { formatMoney } from "@/lib/utils";
import { secretCategories } from "@/lib/game/templates";
import { Avatar } from "./avatar";
import { BroadcastComposer } from "./broadcast-composer";
import { RoundSchedule } from "./round-schedule";
import { WhitelistManager } from "./whitelist-manager";

type Row = Record<string, unknown>;

// One reversible Eliminate/Restore toggle per player card (the old "Deactivate"
// and "Eliminate" buttons were merged — they meant the same thing). Calls the
// server action directly (not via <form>) so a refusal comes back as a value
// and can be shown in a toast instead of tripping the route error boundary.
function PlayerStatusControls({
  locale,
  gameId,
  playerId,
  active,
}: {
  locale: string;
  gameId: string;
  playerId: string;
  active: boolean;
}) {
  const [pending, startTransition] = useTransition();

  const submit = (status: string) =>
    startTransition(async () => {
      const fd = new FormData();
      fd.set("locale", locale);
      fd.set("gameId", gameId);
      fd.set("playerId", playerId);
      fd.set("status", status);
      const res = await setPlayerPlayStatus(fd);
      if (res?.error) toast.error(res.error);
    });

  const remove = () => {
    if (!window.confirm("Remove this player from the game? This can't be undone.")) return;
    startTransition(async () => {
      const fd = new FormData();
      fd.set("locale", locale);
      fd.set("gameId", gameId);
      fd.set("playerId", playerId);
      const res = await removeGamePlayer(fd);
      if (res?.error) toast.error(res.error);
    });
  };

  return (
    <div className="mt-3 flex items-center gap-2">
      <button
        type="button"
        disabled={pending}
        onClick={() => submit(active ? "eliminated" : "active")}
        className="grid size-8 place-items-center rounded-full bg-pink-50 text-pink-600 hover:bg-pink-100 disabled:opacity-50"
        title={active ? "Eliminate player (reversible)" : "Restore player"}
        aria-label={active ? "Eliminate player" : "Restore player"}
      >
        {active ? <Skull size={15} /> : <UserRoundCheck size={15} />}
      </button>
      <button
        type="button"
        disabled={pending}
        onClick={remove}
        className="ml-auto grid size-8 place-items-center rounded-full bg-red-50 text-red-600 hover:bg-red-100 disabled:opacity-50"
        title="Remove player from the game"
        aria-label="Remove player from the game"
      >
        <Trash2 size={15} />
      </button>
    </div>
  );
}

// Danger zone (Settings tab): permanently delete the whole game. Two-step —
// a typed confirmation — because the cascade is irreversible. The server action
// redirects to the games list on success.
function DeleteGameControls({ locale, gameId, title }: { locale: string; gameId: string; title: string }) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [pending, startTransition] = useTransition();
  const armed = typed.trim() === title.trim();

  const submit = () =>
    startTransition(async () => {
      const fd = new FormData();
      fd.set("locale", locale);
      fd.set("gameId", gameId);
      const res = await deleteGame(fd);
      if (res?.error) toast.error(res.error);
    });

  return (
    <div className="bubble-card grid gap-3 border border-red-200 p-6">
      <h3 className="font-black text-red-700">Delete this game</h3>
      <p className="text-sm text-[var(--muted)]">
        Removes the game and everything in it — players, rounds, secrets, missions, wallets and history. This cannot be undone.
      </p>
      {!confirmOpen ? (
        <button
          type="button"
          onClick={() => setConfirmOpen(true)}
          className="pill w-fit bg-red-500 text-sm text-white hover:bg-red-600"
        >
          <Trash2 size={15} /> Delete game
        </button>
      ) : (
        <div className="grid gap-2">
          <label className="text-xs font-bold">
            Type the game title (<span className="font-black">{title}</span>) to confirm
            <input
              className="field mt-1"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder={title}
              autoComplete="off"
            />
          </label>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={!armed || pending}
              onClick={submit}
              className="pill bg-red-500 text-sm text-white hover:bg-red-600 disabled:opacity-40"
            >
              <Trash2 size={15} /> {pending ? "Deleting…" : "Delete permanently"}
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => {
                setConfirmOpen(false);
                setTyped("");
              }}
              className="pill pill-secondary text-sm"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function HostControlRoom({
  locale,
  game,
  players,
  rounds,
  buzzes,
  missions,
  events,
  secrets,
  houseSecret,
  teams,
  ledger,
  dilemmaResponses = [],
  whitelist = [],
  inviteUrl = "",
}: {
  locale: string;
  game: Row;
  players: Row[];
  rounds: Row[];
  buzzes: Row[];
  missions: Row[];
  events: Row[];
  secrets: Row[];
  houseSecret: Row | null;
  teams: Row[];
  ledger: Row[];
  dilemmaResponses?: { game_event_id: string; choice: string }[];
  whitelist?: { id: string; email: string }[];
  inviteUrl?: string;
}) {
  const t = useTranslations("host");
  const router = useRouter();
  const [tab, setTab] = useState("players");
  const [openLedgerPlayer, setOpenLedgerPlayer] = useState<string | null>(null);
  const [secretQuery, setSecretQuery] = useState("");
  const [secretFilter, setSecretFilter] = useState("all");
  const [openSecrets, setOpenSecrets] = useState<Set<string>>(new Set());
  const [editingSecret, setEditingSecret] = useState<string | null>(null);
  const [finaleEntryMode, setFinaleEntryMode] = useState<string>(
    () => String((((game.settings as Row | null)?.finale as Row | undefined)?.entry as Row | undefined)?.mode ?? "all_active"),
  );
  const [finaleMethod, setFinaleMethod] = useState<string>(
    () => String((((game.settings as Row | null)?.finale as Row | undefined)?.resolution as Row | undefined)?.method ?? "formula"),
  );
  const [boxChoices, setBoxChoices] = useState<Record<string, "share" | "steal">>({});

  // Once the game has started, the invite panel is replaced by the host's
  // money-correction tools (item 11).
  const gameStarted = ["live", "finale", "completed", "archived"].includes(String(game.status));

  // Secrets lock/unlock pill. The host can flip it freely until round 1 starts
  // (the game leaves the pre-live statuses); after that the lock is permanent.
  const secretsLocked = !["draft", "secret_submission"].includes(String(game.status));
  const canToggleSecrets = ["draft", "secret_submission", "locked"].includes(String(game.status));

  // 1s clock for the run-of-show timer.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  // Keep the control room (buzz queue, balances, events) in lock-step with the
  // TV and player dashboards via the shared display_cues refresh signal.
  useEffect(() => {
    const supabase = createClient();
    let last = 0;
    const channel = supabase
      .channel(`host-refresh:${String(game.id)}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "display_cues", filter: `game_id=eq.${String(game.id)}` },
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
  }, [game.id, router]);

  // Allow-list emails that have not turned into a joined player yet — shown as
  // greyed "Invited" cards in the roster so the host can see who is still out.
  const joinedEmails = new Set(
    players
      .map((p) => String((p.profiles as Row | null)?.email ?? "").toLowerCase())
      .filter(Boolean),
  );
  const pendingInvites = (whitelist as { id: string; email: string }[]).filter(
    (w) => !joinedEmails.has(w.email.toLowerCase()),
  );

  const currentRound = rounds.find((round) => round.id === game.current_round_id);
  // Every hint is sold at the same price — the one set in the base game
  // settings (`hintPrice` in the round config). Show it here so the host
  // isn't asked to price hints one by one.
  const hintPriceRound = (currentRound ?? rounds[0]) as Row | undefined;
  const hintPriceConfig = hintPriceRound?.config as Row | undefined;
  const hintPrice = Number(hintPriceConfig?.hintPrice ?? 0);
  const pendingBuzzes = buzzes.filter((buzz) => !["correct", "partial", "wrong", "cancelled", "retracted"].includes(String(buzz.status)));
  const tabs = [
    ["players", t("players"), Users],
    ["rounds", t("rounds"), ListChecks],
    ["secrets", t("secrets"), Eye],
    ["buzzes", t("buzzes"), Megaphone],
    ["missions", t("missions"), Sparkles],
    ["broadcast", t("broadcast"), Megaphone],
    ["settings", t("settings"), SlidersHorizontal],
  ] as const;

  const settings = (game.settings ?? {}) as Row;
  const economy = (settings.economy ?? {}) as Row;
  const settingsAccusationStake = Number(economy.accusation_stake ?? economy.accusationStake ?? hintPriceConfig?.accusationStake ?? 0);
  const settingsHintPrice = Number(economy.hint_price ?? economy.hintPrice ?? hintPrice);
  const startsAtLocal = game.starts_at ? new Date(String(game.starts_at)).toISOString().slice(0, 16) : "";
  const finaleCfg = (settings.finale ?? {}) as Row;
  const finaleEntry = (finaleCfg.entry ?? {}) as Row;
  const finaleRes = (finaleCfg.resolution ?? {}) as Row;
  // The House Secret is opt-in per game (builder + Settings). An explicit
  // enabled:false wins; a missing flag (older games) falls back to "on" when a
  // house_secret row already exists so nothing regresses.
  const houseSecretCfg = (settings.houseSecret ?? {}) as Row;
  const houseEnabled =
    houseSecretCfg.enabled === undefined
      ? Boolean(houseSecret)
      : houseSecretCfg.enabled === true;
  const houseClueRows = houseSecret
    ? [...(((houseSecret.house_secret_clues as Row[] | null) ?? []))].sort(
        (a, b) => Number(a.position) - Number(b.position),
      )
    : [];
  const heldClueCount = houseClueRows.filter((clue) => !clue.released_at).length;

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

      {(() => {
        const paused = currentRound?.status === "paused";
        const endsAt = currentRound?.ends_at ? new Date(String(currentRound.ends_at)).getTime() : null;
        const remaining = endsAt ? Math.max(0, Math.floor((endsAt - now) / 1000)) : null;
        return (
          <div className="bubble-card mt-6 flex flex-wrap items-center gap-3 p-3">
            <div className="min-w-0 flex-1">
              <p className="text-xs font-black uppercase tracking-widest text-pink-600">{t("currentRound")}</p>
              <p className="display truncate text-lg font-black">
                {currentRound ? String(currentRound.title) : String(game.status) === "finale" ? "Finale" : "Not started"}
                {paused ? <span className="ml-2 text-sm font-bold text-amber-700">paused</span> : null}
              </p>
            </div>
            {remaining !== null ? (
              <span className="display shrink-0 text-2xl font-black tabular-nums">
                {String(Math.floor(remaining / 60)).padStart(2, "0")}:{String(remaining % 60).padStart(2, "0")}
              </span>
            ) : null}
            <div className="flex shrink-0 items-center gap-2">
              <form action={hostTransition}>
                <input type="hidden" name="locale" value={locale} />
                <input type="hidden" name="gameId" value={String(game.id)} />
                <input type="hidden" name="action" value="prev_round" />
                <button className="pill pill-secondary" aria-label="Previous round">◀</button>
              </form>
              <form action={hostTransition}>
                <input type="hidden" name="locale" value={locale} />
                <input type="hidden" name="gameId" value={String(game.id)} />
                <input type="hidden" name="action" value={paused ? "resume" : "pause"} />
                <button className="pill pill-secondary" aria-label={paused ? "Resume" : "Pause"}>
                  {paused ? <CirclePlay size={18} /> : <Pause size={18} />}
                </button>
              </form>
              <form action={hostTransition}>
                <input type="hidden" name="locale" value={locale} />
                <input type="hidden" name="gameId" value={String(game.id)} />
                <input type="hidden" name="action" value="next_round" />
                <button className="pill pill-primary"><CirclePlay size={18} /> {t("nextRound")}</button>
              </form>
            </div>
            <SecretsLockPill
              locale={locale}
              gameId={String(game.id)}
              locked={secretsLocked}
              canToggle={canToggleSecrets}
              className="shrink-0"
            />
          </div>
        );
      })()}

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
          <div className="space-y-4">
            {gameStarted ? (
              <form action={adjustWallet} className="bubble-card grid gap-3 p-5 sm:grid-cols-[1fr_8rem_1fr_auto]">
                <input type="hidden" name="locale" value={locale} />
                <input type="hidden" name="gameId" value={String(game.id)} />
                <p className="flex items-center gap-2 text-sm font-bold text-[var(--muted)] sm:col-span-4">
                  <Banknote size={16} className="text-emerald-600" /> Host money correction — every adjustment is logged with its reason.
                </p>
                <select className="field" name="playerId" required defaultValue="">
                  <option value="" disabled>Player</option>
                  {players.map((player) => {
                    const profile = player.profiles as Row | null;
                    return <option key={String(player.id)} value={String(player.id)}>{String(profile?.display_name ?? "Player")}</option>;
                  })}
                </select>
                <input className="field" name="amount" type="number" placeholder="+ / −" required />
                <input className="field" name="reason" placeholder="Audit reason" required />
                <button className="pill pill-primary">Apply</button>
              </form>
            ) : (
              <WhitelistManager
                locale={locale}
                gameId={String(game.id)}
                inviteUrl={inviteUrl}
                whitelist={whitelist as { id: string; email: string }[]}
              />
            )}
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {players.map((player) => {
              const profile = player.profiles as Row | null;
              const wallets = player.wallets as Row[] | null;
              const pid = String(player.id);
              const open = openLedgerPlayer === pid;
              const tx = open ? playerTransactions(ledger, pid) : [];
              const playStatus = String(player.play_status ?? "active");
              const active = playStatus === "active";
              return (
                <article key={pid} className={`bubble-card p-5 ${active ? "" : "opacity-70"}`}>
                  <div className="flex items-center gap-3">
                    <Avatar
                      userId={player.user_id ? String(player.user_id) : null}
                      name={String(profile?.display_name ?? "")}
                      size={48}
                    />
                    <div className="min-w-0">
                      <h2 className="truncate font-black">{String(profile?.display_name ?? "Player")}</h2>
                      <p className="truncate text-xs text-[var(--muted)]">{String(profile?.email ?? "")}</p>
                    </div>
                  </div>
                  <div className="mt-5 flex items-end justify-between">
                    <p className="display text-2xl font-black">{formatMoney(Number(wallets?.[0]?.balance ?? 0), String(game.currency_symbol))}</p>
                    <span className={`rounded-full px-2 py-1 text-xs font-bold ${
                      !active ? "bg-[var(--muted-bg,#eee)] text-[var(--muted)]" : player.is_ready ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"
                    }`}>
                      {active ? (player.is_ready ? "Ready" : "Waiting") : playStatus === "spectator" ? "Spectator" : "Eliminated"}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setOpenLedgerPlayer(open ? null : pid)}
                    className="mt-4 flex w-full items-center justify-between text-xs font-bold text-pink-600"
                    aria-expanded={open}
                  >
                    {open ? "Hide transaction history" : "Transaction history"}
                    <span aria-hidden>{open ? "−" : "+"}</span>
                  </button>
                  {open ? (
                    <ul className="mt-2 space-y-1.5 border-t border-pink-100 pt-2">
                      {tx.length ? tx.map((row) => (
                        <li key={row.id} className="flex items-center justify-between gap-2 text-xs">
                          <span className="min-w-0 truncate font-bold capitalize">{row.label}</span>
                          <span className={`shrink-0 font-black ${row.amount >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                            {row.amount >= 0 ? "+" : "−"}{formatMoney(Math.abs(row.amount), String(game.currency_symbol))}
                          </span>
                        </li>
                      )) : <li className="text-xs text-[var(--muted)]">No movements yet.</li>}
                    </ul>
                  ) : null}
                  <PlayerStatusControls
                    locale={locale}
                    gameId={String(game.id)}
                    playerId={pid}
                    active={active}
                  />
                </article>
              );
              })}

              {pendingInvites.map((invite) => {
                const name = invite.email.split("@")[0];
                return (
                  <article key={`invite-${invite.id}`} className="bubble-card border border-dashed border-pink-200 p-5 opacity-80">
                    <div className="flex items-center gap-3">
                      <Avatar userId={null} name={name} size={48} />
                      <div className="min-w-0">
                        <h2 className="truncate font-black capitalize">{name}</h2>
                        <p className="truncate text-xs text-[var(--muted)]">{invite.email}</p>
                      </div>
                    </div>
                    <div className="mt-5 flex items-end justify-between">
                      <p className="text-sm font-bold text-[var(--muted)]">Hasn&apos;t joined yet</p>
                      <span className="rounded-full bg-amber-100 px-2 py-1 text-xs font-bold text-amber-800">Invited</span>
                    </div>
                    <form action={removeFromWhitelist} className="mt-3 flex">
                      <input type="hidden" name="locale" value={locale} />
                      <input type="hidden" name="gameId" value={String(game.id)} />
                      <input type="hidden" name="id" value={invite.id} />
                      <button
                        type="submit"
                        className="ml-auto grid size-8 place-items-center rounded-full bg-red-50 text-red-600 hover:bg-red-100"
                        title="Cancel this invite"
                        aria-label={`Cancel invite for ${invite.email}`}
                      >
                        <Trash2 size={15} />
                      </button>
                    </form>
                  </article>
                );
              })}
            </div>

            <div className="bubble-card p-5">
              <div className="flex items-center gap-2 font-black"><Users size={18} className="text-pink-600" /> Teams</div>
              <p className="mt-1 text-sm text-[var(--muted)]">One set of teams for the whole game. Edit membership any time; team rounds use whatever the teams are then.</p>
              {teams.length ? (
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  {teams.map((team) => {
                    const walletRows = team.wallets as Row[] | null;
                    const memberRows = (team.team_members as Row[] | null) ?? [];
                    return (
                      <div key={String(team.id)} className="rounded-2xl bg-pink-50 p-4">
                        <p className="font-black">{String(team.name)}</p>
                        <p className="text-sm text-[var(--muted)]">{formatMoney(Number(walletRows?.[0]?.balance ?? 0), String(game.currency_symbol))} · {memberRows.length} member{memberRows.length === 1 ? "" : "s"}</p>
                        <p className="mt-1 truncate text-xs text-[var(--muted)]">
                          {memberRows.map((m) => String(((m.game_players as Row | null)?.profiles as Row | null)?.display_name ?? "Player")).join(", ") || "No members"}
                        </p>
                        <details className="mt-2">
                          <summary className="cursor-pointer text-xs font-bold text-pink-600">Edit members</summary>
                          <form action={setTeamMembers} className="mt-2 grid gap-2">
                            <input type="hidden" name="locale" value={locale} />
                            <input type="hidden" name="gameId" value={String(game.id)} />
                            <input type="hidden" name="teamId" value={String(team.id)} />
                            <div className="grid grid-cols-2 gap-1">
                              {players.map((player) => {
                                const profile = player.profiles as Row | null;
                                const isMember = memberRows.some((m) => String(m.player_id) === String(player.id));
                                return <label key={String(player.id)} className="rounded-lg bg-white p-1.5 text-xs"><input className="mr-1.5" type="checkbox" name="playerIds" value={String(player.id)} defaultChecked={isMember} />{String(profile?.display_name ?? "Player")}</label>;
                              })}
                            </div>
                            <button className="pill pill-secondary h-8 w-fit text-xs">Save members</button>
                          </form>
                        </details>
                        <div className="mt-2 flex flex-wrap gap-2">
                          <form action={settleTeamDilemma}>
                            <input type="hidden" name="locale" value={locale} />
                            <input type="hidden" name="gameId" value={String(game.id)} />
                            <input type="hidden" name="teamId" value={String(team.id)} />
                            <button className="pill pill-secondary h-8 text-xs">Reveal &amp; settle dilemma</button>
                          </form>
                          <form action={deleteTeam}>
                            <input type="hidden" name="locale" value={locale} />
                            <input type="hidden" name="gameId" value={String(game.id)} />
                            <input type="hidden" name="teamId" value={String(team.id)} />
                            <button className="text-xs font-black text-red-600 hover:underline">Delete</button>
                          </form>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : null}
              <details className="mt-3">
                <summary className="cursor-pointer font-bold">New team</summary>
                <form action={createTeam} className="mt-3 grid gap-3">
                  <input type="hidden" name="locale" value={locale} />
                  <input type="hidden" name="gameId" value={String(game.id)} />
                  <input className="field" name="name" placeholder="Team name" required />
                  <input className="field" name="openingCash" type="number" min="0" defaultValue="10000" placeholder="Opening team pot" />
                  <fieldset>
                    <legend className="font-bold">Members</legend>
                    <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
                      {players.map((player) => {
                        const profile = player.profiles as Row | null;
                        return <label key={String(player.id)} className="rounded-xl bg-white p-2 text-sm"><input className="mr-2" type="checkbox" name="playerIds" value={String(player.id)} />{String(profile?.display_name ?? "Player")}</label>;
                      })}
                    </div>
                  </fieldset>
                  <button className="pill pill-primary w-fit">Create team</button>
                </form>
              </details>
            </div>

          </div>
        ) : null}

        {tab === "rounds" ? (
          <RoundSchedule
            locale={locale}
            gameId={String(game.id)}
            rounds={rounds}
            currentRoundId={game.current_round_id ? String(game.current_round_id) : null}
          />
        ) : null}

        {tab === "secrets" ? (() => {
          const heldIds = new Set(
            secrets.flatMap((s) => ((s.secret_holders as Row[] | null) ?? []).map((h) => String(h.player_id))),
          );
          const missingPlayers = players.filter((p) => !heldIds.has(String(p.id)));
          const q = secretQuery.trim().toLowerCase();
          const rows = secrets
            .map((secret) => {
              const holders = (secret.secret_holders as Row[] | null) ?? [];
              const profile = (holders[0]?.game_players as Row | null)?.profiles as Row | null;
              return {
                secret,
                holderPlayerId: holders[0]?.player_id ? String(holders[0].player_id) : null,
                holderUserId: (holders[0]?.game_players as Row | null)?.user_id
                  ? String((holders[0].game_players as Row).user_id)
                  : null,
                name: String(profile?.display_name ?? "Player"),
                hintRows: [...(((secret.hints as Row[] | null) ?? []))].sort((a, b) => Number(a.position) - Number(b.position)),
                status: String(secret.status),
              };
            })
            .filter((r) => (q ? r.name.toLowerCase().includes(q) || String(r.secret.value).toLowerCase().includes(q) : true))
            .filter((r) => {
              if (secretFilter === "no-hints") return r.hintRows.length === 0;
              if (secretFilter === "unlocked") return r.status === "draft";
              if (secretFilter === "revealed") return r.status === "revealed";
              return true;
            });
          const lockedCount = secrets.filter((s) => String(s.status) !== "draft").length;
          const allIds = rows.map((r) => String(r.secret.id));
          const allOpen = allIds.length > 0 && allIds.every((id) => openSecrets.has(id));

          return (
            <div className="space-y-3">
              <div className="bubble-card flex flex-wrap items-center gap-2 p-3">
                <input className="field h-10 min-w-[10rem] flex-1" placeholder="Search player or secret…" value={secretQuery} onChange={(e) => setSecretQuery(e.target.value)} />
                <select className="field h-10 w-auto" value={secretFilter} onChange={(e) => setSecretFilter(e.target.value)}>
                  <option value="all">All</option>
                  <option value="no-hints">No hints</option>
                  <option value="unlocked">Unlocked (draft)</option>
                  <option value="revealed">Revealed</option>
                </select>
                <button type="button" className="pill pill-secondary h-10" onClick={() => setOpenSecrets(allOpen ? new Set() : new Set(allIds))}>
                  {allOpen ? "Collapse all" : "Expand all"}
                </button>
                <SecretsLockPill
                  locale={locale}
                  gameId={String(game.id)}
                  locked={secretsLocked}
                  canToggle={canToggleSecrets}
                  className="ml-auto h-10"
                />
                <span className="text-xs font-bold text-[var(--muted)]">
                  {lockedCount}/{secrets.length} locked
                  {canToggleSecrets ? "" : " · locked for the game"}
                </span>
              </div>

              <details className="bubble-card overflow-hidden" open={houseEnabled && !houseSecret}>
                <summary className="flex cursor-pointer items-center gap-2 p-4 font-black">
                  <Lightbulb className="text-amber-500" size={18} /> House Secret{" "}
                  {!houseEnabled ? "— off" : houseSecret ? "" : "— not set"}
                </summary>
                <div className="border-t border-pink-100 p-5">
                  {!houseEnabled ? (
                    <p className="text-sm text-[var(--muted)]">
                      Turn on <span className="font-bold">Activate House Secret</span> in the Settings tab to seed the game-wide mystery and its clues.
                    </p>
                  ) : (
                    <>
                      <form action={createHouseSecret} className="grid gap-3 sm:grid-cols-2">
                        <input type="hidden" name="locale" value={locale} />
                        <input type="hidden" name="gameId" value={String(game.id)} />
                        <textarea className="field min-h-24 sm:col-span-2" name="answer" required defaultValue={houseSecret ? String(houseSecret.answer) : ""} placeholder="The game-wide mystery answer…" />
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
                        <div className="mt-5 space-y-3 border-t border-pink-100 pt-5">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="font-black">Clues</p>
                            <span className="text-xs text-[var(--muted)]">
                              managed like secret hints · never for sale · released by the host
                            </span>
                            <form action={releaseRandomHouseClue} className="ml-auto">
                              <input type="hidden" name="locale" value={locale} />
                              <input type="hidden" name="gameId" value={String(game.id)} />
                              <input type="hidden" name="houseSecretId" value={String(houseSecret.id)} />
                              <button className="pill pill-secondary h-9 text-xs" disabled={heldClueCount === 0}>
                                Release random clue{heldClueCount ? ` (${heldClueCount} held)` : ""}
                              </button>
                            </form>
                          </div>

                          {houseClueRows.length ? (
                            <ul className="space-y-2">
                              {houseClueRows.map((clue) => (
                                <li key={String(clue.id)} className="space-y-2 rounded-2xl bg-white p-3">
                                  {clue.text ? (
                                    <form action={editHouseClue} className="flex flex-wrap items-center gap-2">
                                      <input type="hidden" name="locale" value={locale} />
                                      <input type="hidden" name="gameId" value={String(game.id)} />
                                      <input type="hidden" name="clueId" value={String(clue.id)} />
                                      <input className="field h-9 min-w-0 flex-1" name="text" defaultValue={String(clue.text ?? "")} required />
                                      <button className="pill pill-secondary h-9 shrink-0 text-xs">Save</button>
                                    </form>
                                  ) : null}
                                  {clue.asset_path ? (
                                    // eslint-disable-next-line @next/next/no-img-element
                                    <img src={`/api/assets/house-clues/${String(clue.id)}`} alt="Image clue" className="max-h-32 rounded-xl" />
                                  ) : null}
                                  <div className="mt-1 flex flex-wrap items-center gap-3 text-xs">
                                    <span className="text-[var(--muted)]">
                                      #{Number(clue.position) + 1}
                                      {clue.is_decoy ? " · decoy" : ""}
                                      {clue.released_at ? " · released" : " · held"}
                                    </span>
                                    {!clue.released_at ? (
                                      <form action={releaseHouseClue}>
                                        <input type="hidden" name="locale" value={locale} />
                                        <input type="hidden" name="gameId" value={String(game.id)} />
                                        <input type="hidden" name="clueId" value={String(clue.id)} />
                                        <button className="font-black text-emerald-700 hover:underline">Release</button>
                                      </form>
                                    ) : null}
                                    <form action={deleteHouseClue}>
                                      <input type="hidden" name="locale" value={locale} />
                                      <input type="hidden" name="gameId" value={String(game.id)} />
                                      <input type="hidden" name="clueId" value={String(clue.id)} />
                                      <button className="font-black text-red-600 hover:underline">Delete</button>
                                    </form>
                                  </div>
                                </li>
                              ))}
                            </ul>
                          ) : <p className="text-xs text-[var(--muted)]">No clues yet.</p>}

                          <form action={addHouseClue} className="grid gap-2 rounded-2xl bg-white p-3 sm:grid-cols-[1fr_auto]">
                            <input type="hidden" name="locale" value={locale} />
                            <input type="hidden" name="gameId" value={String(game.id)} />
                            <input type="hidden" name="houseSecretId" value={String(houseSecret.id)} />
                            <input className="field h-9" name="text" placeholder="Text clue (optional)" />
                            <button className="pill pill-primary h-9 text-xs sm:row-span-3">Add clue</button>
                            <input className="field h-9 text-xs" type="file" name="image" accept="image/png,image/jpeg,image/webp" />
                            <label className="flex items-center gap-2 text-xs font-bold"><input type="checkbox" name="isDecoy" /> Decoy</label>
                            <p className="text-xs text-[var(--muted)] sm:col-span-2">Fill the text, attach an image, or both. New clues stay held until you release them.</p>
                          </form>
                        </div>
                      ) : null}
                    </>
                  )}
                </div>
              </details>

              <div className="bubble-card divide-y divide-pink-100 overflow-hidden">
                {rows.map(({ secret, name, hintRows, status, holderPlayerId, holderUserId }) => {
                  const sid = String(secret.id);
                  const open = openSecrets.has(sid);
                  const isDraft = status === "draft";
                  return (
                    <div key={sid}>
                      <div className="flex items-center gap-3 p-4">
                        <button
                          type="button"
                          onClick={() => setOpenSecrets((prev) => {
                            const next = new Set(prev);
                            if (next.has(sid)) next.delete(sid); else next.add(sid);
                            return next;
                          })}
                          className="grid size-7 shrink-0 place-items-center rounded-full bg-pink-50 text-pink-700"
                          aria-expanded={open}
                          aria-label="Toggle hints"
                        >
                          {open ? "−" : "+"}
                        </button>
                        <Avatar userId={holderUserId} name={name} size={36} className="text-sm" />
                        {editingSecret === sid ? (
                          <form
                            action={isDraft && holderPlayerId ? editSecret : replaceSecret}
                            className="flex min-w-0 flex-1 items-center gap-2"
                          >
                            <input type="hidden" name="locale" value={locale} />
                            <input type="hidden" name="gameId" value={String(game.id)} />
                            {isDraft && holderPlayerId ? (
                              <input type="hidden" name="playerId" value={holderPlayerId} />
                            ) : (
                              <>
                                <input type="hidden" name="secretId" value={sid} />
                                <input type="hidden" name="reason" value="Host edit" />
                              </>
                            )}
                            <span className="hidden shrink-0 text-xs font-bold text-pink-600 md:block">{name}</span>
                            <input className="field h-9 min-w-0 flex-1" name="value" defaultValue={String(secret.value)} required autoFocus />
                            <button className="pill pill-secondary h-9 shrink-0 text-xs">Save</button>
                            <button type="button" onClick={() => setEditingSecret(null)} className="pill h-9 shrink-0 text-xs">Cancel</button>
                          </form>
                        ) : (
                          <div className="flex min-w-0 flex-1 items-center gap-2">
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-xs font-bold text-pink-600">{name}</p>
                              <p className="display truncate font-black">{String(secret.value)}</p>
                            </div>
                            <button
                              type="button"
                              onClick={() => setEditingSecret(sid)}
                              className="grid size-8 shrink-0 place-items-center rounded-full text-pink-600 hover:bg-pink-50 hover:text-pink-800"
                              aria-label={`Edit ${name}'s secret`}
                            >
                              <Pencil size={15} />
                            </button>
                          </div>
                        )}
                        <span className={`shrink-0 rounded-full px-2 py-1 text-xs font-black ${status === "revealed" ? "bg-violet-100 text-violet-800" : status === "locked" ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}>{status}</span>
                        <span className="hidden shrink-0 items-center gap-1 text-xs text-[var(--muted)] sm:inline-flex"><Lightbulb className="size-3.5" />{hintRows.length}</span>
                      </div>
                      {open ? (
                        <div className="space-y-3 bg-pink-50/30 px-4 pb-4 pl-14">
                          {hintRows.length ? (
                            <ul className="space-y-2">
                              {hintRows.map((hint) => (
                                <li key={String(hint.id)} className="space-y-2 rounded-2xl bg-white p-3">
                                  {hint.text ? (
                                    <form action={editHint} className="flex flex-wrap items-center gap-2">
                                      <input type="hidden" name="locale" value={locale} />
                                      <input type="hidden" name="gameId" value={String(game.id)} />
                                      <input type="hidden" name="hintId" value={String(hint.id)} />
                                      <input className="field h-9 min-w-0 flex-1" name="text" defaultValue={String(hint.text ?? "")} required />
                                      <button className="pill pill-secondary h-9 shrink-0 text-xs">Save</button>
                                    </form>
                                  ) : null}
                                  {hint.asset_path ? (
                                    // eslint-disable-next-line @next/next/no-img-element
                                    <img src={`/api/assets/hints/${String(hint.id)}`} alt="Image hint" className="max-h-32 rounded-xl" />
                                  ) : null}
                                  <div className="mt-1 flex items-center gap-3 text-xs">
                                    <span className="text-[var(--muted)]">#{Number(hint.position) + 1}{hint.released_at ? " · released" : ""}</span>
                                    <form action={deleteHint}>
                                      <input type="hidden" name="locale" value={locale} />
                                      <input type="hidden" name="gameId" value={String(game.id)} />
                                      <input type="hidden" name="hintId" value={String(hint.id)} />
                                      <button className="font-black text-red-600 hover:underline">Delete</button>
                                    </form>
                                  </div>
                                </li>
                              ))}
                            </ul>
                          ) : <p className="text-xs text-[var(--muted)]">No hints yet.</p>}

                          <form action={addHint} className="grid gap-2 rounded-2xl bg-white p-3 sm:grid-cols-[1fr_auto]">
                            <input type="hidden" name="locale" value={locale} />
                            <input type="hidden" name="gameId" value={String(game.id)} />
                            <input type="hidden" name="secretId" value={sid} />
                            <input className="field h-9" name="text" placeholder="Text clue (optional)" />
                            <button className="pill pill-primary h-9 text-xs sm:row-span-2">Add hint</button>
                            <input className="field h-9 text-xs" type="file" name="image" accept="image/png,image/jpeg,image/webp" />
                            <p className="text-xs text-[var(--muted)] sm:col-span-2">Fill the text, attach an image, or both.</p>
                          </form>

                        </div>
                      ) : null}
                    </div>
                  );
                })}
                {!rows.length ? <p className="p-6 text-center text-[var(--muted)]">{secrets.length ? "No secrets match." : "Players have not submitted secrets yet."}</p> : null}
              </div>

              {missingPlayers.length ? (
                <form action={fillBankSecrets} className="grid gap-2 rounded-2xl bg-amber-50 p-4 text-sm text-amber-900">
                  <input type="hidden" name="locale" value={locale} />
                  <input type="hidden" name="gameId" value={String(game.id)} />
                  <p>
                    <span className="font-bold">{missingPlayers.length} without a secret:</span>{" "}
                    {missingPlayers.map((p) => String((p.profiles as Row | null)?.display_name ?? "Player")).join(", ")}.
                  </p>
                  <button className="pill pill-secondary w-fit"><Sparkles size={16} /> Fill missing secrets</button>
                </form>
              ) : null}
            </div>
          );
        })() : null}

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
              <p className="text-sm text-[var(--muted)] sm:col-span-2">
                New missions are saved as a hidden draft. Players only see one after you press <span className="font-bold">Start</span>.
              </p>
              <input className="field" name="title" placeholder="Mission title" required />
              <select className="field" name="playerId" defaultValue="">
                <option value="">No player assignment</option>
                {players.map((player) => {
                  const profile = player.profiles as Row | null;
                  return <option key={String(player.id)} value={String(player.id)}>{String(profile?.display_name ?? "Player")}</option>;
                })}
              </select>
              <select className="field" name="teamId" defaultValue="">
                <option value="">No team assignment</option>
                {teams.map((team) => <option key={String(team.id)} value={String(team.id)}>{String(team.name)}</option>)}
              </select>
              <label className="flex items-center gap-2 font-bold sm:col-span-2"><input type="checkbox" name="assignAll" /> Assign to all active players (overrides the player/team picks)</label>
              <textarea className="field min-h-24 sm:col-span-2" name="instructions" placeholder="Secret instructions…" required />
              <select className="field" name="visibility" defaultValue="private">
                <option value="private">Private</option><option value="team">Team</option><option value="public">Public</option>
              </select>
              <label className="grid gap-1">
                <span className="text-xs font-bold text-[var(--muted)]">Timer — minutes (0 = none)</span>
                <input className="field" name="timerMinutes" type="number" min="0" max="1440" defaultValue="0" />
              </label>
              <div className="grid grid-cols-2 gap-3 sm:col-span-2">
                <label className="grid gap-1">
                  <span className="text-xs font-bold text-emerald-700">Reward — paid to the player when you approve</span>
                  <input className="field" name="reward" type="number" min="0" defaultValue="1000" />
                </label>
                <label className="grid gap-1">
                  <span className="text-xs font-bold text-red-700">Penalty — charged to the player if it fails</span>
                  <input className="field" name="penalty" type="number" min="0" defaultValue="0" />
                </label>
              </div>
              <button className="pill pill-primary sm:col-span-2">Create draft mission</button>
            </form>
            <div className="grid gap-3 sm:grid-cols-2">
              {missions.map((mission) => {
                const status = String(mission.status);
                const isDraft = status === "draft";
                const penalty = Number(mission.penalty);
                return (
                <article key={String(mission.id)} className="bubble-card p-5">
                  <div className="flex items-center justify-between gap-2">
                    <Sparkles className="text-pink-600" />
                    <span className={`pill text-xs ${isDraft ? "bg-[var(--muted-bg,#eee)] text-[var(--muted)]" : status === "offered" ? "bg-emerald-100 text-emerald-800" : status === "submitted" ? "bg-amber-100 text-amber-900" : status === "approved" ? "bg-emerald-600 text-white" : status === "failed" ? "bg-red-600 text-white" : "bg-[var(--muted-bg,#eee)] text-[var(--muted)]"}`}>
                      {isDraft ? "Draft — hidden" : status === "offered" ? "Live" : status}
                    </span>
                  </div>
                  <h2 className="display mt-4 text-2xl font-black">{String(mission.title)}</h2>
                  <p className="mt-2 text-sm text-[var(--muted)]">{String(mission.instructions)}</p>
                  {mission.deadline ? (() => {
                    const left = Math.floor((new Date(String(mission.deadline)).getTime() - now) / 1000);
                    return (
                      <p className={`mt-2 text-xs font-black ${left <= 0 ? "text-red-600" : "text-[var(--muted)]"}`}>
                        {left <= 0 ? "Timer expired" : `Timer: ${String(Math.floor(left / 60)).padStart(2, "0")}:${String(left % 60).padStart(2, "0")}`}
                      </p>
                    );
                  })() : Number(mission.timer_minutes) > 0 && isDraft ? (
                    <p className="mt-2 text-xs font-black text-[var(--muted)]">Timer: {Number(mission.timer_minutes)} min — starts on Start</p>
                  ) : null}
                  <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 font-black">
                    <span className="text-emerald-600">Reward +{formatMoney(Number(mission.reward), String(game.currency_symbol))}</span>
                    {penalty > 0 ? (
                      <span className="text-red-600">Penalty −{formatMoney(penalty, String(game.currency_symbol))}</span>
                    ) : (
                      <span className="text-[var(--muted)]">No penalty</span>
                    )}
                  </div>
                  {isDraft ? (
                    <form action={startMission} className="mt-4">
                      <input type="hidden" name="locale" value={locale} />
                      <input type="hidden" name="gameId" value={String(game.id)} />
                      <input type="hidden" name="missionId" value={String(mission.id)} />
                      <button className="pill pill-primary inline-flex w-full items-center justify-center gap-2">
                        <CirclePlay size={16} /> Start mission
                      </button>
                    </form>
                  ) : null}
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
                );
              })}
              {!missions.length ? <Empty icon={Sparkles} text="Create a secret, team or public mission." /> : null}
            </div>
          </div>
        ) : null}

        {tab === "broadcast" ? (
          <div className="space-y-3">
            <BroadcastComposer locale={locale} gameId={String(game.id)} teams={teams} players={players} />

            {events.map((event) => {
              const isDilemma = String(event.kind) === "dilemma";
              const answers = isDilemma ? dilemmaResponses.filter((r) => r.game_event_id === event.id) : [];
              const accepted = answers.filter((a) => a.choice === "accept").length;
              const refused = answers.filter((a) => a.choice === "refuse").length;
              const effects = (((event.payload ?? {}) as Row).effects ?? []) as Row[];
              return (
                <article key={String(event.id)} className="bubble-card p-5">
                  <p className="text-xs font-black uppercase tracking-widest text-pink-600">{String(event.kind)}{event.is_public ? "" : " · private"}</p>
                  <h2 className="display mt-1 text-xl font-black">{String(event.title)}</h2>
                  {event.body ? <p className="mt-1 text-sm text-[var(--muted)]">{String(event.body)}</p> : null}
                  {isDilemma ? (
                    <>
                      {effects.length ? (
                        <p className="mt-2 text-xs text-[var(--muted)]">
                          On accept: {effects.map((e) => String(e.type).replaceAll("_", " ")).join(", ")}
                        </p>
                      ) : null}
                      <div className="mt-3 grid gap-2 sm:grid-cols-2">
                        <div className="rounded-xl bg-emerald-50 p-3">
                          <p className="text-sm font-bold text-emerald-800">Accepted</p>
                          <p className="display text-2xl font-black text-emerald-700">{accepted}</p>
                        </div>
                        <div className="rounded-xl bg-pink-50 p-3">
                          <p className="text-sm font-bold">Refused</p>
                          <p className="display text-2xl font-black text-pink-700">{refused}</p>
                        </div>
                      </div>
                    </>
                  ) : null}
                </article>
              );
            })}
            {!events.length ? <Empty icon={Megaphone} text="Broadcast an announcement, clue, dilemma or power." /> : null}
          </div>
        ) : null}

        {tab === "settings" ? (
          <div className="space-y-4">
            <form action={updateGameSettings} className="bubble-card grid gap-4 p-6 sm:grid-cols-2">
              <input type="hidden" name="locale" value={locale} />
              <input type="hidden" name="gameId" value={String(game.id)} />
              <div className="sm:col-span-2">
                <SlidersHorizontal className="text-pink-600" />
                <h2 className="display mt-3 text-3xl font-black">Game settings</h2>
                <p className="mt-1 text-sm text-[var(--muted)]">Economy is in whole {String(game.currency_symbol)}. Buzz and hint prices apply to every round.</p>
              </div>
              <label className="font-bold">Starting cash
                <input className="field mt-1" name="startingCash" type="number" min="0" defaultValue={Math.round(Number(game.starting_cash ?? 0) / 100)} required />
              </label>
              <label className="font-bold">Accusation buzz cost
                <input className="field mt-1" name="accusationStake" type="number" min="0" defaultValue={Math.round(settingsAccusationStake / 100)} required />
              </label>
              <label className="font-bold">Hint cost
                <input className="field mt-1" name="hintPrice" type="number" min="0" defaultValue={Math.round(settingsHintPrice / 100)} required />
              </label>
              <label className="font-bold">Language
                <select className="field mt-1" name="language" defaultValue={String(settings.language ?? locale)}>
                  <option value="fr">Français</option>
                  <option value="en">English</option>
                </select>
              </label>
              <label className="font-bold">Start date &amp; time <span className="font-normal text-[var(--muted)]">(reminder only — the game never starts on its own)</span>
                <input className="field mt-1" name="startsAt" type="datetime-local" defaultValue={startsAtLocal} />
              </label>
              <label className="font-bold">Location
                <input className="field mt-1" name="location" defaultValue={String(settings.location ?? "")} placeholder="The Pink House, 12 Rose St." />
              </label>
              <label className="font-bold">Secret pack
                <select className="field mt-1" name="secretCategory" defaultValue={String(settings.secretCategory ?? "mixed")}>
                  {secretCategories.map((category) => (
                    <option key={category.key} value={category.key}>{category.label[locale === "fr" ? "fr" : "en"]}</option>
                  ))}
                </select>
              </label>
              <label className="flex items-start gap-3 sm:col-span-2">
                <input className="mt-1 size-4 shrink-0 accent-pink-600" type="checkbox" name="houseSecretEnabled" defaultChecked={houseEnabled} />
                <span>
                  <span className="block font-bold">Activate House Secret</span>
                  <span className="mt-1 block text-sm font-normal text-[var(--muted)]">
                    A game-wide mystery seeded on the Secrets tab. Clues are released by the host (never bought). If the run-of-show has a House Secret round, the House can only be accused during it — otherwise, any time.
                  </span>
                </span>
              </label>
              <button className="pill pill-primary sm:col-span-2">Save settings</button>
            </form>

            <form action={fillBankSecrets} className="bubble-card grid gap-2 p-6">
              <h3 className="font-black">Auto-fill secrets</h3>
              <p className="text-sm text-[var(--muted)]">Give every active player without a secret one from the chosen pack. Players can still change theirs while submission is open.</p>
              <input type="hidden" name="locale" value={locale} />
              <input type="hidden" name="gameId" value={String(game.id)} />
              <button className="pill pill-secondary w-fit"><Sparkles size={16} /> Fill missing secrets</button>
            </form>

            <form action={uploadGameBackground} className="bubble-card grid gap-3 p-6">
              <h3 className="font-black">Dashboard background image</h3>
              <p className="text-sm text-[var(--muted)]">Shown behind the TV dashboard. PNG, JPEG or WebP.</p>
              <input type="hidden" name="locale" value={locale} />
              <input type="hidden" name="gameId" value={String(game.id)} />
              <input className="field" type="file" name="image" accept="image/png,image/jpeg,image/webp" required />
              <button className="pill pill-secondary w-fit">Upload background</button>
            </form>

            <form action={saveFinaleConfig} className="bubble-card grid gap-4 p-6">
              <input type="hidden" name="locale" value={locale} />
              <input type="hidden" name="gameId" value={String(game.id)} />
              <div>
                <Vote className="text-pink-600" />
                <h2 className="display mt-3 text-3xl font-black">Finale</h2>
                <p className="mt-1 text-sm text-[var(--muted)]">Who reaches the finale, and how the winner is decided.</p>
              </div>

              <fieldset className="grid gap-3 sm:grid-cols-2">
                <legend className="font-black">Who plays the finale</legend>
                <label className="font-bold">Entry
                  <select className="field mt-1" name="entryMode" value={finaleEntryMode} onChange={(e) => setFinaleEntryMode(e.target.value)}>
                    <option value="all_active">All active players</option>
                    <option value="top_n_by_balance">Top N by balance</option>
                    <option value="top_n_by_score">Top N by score</option>
                    <option value="nominated">Nomination-round survivors</option>
                    <option value="manual">Host picks manually</option>
                  </select>
                </label>
                {finaleEntryMode.startsWith("top_n") ? (
                  <label className="font-bold">How many (N)
                    <input className="field mt-1" name="entryN" type="number" min="1" max="50" defaultValue={Number(finaleEntry.n ?? 3)} />
                  </label>
                ) : null}
              </fieldset>

              <fieldset className="grid gap-3">
                <legend className="font-black">How the winner is chosen</legend>
                <select className="field" name="resolutionMethod" value={finaleMethod} onChange={(e) => setFinaleMethod(e.target.value)}>
                  <option value="formula">Formula (weighted score)</option>
                  <option value="box_exchange">Box exchange (final Share / Steal)</option>
                  <option value="vote">Vote</option>
                  <option value="other">Other (host adjudicates)</option>
                </select>

                {finaleMethod === "box_exchange" ? (
                  <div className="grid gap-3 sm:grid-cols-3">
                    <label className="text-xs font-bold">All share %<input className="field mt-1" name="boxAllSharePercent" type="number" min="0" max="100" defaultValue={Number(finaleRes.allSharePercent ?? 100)} /></label>
                    <label className="text-xs font-bold">One steals %<input className="field mt-1" name="boxSingleStealerPercent" type="number" min="0" max="100" defaultValue={Number(finaleRes.singleStealerPercent ?? 60)} /></label>
                    <label className="text-xs font-bold">Many steal %<input className="field mt-1" name="boxMultiStealerPercent" type="number" min="0" max="100" defaultValue={Number(finaleRes.multipleStealersPercent ?? 30)} /></label>
                  </div>
                ) : null}
                {finaleMethod === "vote" ? (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="text-xs font-bold">Electorate
                      <select className="field mt-1" name="voteElectorate" defaultValue={String(finaleRes.electorate ?? "finalists")}>
                        <option value="finalists">Finalists</option>
                        <option value="all_players">All players</option>
                        <option value="eliminated_jury">Eliminated players (jury)</option>
                      </select>
                    </label>
                    <label className="text-xs font-bold">Tie-break
                      <select className="field mt-1" name="voteTieBreak" defaultValue={String(finaleRes.tieBreak ?? "most_money")}>
                        <option value="most_money">Most money</option>
                        <option value="host_decides">Host decides</option>
                      </select>
                    </label>
                  </div>
                ) : null}
                {finaleMethod === "other" ? (
                  <textarea className="field min-h-20" name="otherDescription" placeholder="Describe the rule you'll use to pick the winner…" defaultValue={String(finaleRes.description ?? "")} />
                ) : null}
              </fieldset>

              <button className="pill pill-primary w-fit">Save finale rules</button>
            </form>

            {finaleMethod === "formula" ? (
              <form action={saveWinnerFormula} className="bubble-card grid gap-3 p-6 sm:grid-cols-2">
                <input type="hidden" name="locale" value={locale} />
                <input type="hidden" name="gameId" value={String(game.id)} />
                <p className="text-sm font-black sm:col-span-2">Formula weights</p>
                {[
                  ["moneyWeight", "Money multiplier", "1"],
                  ["protectedSecretBonus", "Protected secret bonus", "5000"],
                  ["houseSecretBonus", "House Secret bonus", "5000"],
                  ["missionBonus", "Per mission bonus", "500"],
                  ["voteBonus", "Per finale vote", "1000"],
                ].map(([name, label, value]) => (
                  <label key={name} className="text-xs font-bold">{label}<input className="field mt-1" name={name} type="number" min="0" step={name === "moneyWeight" ? ".1" : "1"} defaultValue={value} /></label>
                ))}
                <button className="pill pill-primary sm:col-span-2">Save winner formula</button>
              </form>
            ) : null}

            {(() => {
              const result = (settings.finaleResult ?? null) as Row | null;
              if (result) {
                const rows = (result.results as Row[] | null) ?? [];
                const winnerId = String(result.winnerPlayerId ?? "");
                return (
                  <div className="bubble-card p-6">
                    <h3 className="display text-2xl font-black">Finale result</h3>
                    <p className="mt-1 text-sm text-[var(--muted)]">Method: {String(result.method)}</p>
                    <ol className="mt-3 space-y-1">
                      {rows.map((row, index) => (
                        <li key={String(row.playerId)} className={`flex items-center justify-between rounded-xl px-3 py-2 text-sm ${String(row.playerId) === winnerId ? "bg-emerald-100 font-black text-emerald-800" : "bg-pink-50"}`}>
                          <span>{index + 1}. {String(row.name)}{String(row.playerId) === winnerId ? " · winner" : ""}</span>
                          <span className="tabular-nums text-[var(--muted)]">
                            {formatMoney(Number(row.balance ?? 0), String(game.currency_symbol))} · {Number(row.score ?? 0)} pts · {Number(row.votes ?? 0)} votes
                          </span>
                        </li>
                      ))}
                    </ol>
                  </div>
                );
              }
              if (String(game.status) !== "finale") {
                return (
                  <p className="rounded-2xl bg-pink-50 p-4 text-sm text-[var(--muted)]">
                    Resolving the finale becomes available once the game reaches the finale (advance past the last round in the run-of-show header).
                  </p>
                );
              }
              const activePlayers = players.filter((p) => String(p.play_status ?? "active") === "active");
              return (
                <form
                  action={resolveFinale}
                  className="bubble-card grid gap-3 p-6"
                  onSubmit={(e) => {
                    if (finaleMethod === "box_exchange") {
                      const missing = activePlayers.some((p) => !boxChoices[String(p.id)]);
                      if (missing) {
                        e.preventDefault();
                        alert("Pick Share or Steal for every finalist first.");
                      }
                    }
                  }}
                >
                  <input type="hidden" name="locale" value={locale} />
                  <input type="hidden" name="gameId" value={String(game.id)} />
                  <input type="hidden" name="boxChoices" value={finaleMethod === "box_exchange" ? JSON.stringify(boxChoices) : ""} />
                  <h3 className="display text-2xl font-black">Resolve the finale</h3>
                  <p className="text-sm text-[var(--muted)]">
                    Method <span className="font-bold">{finaleMethod}</span>. Non-finalists become spectators; the game is marked complete. This can only run once.
                  </p>

                  {finaleMethod === "other" ? (
                    <label className="text-xs font-bold">Winner
                      <select className="field mt-1" name="winnerPlayerId" required defaultValue="">
                        <option value="" disabled>Pick the winner</option>
                        {activePlayers.map((player) => {
                          const profile = player.profiles as Row | null;
                          return <option key={String(player.id)} value={String(player.id)}>{String(profile?.display_name ?? "Player")}</option>;
                        })}
                      </select>
                    </label>
                  ) : null}

                  {finaleMethod === "box_exchange" ? (
                    <div className="grid gap-2">
                      <p className="text-xs font-bold text-[var(--muted)]">Each finalist&apos;s Share / Steal choice</p>
                      {activePlayers.map((player) => {
                        const profile = player.profiles as Row | null;
                        const pid = String(player.id);
                        return (
                          <div key={pid} className="flex items-center justify-between gap-3 rounded-xl bg-pink-50 px-3 py-2 text-sm">
                            <span className="truncate font-bold">{String(profile?.display_name ?? "Player")}</span>
                            <div className="flex gap-1">
                              {(["share", "steal"] as const).map((choice) => (
                                <button
                                  key={choice}
                                  type="button"
                                  onClick={() => setBoxChoices((prev) => ({ ...prev, [pid]: choice }))}
                                  className={`pill h-8 text-xs ${boxChoices[pid] === choice ? "pill-primary" : "pill-secondary"}`}
                                >
                                  {choice}
                                </button>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : null}

                  <button className="pill pill-primary w-fit"><Vote size={16} /> Resolve &amp; complete game</button>
                </form>
              );
            })()}

            <a className="pill pill-secondary w-full" href={`/api/games/${String(game.id)}/results`}>Export results CSV</a>

            <DeleteGameControls locale={locale} gameId={String(game.id)} title={String(game.title ?? "this game")} />
          </div>
        ) : null}

      </div>
    </section>
  );
}

// One net line per game action for a player's card. An accusation writes up to
// three ledger transactions (stake escrow, stake refund, settlement) that share
// a buzz id in their idempotency key; the host only wants the outcome
// ("Accusation won +X"), not the escrow/refund plumbing — so entries are
// grouped by action and summed.
function playerTransactions(ledger: Row[], playerId: string) {
  const groups = new Map<string, { net: number; types: Set<string>; at: number }>();

  for (const transaction of ledger) {
    const entries = (transaction.ledger_entries as Row[] | null) ?? [];
    const mine = entries.filter(
      (entry) => String((entry.wallets as Row | null)?.player_id) === playerId,
    );
    if (!mine.length) continue;

    // "buzzescrow:<id>", "buzzrefund:<id>" and "buzz:<id>" collapse to the same
    // accusation; "mission:<mid>:<pid>" collapses to the mission; every other
    // key is already one action.
    const rawKey = String(transaction.idempotency_key ?? transaction.id);
    const key = rawKey.replace(/^[a-z_]+:/i, "").split(":")[0] || rawKey;

    const group = groups.get(key) ?? { net: 0, types: new Set<string>(), at: 0 };
    for (const entry of mine) group.net += Number(entry.amount);
    group.types.add(String(transaction.type));
    group.at = Math.max(group.at, Date.parse(String(transaction.created_at ?? "")) || 0);
    groups.set(key, group);
  }

  return [...groups.entries()]
    .filter(([, group]) => group.net !== 0)
    .sort(([, a], [, b]) => b.at - a.at)
    .map(([id, group]) => ({ id, label: actionLabel(group.types, group.net), amount: group.net }));
}

function actionLabel(types: Set<string>, net: number) {
  const list = [...types];
  const has = (prefix: string) => list.some((type) => type.startsWith(prefix));
  if (has("buzz_")) {
    if (types.has("buzz_wrong")) return "Defense held";
    return net >= 0 ? "Accusation won" : "Accusation lost";
  }
  if (has("hint")) return net >= 0 ? "Hint sold" : "Hint bought";
  if (types.has("mission_reward")) return "Mission reward";
  if (types.has("mission_penalty")) return "Mission penalty";
  if (has("dilemma_")) return "Dilemma";
  if (types.has("team_funding")) return "Team pot";
  if (types.has("admin_adjustment")) return "Host adjustment";
  if (types.has("starting_cash")) return "Starting cash";
  if (types.has("reversal")) return "Correction";
  return (list[0] ?? "movement").replaceAll("_", " ");
}

// The lock/unlock control for player secrets. While round 1 hasn't started the
// host can flip it as often as they like; once the game is live the pill is
// inert and just shows the closed padlock.
function SecretsLockPill({
  locale,
  gameId,
  locked,
  canToggle,
  className = "",
}: {
  locale: string;
  gameId: string;
  locked: boolean;
  canToggle: boolean;
  className?: string;
}) {
  const Icon = locked ? Lock : LockOpen;
  if (!canToggle) {
    return (
      <span className={`pill pill-secondary opacity-70 ${className}`} title="Secrets are locked for the rest of the game">
        <Icon size={16} /> Secrets
      </span>
    );
  }
  return (
    <form action={hostTransition} className={className}>
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="gameId" value={gameId} />
      <input type="hidden" name="action" value={locked ? "unlock_secrets" : "lock_secrets"} />
      <button className={`pill ${locked ? "pill-primary" : "pill-secondary"}`} title={locked ? "Unlock secrets so players can edit them" : "Lock secrets"}>
        <Icon size={16} /> Secrets
      </button>
    </form>
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
