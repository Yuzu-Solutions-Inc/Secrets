"use client";

import { useMemo, useState } from "react";
import { Megaphone } from "lucide-react";

import { assignPower, publishDilemma, publishEvent } from "@/app/actions/admin";
import { powerSeeds } from "@/lib/game/seeds";

type Row = Record<string, unknown>;
type Named = { id: string; name: string };

type EffectDraft =
  | { type: "cash"; direction: "gain" | "loss"; amount: number }
  | { type: "free_hint"; recipients: "responder" | "all"; aboutPlayerId: string }
  | { type: "free_buzz"; recipients: "responder" | "all" }
  | { type: "buzz_immunity"; recipients: "responder" | "all"; minutes: number };

const EFFECT_LABELS: Record<EffectDraft["type"], string> = {
  cash: "Money",
  free_hint: "Free hint",
  free_buzz: "Free buzz",
  buzz_immunity: "Buzz immunity",
};

function blankEffect(type: EffectDraft["type"]): EffectDraft {
  switch (type) {
    case "cash":
      return { type: "cash", direction: "gain", amount: 500 };
    case "free_hint":
      return { type: "free_hint", recipients: "responder", aboutPlayerId: "" };
    case "free_buzz":
      return { type: "free_buzz", recipients: "responder" };
    case "buzz_immunity":
      return { type: "buzz_immunity", recipients: "responder", minutes: 10 };
  }
}

// What actually gets sent — drop empty optional fields.
function serializeEffects(effects: EffectDraft[]) {
  return effects.map((effect) => {
    if (effect.type === "free_hint") {
      const { aboutPlayerId, ...rest } = effect;
      return aboutPlayerId ? { ...rest, aboutPlayerId } : rest;
    }
    return effect;
  });
}

const PRESETS: { label: string; effects: EffectDraft[] }[] = [
  { label: "Get $500 + free hint to everyone", effects: [{ type: "cash", direction: "gain", amount: 500 }, { type: "free_hint", recipients: "all", aboutPlayerId: "" }] },
  { label: "Free hint for everyone", effects: [{ type: "free_hint", recipients: "all", aboutPlayerId: "" }] },
  { label: "Free buzz for the accepter", effects: [{ type: "free_buzz", recipients: "responder" }] },
  { label: "Buzz immunity for the accepter", effects: [{ type: "buzz_immunity", recipients: "responder", minutes: 10 }] },
];

export function BroadcastComposer({
  locale,
  gameId,
  teams,
  players,
}: {
  locale: string;
  gameId: string;
  teams: Row[];
  players: Row[];
}) {
  const [broadcastType, setBroadcastType] = useState("announcement");
  const [dilemmaScope, setDilemmaScope] = useState<"all" | "team" | "player">("all");
  const [powerScope, setPowerScope] = useState<"player" | "team" | "all">("player");
  const [powerKind, setPowerKind] = useState("immunity");
  const [effects, setEffects] = useState<EffectDraft[]>([]);

  const teamOptions: Named[] = useMemo(
    () => teams.map((t) => ({ id: String(t.id), name: String(t.name) })),
    [teams],
  );
  const playerOptions: Named[] = useMemo(
    () =>
      players.map((p) => ({
        id: String(p.id),
        name: String((p.profiles as Row | null)?.display_name ?? "Player"),
      })),
    [players],
  );

  const updateEffect = (index: number, patch: Partial<EffectDraft>) =>
    setEffects((prev) => prev.map((e, i) => (i === index ? ({ ...e, ...patch } as EffectDraft) : e)));
  const removeEffect = (index: number) => setEffects((prev) => prev.filter((_, i) => i !== index));

  return (
    <div className="bubble-card p-5">
      <div className="flex flex-wrap gap-2">
        {["announcement", "clue", "dilemma", "power"].map((ty) => (
          <button
            key={ty}
            type="button"
            onClick={() => setBroadcastType(ty)}
            className={`pill capitalize ${broadcastType === ty ? "pill-primary" : "pill-secondary"}`}
          >
            {ty}
          </button>
        ))}
      </div>

      {broadcastType === "announcement" || broadcastType === "clue" ? (
        <form action={publishEvent} className="mt-4 grid gap-2">
          <input type="hidden" name="locale" value={locale} />
          <input type="hidden" name="gameId" value={gameId} />
          <input type="hidden" name="kind" value={broadcastType} />
          <p className="text-sm text-[var(--muted)]">
            {broadcastType === "clue"
              ? "A clue — its own dashboard sound and animation. Always public, always for everyone."
              : "One line for the whole room, full-screen on the dashboard with sound. Always public."}
          </p>
          <input className="field" name="title" placeholder={broadcastType === "clue" ? "The clue…" : "The announcement…"} required />
          <button className="pill pill-primary w-fit">
            <Megaphone size={16} /> Broadcast
          </button>
        </form>
      ) : null}

      {broadcastType === "dilemma" ? (
        <form action={publishDilemma} className="mt-4 grid gap-3">
          <input type="hidden" name="locale" value={locale} />
          <input type="hidden" name="gameId" value={gameId} />
          <input type="hidden" name="effects" value={JSON.stringify(serializeEffects(effects))} />

          <label className="text-xs font-bold">
            The dilemma — one sentence
            <input
              className="field mt-1"
              name="prompt"
              maxLength={240}
              placeholder="Take $500 now, but everyone gets a free hint about you."
              required
            />
          </label>

          <div className="grid gap-3 sm:grid-cols-[12rem_1fr] sm:items-start">
            <label className="text-xs font-bold">
              Who gets it
              <select
                className="field mt-1"
                name="scope"
                value={dilemmaScope}
                onChange={(e) => setDilemmaScope(e.target.value as typeof dilemmaScope)}
              >
                <option value="all">Everyone</option>
                <option value="team">A team</option>
                <option value="player">One player</option>
              </select>
            </label>
            {dilemmaScope === "team" ? (
              <label className="text-xs font-bold">
                Team
                <select className="field mt-1" name="teamId" defaultValue="" required>
                  <option value="" disabled>
                    Choose a team…
                  </option>
                  {teamOptions.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            {dilemmaScope === "player" ? (
              <label className="text-xs font-bold">
                Player
                <select className="field mt-1" name="playerId" defaultValue="" required>
                  <option value="" disabled>
                    Choose a player…
                  </option>
                  {playerOptions.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
          </div>

          <fieldset className="rounded-xl border border-pink-100 bg-pink-50/40 p-3">
            <legend className="px-1 text-xs font-black uppercase tracking-widest text-pink-600">
              On Accept — auto-applied
            </legend>
            {!effects.length ? (
              <p className="text-xs text-[var(--muted)]">
                Nothing yet. Add an effect, or pick a preset. Refuse never does anything.
              </p>
            ) : null}
            <div className="mt-2 space-y-2">
              {effects.map((effect, index) => (
                <div key={index} className="flex flex-wrap items-center gap-2 rounded-lg bg-white p-2 text-xs">
                  <span className="rounded-full bg-pink-100 px-2 py-1 font-black text-pink-700">
                    {EFFECT_LABELS[effect.type]}
                  </span>

                  {effect.type === "cash" ? (
                    <>
                      <select
                        className="field h-8 w-auto"
                        value={effect.direction}
                        onChange={(e) => updateEffect(index, { direction: e.target.value as "gain" | "loss" })}
                      >
                        <option value="gain">Give to accepter</option>
                        <option value="loss">Take from accepter</option>
                      </select>
                      <input
                        className="field h-8 w-24"
                        type="number"
                        min={1}
                        value={effect.amount}
                        onChange={(e) => updateEffect(index, { amount: Math.max(1, Number(e.target.value)) })}
                      />
                    </>
                  ) : null}

                  {effect.type === "free_hint" || effect.type === "free_buzz" || effect.type === "buzz_immunity" ? (
                    <select
                      className="field h-8 w-auto"
                      value={effect.recipients}
                      onChange={(e) => updateEffect(index, { recipients: e.target.value as "responder" | "all" })}
                    >
                      <option value="responder">for the accepter</option>
                      <option value="all">for everyone</option>
                    </select>
                  ) : null}

                  {effect.type === "free_hint" ? (
                    <select
                      className="field h-8 w-auto"
                      value={effect.aboutPlayerId}
                      onChange={(e) => updateEffect(index, { aboutPlayerId: e.target.value })}
                    >
                      <option value="">about anyone</option>
                      {playerOptions.map((p) => (
                        <option key={p.id} value={p.id}>
                          about {p.name}
                        </option>
                      ))}
                    </select>
                  ) : null}

                  {effect.type === "buzz_immunity" ? (
                    <span className="flex items-center gap-1">
                      <input
                        className="field h-8 w-16"
                        type="number"
                        min={1}
                        max={180}
                        value={effect.minutes}
                        onChange={(e) => updateEffect(index, { minutes: Math.min(180, Math.max(1, Number(e.target.value))) })}
                      />
                      min
                    </span>
                  ) : null}

                  <button
                    type="button"
                    onClick={() => removeEffect(index)}
                    className="ml-auto rounded-full bg-pink-50 px-2 py-1 font-bold text-pink-600 hover:bg-pink-100"
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              {(Object.keys(EFFECT_LABELS) as EffectDraft["type"][]).map((type) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => setEffects((prev) => [...prev, blankEffect(type)])}
                  className="pill pill-secondary h-8 text-xs"
                >
                  + {EFFECT_LABELS[type]}
                </button>
              ))}
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              {PRESETS.map((preset) => (
                <button
                  key={preset.label}
                  type="button"
                  onClick={() => setEffects(preset.effects.map((e) => ({ ...e })))}
                  className="rounded-full bg-white px-2 py-1 text-[11px] font-bold text-pink-600 ring-1 ring-pink-100 hover:bg-pink-50"
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </fieldset>

          <label className="flex items-center gap-2 text-sm font-bold">
            <input type="checkbox" name="isPublic" /> Show on the dashboard
          </label>
          <button className="pill pill-primary w-fit">Send dilemma</button>
        </form>
      ) : null}

      {broadcastType === "power" ? (
        <form action={assignPower} className="mt-4 grid gap-3">
          <input type="hidden" name="locale" value={locale} />
          <input type="hidden" name="gameId" value={gameId} />
          <div className="grid gap-3 sm:grid-cols-[12rem_1fr] sm:items-start">
            <label className="text-xs font-bold">
              Who gets it
              <select
                className="field mt-1"
                name="scope"
                value={powerScope}
                onChange={(e) => setPowerScope(e.target.value as typeof powerScope)}
              >
                <option value="player">One player</option>
                <option value="team">A team</option>
                <option value="all">Everyone</option>
              </select>
            </label>
            {powerScope === "player" ? (
              <label className="text-xs font-bold">
                Player
                <select className="field mt-1" name="playerId" defaultValue="" required>
                  <option value="" disabled>
                    Choose a player…
                  </option>
                  {playerOptions.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            {powerScope === "team" ? (
              <label className="text-xs font-bold">
                Team
                <select className="field mt-1" name="teamId" defaultValue="" required>
                  <option value="" disabled>
                    Choose a team…
                  </option>
                  {teamOptions.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
          </div>

          <label className="text-xs font-bold">
            Power
            <select
              className="field mt-1"
              name="kind"
              value={powerKind}
              onChange={(e) => setPowerKind(e.target.value)}
            >
              {powerSeeds.map((power) => (
                <option key={power.key} value={power.key}>
                  {power.title[locale === "fr" ? "fr" : "en"]}
                </option>
              ))}
              <option value="other">Other…</option>
            </select>
          </label>
          {powerKind === "other" ? (
            <input className="field" name="kindOther" placeholder="Custom power name" required />
          ) : null}

          <label className="flex items-center gap-2 text-sm font-bold">
            <input type="checkbox" name="isPublic" defaultChecked /> Announce on the dashboard
          </label>
          <button className="pill pill-primary w-fit">Grant power</button>
        </form>
      ) : null}
    </div>
  );
}
