"use client";

import { useMemo, useState } from "react";
import { Megaphone } from "lucide-react";
import { useTranslations } from "next-intl";

import { assignPower, publishDilemma, publishEvent } from "@/app/actions/admin";
import { powerSeeds } from "@/lib/game/seeds";
import { ActionForm } from "./action-form";

type Row = Record<string, unknown>;
type Named = { id: string; name: string };
type PowerKey = "double-vote" | "immunity" | "buzz-shield";

type EffectDraft =
  | { type: "cash"; direction: "gain" | "loss"; amount: number }
  | { type: "free_hint"; recipients: "responder" | "all"; aboutPlayerId: string }
  | { type: "free_buzz"; recipients: "responder" | "all" }
  | { type: "power"; power: PowerKey; recipients: "responder" | "all" };

// i18n keys (namespace "broadcast") for each effect's chip label.
function effectLabelKey(effect: EffectDraft): string {
  switch (effect.type) {
    case "cash":
      return "effMoney";
    case "free_hint":
      return "effFreeHint";
    case "free_buzz":
      return "effFreeBuzz";
    case "power":
      return effect.power === "double-vote"
        ? "eff2Votes"
        : effect.power === "immunity"
          ? "effImmunity"
          : "effBuzzShield";
  }
}

// The buttons that add a fresh effect row, in the order the host reads them.
const ADD_EFFECTS: { labelKey: string; make: () => EffectDraft }[] = [
  { labelKey: "effMoney", make: () => ({ type: "cash", direction: "gain", amount: 500 }) },
  { labelKey: "effFreeBuzz", make: () => ({ type: "free_buzz", recipients: "responder" }) },
  { labelKey: "effFreeHint", make: () => ({ type: "free_hint", recipients: "responder", aboutPlayerId: "" }) },
  { labelKey: "eff2Votes", make: () => ({ type: "power", power: "double-vote", recipients: "responder" }) },
  { labelKey: "effImmunity", make: () => ({ type: "power", power: "immunity", recipients: "responder" }) },
  { labelKey: "effBuzzShield", make: () => ({ type: "power", power: "buzz-shield", recipients: "responder" }) },
];

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
  const t = useTranslations("broadcast");
  const tc = useTranslations("common");
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
        {(
          [
            ["announcement", "tabAnnouncement"],
            ["clue", "tabClue"],
            ["dilemma", "tabDilemma"],
            ["power", "tabPower"],
          ] as const
        ).map(([ty, key]) => (
          <button
            key={ty}
            type="button"
            onClick={() => setBroadcastType(ty)}
            className={`pill ${broadcastType === ty ? "pill-primary" : "pill-secondary"}`}
          >
            {t(key)}
          </button>
        ))}
      </div>

      {broadcastType === "announcement" || broadcastType === "clue" ? (
        <ActionForm
          action={publishEvent}
          success={broadcastType === "clue" ? t("toastClue") : t("toastAnnouncement")}
          onDone={() => {
            const el = document.getElementById("broadcast-title") as HTMLInputElement | null;
            if (el) el.value = "";
          }}
          className="mt-4 grid gap-2"
        >
          <input type="hidden" name="locale" value={locale} />
          <input type="hidden" name="gameId" value={gameId} />
          <input type="hidden" name="kind" value={broadcastType} />
          <p className="text-sm text-[var(--muted)]">
            {broadcastType === "clue" ? t("clueBlurb") : t("announcementBlurb")}
          </p>
          <input id="broadcast-title" className="field" name="title" placeholder={broadcastType === "clue" ? t("cluePlaceholder") : t("announcementPlaceholder")} required />
          <button className="pill pill-primary w-fit">
            <Megaphone size={16} /> {t("broadcastCta")}
          </button>
        </ActionForm>
      ) : null}

      {broadcastType === "dilemma" ? (
        <ActionForm action={publishDilemma} success={t("toastDilemma")} className="mt-4 grid gap-3">
          <input type="hidden" name="locale" value={locale} />
          <input type="hidden" name="gameId" value={gameId} />
          <input type="hidden" name="effects" value={JSON.stringify(serializeEffects(effects))} />

          <label className="text-xs font-bold">
            {t("dilemmaOneSentence")}
            <input
              className="field mt-1"
              name="prompt"
              maxLength={240}
              placeholder={t("dilemmaPlaceholder")}
              required
            />
          </label>

          <div className="grid gap-3 sm:grid-cols-[12rem_1fr] sm:items-start">
            <label className="text-xs font-bold">
              {t("whoGetsIt")}
              <select
                className="field mt-1"
                name="scope"
                value={dilemmaScope}
                onChange={(e) => setDilemmaScope(e.target.value as typeof dilemmaScope)}
              >
                <option value="all">{t("everyone")}</option>
                <option value="team">{t("aTeam")}</option>
                <option value="player">{t("onePlayer")}</option>
              </select>
            </label>
            {dilemmaScope === "team" ? (
              <label className="text-xs font-bold">
                {t("aTeam")}
                <select className="field mt-1" name="teamId" defaultValue="" required>
                  <option value="" disabled>
                    {t("chooseTeam")}
                  </option>
                  {teamOptions.map((team) => (
                    <option key={team.id} value={team.id}>
                      {team.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            {dilemmaScope === "player" ? (
              <label className="text-xs font-bold">
                {t("onePlayer")}
                <select className="field mt-1" name="playerId" defaultValue="" required>
                  <option value="" disabled>
                    {t("choosePlayer")}
                  </option>
                  {playerOptions.map((player) => (
                    <option key={player.id} value={player.id}>
                      {player.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
          </div>

          <fieldset className="rounded-xl border border-pink-100 bg-pink-50/40 p-3">
            <legend className="px-1 text-xs font-black uppercase tracking-widest text-pink-600">
              {t("onAccept")}
            </legend>
            {!effects.length ? (
              <p className="text-xs text-[var(--muted)]">{t("nothingYet")}</p>
            ) : null}
            <div className="mt-2 space-y-2">
              {effects.map((effect, index) => (
                <div key={index} className="flex flex-wrap items-center gap-2 rounded-lg bg-white p-2 text-xs">
                  <span className="rounded-full bg-pink-100 px-2 py-1 font-black text-pink-700">
                    {t(effectLabelKey(effect))}
                  </span>

                  {effect.type === "cash" ? (
                    <>
                      <select
                        className="field h-8 w-auto"
                        value={effect.direction}
                        onChange={(e) => updateEffect(index, { direction: e.target.value as "gain" | "loss" })}
                      >
                        <option value="gain">{t("giveToAccepter")}</option>
                        <option value="loss">{t("takeFromAccepter")}</option>
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

                  {effect.type === "free_hint" || effect.type === "free_buzz" || effect.type === "power" ? (
                    <select
                      className="field h-8 w-auto"
                      value={effect.recipients}
                      onChange={(e) => updateEffect(index, { recipients: e.target.value as "responder" | "all" })}
                    >
                      <option value="responder">{t("forAccepter")}</option>
                      <option value="all">{t("forEveryone")}</option>
                    </select>
                  ) : null}

                  {effect.type === "free_hint" ? (
                    <select
                      className="field h-8 w-auto"
                      value={effect.aboutPlayerId}
                      onChange={(e) => updateEffect(index, { aboutPlayerId: e.target.value })}
                    >
                      <option value="">{t("aboutAnyone")}</option>
                      {playerOptions.map((player) => (
                        <option key={player.id} value={player.id}>
                          {t("about", { name: player.name })}
                        </option>
                      ))}
                    </select>
                  ) : null}

                  <button
                    type="button"
                    onClick={() => removeEffect(index)}
                    className="ml-auto rounded-full bg-pink-50 px-2 py-1 font-bold text-pink-600 hover:bg-pink-100"
                  >
                    {tc("remove")}
                  </button>
                </div>
              ))}
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              {ADD_EFFECTS.map(({ labelKey, make }) => (
                <button
                  key={labelKey}
                  type="button"
                  onClick={() => setEffects((prev) => [...prev, make()])}
                  className="pill pill-secondary h-8 text-xs"
                >
                  + {t(labelKey)}
                </button>
              ))}
            </div>
          </fieldset>

          <label className="flex items-center gap-2 text-sm font-bold">
            <input type="checkbox" name="isPublic" /> {t("showOnDashboard")}
          </label>
          <button className="pill pill-primary w-fit">{t("sendDilemma")}</button>
        </ActionForm>
      ) : null}

      {broadcastType === "power" ? (
        <ActionForm action={assignPower} success={t("toastPower")} className="mt-4 grid gap-3">
          <input type="hidden" name="locale" value={locale} />
          <input type="hidden" name="gameId" value={gameId} />
          <div className="grid gap-3 sm:grid-cols-[12rem_1fr] sm:items-start">
            <label className="text-xs font-bold">
              {t("whoGetsIt")}
              <select
                className="field mt-1"
                name="scope"
                value={powerScope}
                onChange={(e) => setPowerScope(e.target.value as typeof powerScope)}
              >
                <option value="player">{t("onePlayer")}</option>
                <option value="team">{t("aTeam")}</option>
                <option value="all">{t("everyone")}</option>
              </select>
            </label>
            {powerScope === "player" ? (
              <label className="text-xs font-bold">
                {t("onePlayer")}
                <select className="field mt-1" name="playerId" defaultValue="" required>
                  <option value="" disabled>
                    {t("choosePlayer")}
                  </option>
                  {playerOptions.map((player) => (
                    <option key={player.id} value={player.id}>
                      {player.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            {powerScope === "team" ? (
              <label className="text-xs font-bold">
                {t("aTeam")}
                <select className="field mt-1" name="teamId" defaultValue="" required>
                  <option value="" disabled>
                    {t("chooseTeam")}
                  </option>
                  {teamOptions.map((team) => (
                    <option key={team.id} value={team.id}>
                      {team.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
          </div>

          <label className="text-xs font-bold">
            {t("power")}
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
              <option value="other">{t("powerOther")}</option>
            </select>
          </label>
          {powerKind === "other" ? (
            <input className="field" name="kindOther" placeholder={t("customPowerPlaceholder")} required />
          ) : null}

          <label className="flex items-center gap-2 text-sm font-bold">
            <input type="checkbox" name="isPublic" defaultChecked /> {t("announceOnDashboard")}
          </label>
          <button className="pill pill-primary w-fit">{t("grantPower")}</button>
        </ActionForm>
      ) : null}
    </div>
  );
}
