"use client";

import { Clock3, Lock, PartyPopper, Sparkles } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { useFormStatus } from "react-dom";

import { createGame } from "@/app/actions/game";
import type { EntitlementSummary } from "@/lib/billing/plan";

const PRO_FEATURES = [
  "sharedSecrets",
  "secretReplacement",
  "imageHints",
  "teamMissions",
  "publicMissions",
  "advancedRounds",
] as const;

function SubmitButton({ label, disabled }: { label: string; disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      className="pill pill-primary w-full disabled:cursor-not-allowed disabled:opacity-60"
      disabled={pending || disabled}
      aria-busy={pending}
    >
      <Sparkles size={18} /> {label}
    </button>
  );
}

export function NewGameForm({
  locale,
  organizationId,
  summary,
}: {
  locale: string;
  organizationId?: string;
  summary: EntitlementSummary;
}) {
  const t = useTranslations("games");
  const [tier, setTier] = useState<"free" | "pro">("free");
  const isPro = tier === "pro";

  return (
    <form action={createGame} className="bubble-card mt-7 space-y-6 p-6 sm:p-8">
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="organizationId" value={organizationId} />

      <label className="block font-bold">
        {t("name")}
        <input className="field mt-2" name="title" placeholder="The Pink House" required minLength={2} maxLength={100} />
      </label>

      <fieldset>
        <legend className="font-bold">{t("plan")}</legend>
        <p className="mt-1 text-sm text-[var(--muted)]">{summary.label}</p>
        <div className="mt-2 grid gap-3 sm:grid-cols-2">
          <label className="cursor-pointer rounded-2xl border border-pink-100 bg-white p-4 has-[:checked]:border-pink-500 has-[:checked]:bg-pink-50">
            <input
              className="sr-only"
              type="radio"
              name="tier"
              value="free"
              checked={tier === "free"}
              onChange={() => setTier("free")}
            />
            <span className="block font-black">{t("planFree")}</span>
            <span className="text-sm text-[var(--muted)]">{t("planFreeHint")}</span>
          </label>
          <label
            className={`rounded-2xl border border-pink-100 bg-white p-4 has-[:checked]:border-pink-500 has-[:checked]:bg-pink-50 ${
              summary.canStartPro ? "cursor-pointer" : "opacity-60"
            }`}
          >
            <input
              className="sr-only"
              type="radio"
              name="tier"
              value="pro"
              disabled={!summary.canStartPro}
              checked={tier === "pro"}
              onChange={() => setTier("pro")}
            />
            <span className="flex items-center gap-1 font-black">
              {!summary.canStartPro ? <Lock size={14} /> : null} {t("planPro")}
            </span>
            <span className="text-sm text-[var(--muted)]">
              {summary.canStartPro ? t("planProHint") : t("planProLocked")}
            </span>
            {!summary.canStartPro ? (
              <a href={`/${locale}/billing`} className="mt-1 block text-sm font-bold text-pink-600 underline">
                {t("seePlans")}
              </a>
            ) : null}
          </label>
        </div>
      </fieldset>

      <fieldset>
        <legend className="font-bold">{t("format")}</legend>
        <div className="mt-2 grid gap-3 sm:grid-cols-3">
          {([
            ["quick", t("quick"), "3–4 h", PartyPopper, false],
            ["weekend", t("weekend"), "1–2 days", Clock3, true],
            ["custom", t("custom"), "You decide", Sparkles, true],
          ] as const).map(([value, label, duration, Icon, proOnly]) => {
            const disabled = proOnly && !isPro;
            return (
              <label
                key={value}
                className={`rounded-2xl border border-pink-100 bg-white p-4 has-[:checked]:border-pink-500 has-[:checked]:bg-pink-50 ${
                  disabled ? "opacity-50" : "cursor-pointer"
                }`}
              >
                <input
                  className="sr-only"
                  type="radio"
                  name="format"
                  value={value}
                  defaultChecked={value === "quick"}
                  disabled={disabled}
                />
                <Icon className="text-pink-600" />
                <span className="mt-3 block font-black">{label}</span>
                <span className="text-sm text-[var(--muted)]">{duration}</span>
              </label>
            );
          })}
        </div>
      </fieldset>

      {isPro ? (
        <fieldset>
          <legend className="font-bold">{t("proFeatures")}</legend>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {PRO_FEATURES.map((key) => (
              <label key={key} className="flex cursor-pointer items-center gap-2 rounded-xl border border-pink-100 bg-white p-3 text-sm">
                <input type="checkbox" name={`feat_${key}`} className="size-4 accent-pink-500" />
                {t(`feat${key.charAt(0).toUpperCase()}${key.slice(1)}` as Parameters<typeof t>[0])}
              </label>
            ))}
          </div>
        </fieldset>
      ) : null}

      <label className="block font-bold">
        {t("cash")}
        <input className="field mt-2" name="startingCash" type="number" min="0" defaultValue="10000" required />
      </label>

      <SubmitButton label={t("create")} disabled={!organizationId} />
    </form>
  );
}
