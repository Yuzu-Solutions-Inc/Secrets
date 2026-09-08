import type { RoundConfig } from "./rules";

export type RoundTemplate = {
  key: string;
  title: { en: string; fr: string };
  kind: "team" | "solo" | "house_secret" | "event" | "nomination" | "finale";
  config: RoundConfig;
};

const base: RoundConfig = {
  durationMinutes: 45,
  walletMode: "personal",
  accusationBuzzEnabled: true,
  hintBuzzEnabled: true,
  accusationStake: 500_000,
  correctTransferPercent: 50,
  hintPrice: 100_000,
  hintVisibility: "private",
  completion: "manual",
};

export const roundTemplates: RoundTemplate[] = [
  {
    key: "team-investigation",
    title: { en: "Team investigation", fr: "Enquête en équipe" },
    kind: "team",
    config: {
      ...base,
      durationMinutes: 60,
      walletMode: "temporary_team",
      hintVisibility: "team",
    },
  },
  {
    key: "solo-investigation",
    title: { en: "Solo investigation", fr: "Enquête solo" },
    kind: "solo",
    config: base,
  },
  {
    key: "house-secret",
    title: { en: "House Secret", fr: "Secret de la maison" },
    kind: "house_secret",
    config: {
      ...base,
      durationMinutes: 30,
      accusationBuzzEnabled: false,
      hintVisibility: "public",
    },
  },
  {
    key: "surprise-event",
    title: { en: "Surprise event", fr: "Événement surprise" },
    kind: "event",
    config: {
      ...base,
      durationMinutes: 15,
      accusationBuzzEnabled: false,
      hintBuzzEnabled: false,
    },
  },
  {
    key: "nomination",
    title: { en: "Nominations", fr: "Nominations" },
    kind: "nomination",
    config: {
      ...base,
      durationMinutes: 15,
      accusationBuzzEnabled: false,
      hintBuzzEnabled: false,
      completion: "all_submitted",
    },
  },
  {
    key: "finale",
    title: { en: "Finale", fr: "Finale" },
    kind: "finale",
    config: {
      ...base,
      durationMinutes: 30,
      hintBuzzEnabled: false,
    },
  },
];

export const gameFormats = {
  quick: [
    "team-investigation",
    "solo-investigation",
    "house-secret",
    "finale",
  ],
  weekend: [
    "team-investigation",
    "surprise-event",
    "solo-investigation",
    "house-secret",
    "team-investigation",
    "nomination",
    "solo-investigation",
    "finale",
  ],
  custom: [],
} as const;
