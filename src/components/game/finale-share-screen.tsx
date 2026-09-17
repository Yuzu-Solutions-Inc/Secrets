"use client";

import { Crown, Download } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";

import { AWARD_META, type FinaleData } from "./game-show-finale";

// Post-game landing state for the public display: once the finale video has
// run (or the host replays it later), the board underneath is replaced by
// this — a set of story-ratio (1080x1920) recap cards, one per superlative
// plus the winner, each rendered server-side by /api/assets/finale-card and
// downloadable straight from the big screen so someone can post it.
export function FinaleShareScreen({ code, data }: { code: string; data: FinaleData }) {
  const t = useTranslations("display");
  const locale = useLocale();

  const cards: { key: string; label: string; Icon: typeof Crown }[] = [];
  if (data.winner) cards.push({ key: "winner", label: t("finaleWinnerKicker"), Icon: Crown });
  for (const award of data.awards) {
    cards.push({ key: award.key, label: t(AWARD_META[award.key].titleKey), Icon: AWARD_META[award.key].Icon });
  }

  if (cards.length === 0) return null;

  return (
    <div className="flex min-h-0 flex-1 flex-col items-center gap-[clamp(1rem,2vh,1.75rem)] overflow-y-auto rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-[clamp(1.5rem,3vw,2.5rem)] text-center shadow-[var(--shadow)] backdrop-blur-xl">
      <div>
        <p className="text-[clamp(.7rem,1.2vw,1rem)] font-black uppercase tracking-[.2em] text-pink-600">{t("shareTitle")}</p>
        <p className="mt-[6px] text-[clamp(.85rem,1.3vw,1.05rem)] font-semibold text-[color:var(--muted)]">{t("shareBlurb")}</p>
      </div>

      <div
        className="grid w-full max-w-[76rem] gap-[clamp(.75rem,1.5vw,1.25rem)]"
        style={{ gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))" }}
      >
        {cards.map(({ key, label, Icon }) => {
          const href = `/api/assets/finale-card/${code}/${key}?locale=${locale}`;
          return (
            <a
              key={key}
              href={href}
              download={`${key}.png`}
              className="group flex flex-col items-center gap-[8px] rounded-[18px] p-[8px] transition-colors hover:bg-[var(--blush)]"
            >
              <div className="relative w-full overflow-hidden rounded-[14px] shadow-[0_10px_28px_rgba(124,20,90,.22)]" style={{ aspectRatio: "9 / 16" }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={href} alt={label} className="size-full object-cover" loading="lazy" />
                <span className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-[6px] bg-black/55 py-[6px] text-[11px] font-black uppercase tracking-wide text-white opacity-0 transition-opacity group-hover:opacity-100">
                  <Download size={13} /> {t("shareDownload")}
                </span>
              </div>
              <p className="flex items-center gap-[6px] text-[clamp(.75rem,1.1vw,.9rem)] font-bold leading-tight text-[color:var(--ink)]">
                <Icon size={14} className="shrink-0 text-pink-600" /> {label}
              </p>
            </a>
          );
        })}
      </div>
    </div>
  );
}
