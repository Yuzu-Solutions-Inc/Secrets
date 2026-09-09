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

export type GameFormat = keyof typeof gameFormats;

// Format templates are more than a round list: Quick Night runs a looser
// economy (more starting cash, cheaper buzzes) so a party can start fast;
// Weekend is tighter. Amounts are in whole currency units — callers convert
// to the integer minor units the ledger stores.
export type FormatEconomy = {
  startingCash: number;
  accusationStake: number;
  hintPrice: number;
};

export const formatEconomy: Record<GameFormat, FormatEconomy> = {
  quick: { startingCash: 2000, accusationStake: 1000, hintPrice: 750 },
  weekend: { startingCash: 1000, accusationStake: 1000, hintPrice: 750 },
  custom: { startingCash: 1500, accusationStake: 1000, hintPrice: 750 },
};

// Categories for the ready-made secret bank. "mixed" draws from all of them.
// Labels are bilingual so the picker works in either locale without a
// message-catalog round-trip.
export const secretCategories = [
  { key: "mixed", label: { en: "Mixed", fr: "Mélangé" } },
  { key: "family", label: { en: "Family", fr: "Famille" } },
  { key: "kids", label: { en: "Kids", fr: "Enfants" } },
  { key: "couples", label: { en: "Couples", fr: "Couples" } },
  { key: "girls_night", label: { en: "Girls' night", fr: "Soirée entre filles" } },
  { key: "guys_night", label: { en: "Guys' night", fr: "Soirée entre gars" } },
  { key: "work_party", label: { en: "Work party", fr: "Fête de bureau" } },
  { key: "awkward", label: { en: "Awkward", fr: "Gênant" } },
  { key: "wholesome", label: { en: "Wholesome", fr: "Attendrissant" } },
  { key: "dark", label: { en: "Dark secrets", fr: "Secrets sombres" } },
  { key: "spicy", label: { en: "18+", fr: "18+" } },
] as const;

export type SecretCategory = (typeof secretCategories)[number]["key"];
