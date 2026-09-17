import { ImageResponse } from "next/og";
import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { formatMoney } from "@/lib/utils";
import type { FinaleAwardKey } from "@/components/game/game-show-finale";

// Story-ratio (1080x1920) shareable recap cards for a completed game: the
// winner, plus one per superlative award. Rendered on the fly from
// public_game_awards() — same data the finale video shows — via next/og's
// Satori-based ImageResponse (already used for the site's opengraph-image).
// No auth: gated only by the game's public_code, same trust model as the
// other public /api/assets endpoints.

export const size = { width: 1080, height: 1920 };

type RawAwards = {
  game: { title: string; currency_symbol: string; public_code: string };
  winner: { player_id: string; name: string; has_avatar: boolean; balance: number } | null;
  awards: { key: string; player_id: string; name: string; has_avatar: boolean; value: number }[];
};

const AWARD_KEYS = new Set<FinaleAwardKey>([
  "gossip",
  "bigSpender",
  "rockBottom",
  "tycoon",
  "triggerHappy",
  "masterSleuth",
  "wildGuesser",
]);

// Small, self-contained copy for the card — this route sits outside the
// [locale] segment (no ambient next-intl request context), so it isn't
// worth wiring up full i18n for a handful of short strings. Keep in sync
// with the matching award*Title keys in messages/*.json if those change.
const LABELS: Record<
  "en" | "fr",
  {
    winnerKicker: string;
    winnerTitle: string;
    winnerLine: (amount: string) => string;
    awardKicker: string;
    titles: Record<FinaleAwardKey, string>;
    lines: Record<FinaleAwardKey, (value: string) => string>;
    footer: string;
  }
> = {
  en: {
    winnerKicker: "Tonight's champion",
    winnerTitle: "Champion",
    winnerLine: (amount) => `Walks away with ${amount}`,
    awardKicker: "Tonight's superlative",
    titles: {
      gossip: "The Gossip Columnist",
      bigSpender: "Big Spender",
      rockBottom: "Rock Bottom",
      tycoon: "The Tycoon",
      triggerHappy: "Trigger Happy",
      masterSleuth: "Master Sleuth",
      wildGuesser: "Confidently Wrong",
    },
    lines: {
      gossip: (v) => `${v} secrets uncovered`,
      bigSpender: (v) => `${v} spent`,
      rockBottom: (v) => `${v} down from the start`,
      tycoon: (v) => `${v} final balance`,
      triggerHappy: (v) => `${v} accusations thrown`,
      masterSleuth: (v) => `${v} correct calls`,
      wildGuesser: (v) => `${v} wrong guesses`,
    },
    footer: "Play your own game at",
  },
  fr: {
    winnerKicker: "Le champion du soir",
    winnerTitle: "Champion",
    winnerLine: (amount) => `Repart avec ${amount}`,
    awardKicker: "Le superlatif du soir",
    titles: {
      gossip: "Le Ragot Ambulant",
      bigSpender: "Grand Dépensier",
      rockBottom: "Fond du Baril",
      tycoon: "Le Magnat",
      triggerHappy: "Gâchette Facile",
      masterSleuth: "Fin Limier",
      wildGuesser: "Confiant… et Faux",
    },
    lines: {
      gossip: (v) => `${v} secrets découverts`,
      bigSpender: (v) => `${v} dépensés`,
      rockBottom: (v) => `${v} de moins qu'au départ`,
      tycoon: (v) => `${v} en banque`,
      triggerHappy: (v) => `${v} accusations lancées`,
      masterSleuth: (v) => `${v} bonnes accusations`,
      wildGuesser: (v) => `${v} mauvaises accusations`,
    },
    footer: "Jouez votre propre partie sur",
  },
};

const AWARD_EMOJI: Record<FinaleAwardKey, string> = {
  gossip: "🕵️",
  bigSpender: "💸",
  rockBottom: "📉",
  tycoon: "👑",
  triggerHappy: "🚨",
  masterSleuth: "🎯",
  wildGuesser: "🤡",
};

function initialsFrom(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function siteHost() {
  try {
    return new URL(process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").host;
  } catch {
    return "secrets";
  }
}

function siteOrigin() {
  try {
    return new URL(process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").origin;
  } catch {
    return "http://localhost:3000";
  }
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ code: string; key: string }> },
) {
  const { code, key } = await params;
  const locale = new URL(request.url).searchParams.get("locale") === "fr" ? "fr" : "en";
  const L = LABELS[locale];

  const supabase = await createClient();
  const { data } = await supabase.rpc("public_game_awards", { p_code: code });
  const raw = data as RawAwards | null;
  if (!raw) return new NextResponse("Not found", { status: 404 });

  let emoji: string;
  let kicker: string;
  let title: string;
  let playerId: string;
  let name: string;
  let hasAvatar: boolean;
  let valueLine: string;

  if (key === "winner") {
    if (!raw.winner) return new NextResponse("Not found", { status: 404 });
    emoji = "🏆";
    kicker = L.winnerKicker;
    title = L.winnerTitle;
    playerId = raw.winner.player_id;
    name = raw.winner.name;
    hasAvatar = raw.winner.has_avatar;
    valueLine = L.winnerLine(formatMoney(raw.winner.balance, raw.game.currency_symbol));
  } else if (AWARD_KEYS.has(key as FinaleAwardKey)) {
    const awardKey = key as FinaleAwardKey;
    const award = raw.awards.find((a) => a.key === awardKey);
    if (!award) return new NextResponse("Not found", { status: 404 });
    const isMoney = awardKey === "bigSpender" || awardKey === "rockBottom" || awardKey === "tycoon";
    emoji = AWARD_EMOJI[awardKey];
    kicker = L.awardKicker;
    title = L.titles[awardKey];
    playerId = award.player_id;
    name = award.name;
    hasAvatar = award.has_avatar;
    valueLine = L.lines[awardKey](isMoney ? formatMoney(award.value, raw.game.currency_symbol) : String(award.value));
  } else {
    return new NextResponse("Not found", { status: 404 });
  }

  const avatarUrl = `${siteOrigin()}/api/assets/avatar/public/${raw.game.public_code}/${playerId}`;

  // `withAvatar: false` is the fallback used when the remote avatar image
  // fails to load — ImageResponse throws on a broken <img>, so a photo
  // problem should never block the whole card, just drop back to initials.
  const renderCard = (withAvatar: boolean) => (
    <div
      style={{
        height: "100%",
        width: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        background: "linear-gradient(160deg, #2b0a26, #7c2d67 55%, #12040f)",
        padding: "88px 72px",
        color: "#ffffff",
        fontFamily: "sans-serif",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 64,
            height: 64,
            borderRadius: 999,
            background: "rgba(255,255,255,0.16)",
            fontSize: 32,
          }}
        >
          ✨
        </div>
        <span style={{ fontSize: 36, fontWeight: 800, letterSpacing: "-0.02em" }}>Secrets</span>
      </div>

      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center" }}>
        <span
          style={{
            fontSize: 28,
            fontWeight: 800,
            letterSpacing: 5,
            textTransform: "uppercase",
            color: "rgba(255,192,229,0.85)",
          }}
        >
          {kicker}
        </span>
        <span style={{ fontSize: 140, marginTop: 28 }}>{emoji}</span>
        <span style={{ fontSize: 76, fontWeight: 800, marginTop: 24, lineHeight: 1.05, maxWidth: 880 }}>
          {title}
        </span>
        <div style={{ display: "flex", alignItems: "center", gap: 24, marginTop: 56 }}>
          {hasAvatar && withAvatar ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={avatarUrl} alt="" width={120} height={120} style={{ borderRadius: 999, objectFit: "cover" }} />
          ) : (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                width: 120,
                height: 120,
                borderRadius: 999,
                background: "linear-gradient(135deg, #f472b6, #7c3aed)",
                fontSize: 48,
                fontWeight: 800,
              }}
            >
              {initialsFrom(name)}
            </div>
          )}
          <span style={{ fontSize: 58, fontWeight: 800, maxWidth: 680 }}>{name}</span>
        </div>
        <span style={{ fontSize: 42, fontWeight: 700, marginTop: 32, color: "rgba(255,255,255,0.88)" }}>
          {valueLine}
        </span>
      </div>

      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
        <span style={{ fontSize: 32, fontWeight: 700, maxWidth: 900, textAlign: "center" }}>{raw.game.title}</span>
        <span style={{ fontSize: 24, color: "rgba(255,255,255,0.6)" }}>
          {L.footer} {siteHost()}
        </span>
      </div>
    </div>
  );

  try {
    return new ImageResponse(renderCard(true), {
      ...size,
      emoji: "twemoji",
      headers: { "Cache-Control": "public, max-age=3600" },
    });
  } catch {
    return new ImageResponse(renderCard(false), { ...size, emoji: "twemoji" });
  }
}
