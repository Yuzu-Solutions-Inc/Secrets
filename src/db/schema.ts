import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
};

export const memberRole = pgEnum("member_role", ["admin", "player"]);
export const gameStatus = pgEnum("game_status", [
  "draft",
  "secret_submission",
  "locked",
  "live",
  "finale",
  "completed",
  "archived",
]);
export const roundKind = pgEnum("round_kind", [
  "team",
  "solo",
  "house_secret",
  "event",
  "nomination",
  "elimination",
  "finale",
]);
export const roundStatus = pgEnum("round_status", [
  "scheduled",
  "live",
  "paused",
  "completed",
  "cancelled",
]);
export const secretStatus = pgEnum("secret_status", ["draft", "locked", "revealed"]);
export const hintKind = pgEnum("hint_kind", ["text", "image"]);
export const knowledgeScope = pgEnum("knowledge_scope", [
  "private",
  "team",
  "public",
]);
export const buzzStatus = pgEnum("buzz_status", [
  "pending",
  "confrontation",
  "retracted",
  "confirmed",
  "correct",
  "partial",
  "wrong",
  "cancelled",
]);
export const missionStatus = pgEnum("mission_status", [
  "draft",
  "offered",
  "accepted",
  "submitted",
  "approved",
  "failed",
  "cancelled",
]);
export const offerStatus = pgEnum("offer_status", [
  "pending",
  "accepted",
  "rejected",
  "cancelled",
]);
export const voteKind = pgEnum("vote_kind", [
  "nominate",
  "save",
  "finale",
  "dilemma",
]);

export const profiles = pgTable("profiles", {
  id: uuid("id").primaryKey(),
  email: text("email").notNull(),
  displayName: text("display_name"),
  avatarPath: text("avatar_path"),
  preferredLocale: text("preferred_locale").notNull().default("fr"),
  ...timestamps,
});

export const organizations = pgTable("organizations", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  defaultLocale: text("default_locale").notNull().default("fr"),
  createdBy: uuid("created_by").references(() => profiles.id),
  ...timestamps,
});

export const organizationMembers = pgTable(
  "organization_members",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    role: memberRole("role").notNull().default("player"),
    createdAt: timestamps.createdAt,
  },
  (table) => [
    uniqueIndex("organization_member_unique").on(
      table.organizationId,
      table.userId,
    ),
  ],
);

export const organizationInvitations = pgTable("organization_invitations", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  gameId: uuid("game_id"),
  email: text("email").notNull(),
  role: memberRole("role").notNull().default("player"),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  invitedBy: uuid("invited_by").references(() => profiles.id),
  createdAt: timestamps.createdAt,
});

export const games = pgTable("games", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  description: text("description"),
  status: gameStatus("status").notNull().default("draft"),
  format: text("format").notNull().default("quick"),
  currencySymbol: text("currency_symbol").notNull().default("¤"),
  startingCash: bigint("starting_cash", { mode: "number" }).notNull().default(1000000),
  backgroundPath: text("background_path"),
  publicCode: text("public_code").notNull().unique(),
  currentRoundId: uuid("current_round_id"),
  settings: jsonb("settings").notNull().default({}),
  startsAt: timestamp("starts_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdBy: uuid("created_by").notNull().references(() => profiles.id),
  ...timestamps,
});

export const gamePlayers = pgTable(
  "game_players",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    gameId: uuid("game_id")
      .notNull()
      .references(() => games.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    isReady: boolean("is_ready").notNull().default(false),
    playStatus: text("play_status").notNull().default("active"),
    joinedAt: timestamp("joined_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex("game_player_unique").on(table.gameId, table.userId)],
);

export const secrets = pgTable("secrets", {
  id: uuid("id").defaultRandom().primaryKey(),
  gameId: uuid("game_id").notNull().references(() => games.id, { onDelete: "cascade" }),
  value: text("value").notNull(),
  status: secretStatus("status").notNull().default("draft"),
  version: integer("version").notNull().default(1),
  lockedAt: timestamp("locked_at", { withTimezone: true }),
  revealedAt: timestamp("revealed_at", { withTimezone: true }),
  replacedBy: uuid("replaced_by").references(() => profiles.id),
  replacementReason: text("replacement_reason"),
  ...timestamps,
});

export const secretHolders = pgTable(
  "secret_holders",
  {
    secretId: uuid("secret_id").notNull().references(() => secrets.id, { onDelete: "cascade" }),
    playerId: uuid("player_id").notNull().references(() => gamePlayers.id, { onDelete: "cascade" }),
  },
  (table) => [primaryKey({ columns: [table.secretId, table.playerId] })],
);

export const hints = pgTable("hints", {
  id: uuid("id").defaultRandom().primaryKey(),
  secretId: uuid("secret_id").notNull().references(() => secrets.id, { onDelete: "cascade" }),
  kind: hintKind("kind").notNull(),
  text: text("text"),
  assetPath: text("asset_path"),
  position: integer("position").notNull(),
  defaultPrice: bigint("default_price", { mode: "number" }).notNull().default(0),
  releasedAt: timestamp("released_at", { withTimezone: true }),
  createdAt: timestamps.createdAt,
}, (table) => [
  check("hint_has_content", sql`${table.text} is not null or ${table.assetPath} is not null`),
  uniqueIndex("hint_secret_position_unique").on(table.secretId, table.position),
]);

export const roundTemplates = pgTable("round_templates", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }),
  key: text("key").notNull(),
  title: jsonb("title").notNull(),
  kind: roundKind("kind").notNull(),
  config: jsonb("config").notNull(),
  isSystem: boolean("is_system").notNull().default(false),
  ...timestamps,
});

export const gameRounds = pgTable("game_rounds", {
  id: uuid("id").defaultRandom().primaryKey(),
  gameId: uuid("game_id").notNull().references(() => games.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  kind: roundKind("kind").notNull(),
  status: roundStatus("status").notNull().default("scheduled"),
  position: integer("position").notNull(),
  config: jsonb("config").notNull(),
  startsAt: timestamp("starts_at", { withTimezone: true }),
  endsAt: timestamp("ends_at", { withTimezone: true }),
  ...timestamps,
}, (table) => [uniqueIndex("game_round_position_unique").on(table.gameId, table.position)]);

export const teams = pgTable("teams", {
  id: uuid("id").defaultRandom().primaryKey(),
  roundId: uuid("round_id").notNull().references(() => gameRounds.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  color: text("color"),
  createdAt: timestamps.createdAt,
});

export const teamMembers = pgTable("team_members", {
  teamId: uuid("team_id").notNull().references(() => teams.id, { onDelete: "cascade" }),
  playerId: uuid("player_id").notNull().references(() => gamePlayers.id, { onDelete: "cascade" }),
  dilemmaChoice: text("dilemma_choice"),
  dilemmaLockedAt: timestamp("dilemma_locked_at", { withTimezone: true }),
}, (table) => [primaryKey({ columns: [table.teamId, table.playerId] })]);

export const wallets = pgTable("wallets", {
  id: uuid("id").defaultRandom().primaryKey(),
  gameId: uuid("game_id").notNull().references(() => games.id, { onDelete: "cascade" }),
  playerId: uuid("player_id").references(() => gamePlayers.id, { onDelete: "cascade" }),
  teamId: uuid("team_id").references(() => teams.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),
  balance: bigint("balance", { mode: "number" }).notNull().default(0),
  createdAt: timestamps.createdAt,
}, (table) => [
  check("wallet_has_single_owner", sql`num_nonnulls(${table.playerId}, ${table.teamId}) <= 1`),
]);

export const ledgerTransactions = pgTable("ledger_transactions", {
  id: uuid("id").defaultRandom().primaryKey(),
  gameId: uuid("game_id").notNull().references(() => games.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  description: text("description"),
  idempotencyKey: text("idempotency_key").notNull().unique(),
  actorUserId: uuid("actor_user_id").references(() => profiles.id),
  reversedTransactionId: uuid("reversed_transaction_id"),
  createdAt: timestamps.createdAt,
});

export const ledgerEntries = pgTable("ledger_entries", {
  id: uuid("id").defaultRandom().primaryKey(),
  transactionId: uuid("transaction_id").notNull().references(() => ledgerTransactions.id),
  walletId: uuid("wallet_id").notNull().references(() => wallets.id),
  amount: bigint("amount", { mode: "number" }).notNull(),
  createdAt: timestamps.createdAt,
});

export const hintGrants = pgTable("hint_grants", {
  id: uuid("id").defaultRandom().primaryKey(),
  hintId: uuid("hint_id").notNull().references(() => hints.id, { onDelete: "cascade" }),
  playerId: uuid("player_id").references(() => gamePlayers.id, { onDelete: "cascade" }),
  teamId: uuid("team_id").references(() => teams.id, { onDelete: "cascade" }),
  scope: knowledgeScope("scope").notNull(),
  source: text("source").notNull(),
  grantedBy: uuid("granted_by").references(() => profiles.id),
  createdAt: timestamps.createdAt,
});

export const hintOffers = pgTable("hint_offers", {
  id: uuid("id").defaultRandom().primaryKey(),
  gameId: uuid("game_id").notNull().references(() => games.id, { onDelete: "cascade" }),
  hintId: uuid("hint_id").notNull().references(() => hints.id),
  sellerPlayerId: uuid("seller_player_id").notNull().references(() => gamePlayers.id),
  buyerPlayerId: uuid("buyer_player_id").notNull().references(() => gamePlayers.id),
  price: bigint("price", { mode: "number" }).notNull(),
  status: offerStatus("status").notNull().default("pending"),
  createdAt: timestamps.createdAt,
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
});

export const accusationBuzzes = pgTable("accusation_buzzes", {
  id: uuid("id").defaultRandom().primaryKey(),
  gameId: uuid("game_id").notNull().references(() => games.id, { onDelete: "cascade" }),
  accuserPlayerId: uuid("accuser_player_id").notNull().references(() => gamePlayers.id),
  targetPlayerId: uuid("target_player_id").notNull().references(() => gamePlayers.id),
  theory: text("theory").notNull(),
  stake: bigint("stake", { mode: "number" }).notNull(),
  transferPercent: integer("transfer_percent").notNull(),
  status: buzzStatus("status").notNull().default("pending"),
  hostNote: text("host_note"),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  ...timestamps,
});

export const hintBuzzes = pgTable("hint_buzzes", {
  id: uuid("id").defaultRandom().primaryKey(),
  gameId: uuid("game_id").notNull().references(() => games.id, { onDelete: "cascade" }),
  buyerPlayerId: uuid("buyer_player_id").notNull().references(() => gamePlayers.id),
  targetPlayerId: uuid("target_player_id").notNull().references(() => gamePlayers.id),
  hintId: uuid("hint_id").references(() => hints.id),
  price: bigint("price", { mode: "number" }).notNull(),
  scope: knowledgeScope("scope").notNull().default("private"),
  createdAt: timestamps.createdAt,
});

export const missions = pgTable("missions", {
  id: uuid("id").defaultRandom().primaryKey(),
  gameId: uuid("game_id").notNull().references(() => games.id, { onDelete: "cascade" }),
  roundId: uuid("round_id").references(() => gameRounds.id, { onDelete: "set null" }),
  title: text("title").notNull(),
  instructions: text("instructions").notNull(),
  visibility: knowledgeScope("visibility").notNull().default("private"),
  reward: bigint("reward", { mode: "number" }).notNull().default(0),
  penalty: bigint("penalty", { mode: "number" }).notNull().default(0),
  status: missionStatus("status").notNull().default("draft"),
  deadline: timestamp("deadline", { withTimezone: true }),
  // Set when the host starts a prepared draft mission. Null while it is still
  // hidden from players.
  startedAt: timestamp("started_at", { withTimezone: true }),
  createdAt: timestamps.createdAt,
});

export const missionAssignments = pgTable("mission_assignments", {
  id: uuid("id").defaultRandom().primaryKey(),
  missionId: uuid("mission_id").notNull().references(() => missions.id, { onDelete: "cascade" }),
  playerId: uuid("player_id").references(() => gamePlayers.id, { onDelete: "cascade" }),
  teamId: uuid("team_id").references(() => teams.id, { onDelete: "cascade" }),
  submittedAt: timestamp("submitted_at", { withTimezone: true }),
  // Set when the assigned player (or a teammate) first opens the started
  // mission. Drives the "new mission" indicator on the player's phone.
  seenAt: timestamp("seen_at", { withTimezone: true }),
  evidencePath: text("evidence_path"),
  validatorComment: text("validator_comment"),
}, (table) => [
  check("mission_assignment_has_owner", sql`num_nonnulls(${table.playerId}, ${table.teamId}) = 1`),
]);

export const houseSecrets = pgTable("house_secrets", {
  id: uuid("id").defaultRandom().primaryKey(),
  gameId: uuid("game_id").notNull().unique().references(() => games.id, { onDelete: "cascade" }),
  answer: text("answer").notNull(),
  mode: text("mode").notNull().default("hybrid"),
  vault: bigint("vault", { mode: "number" }).notNull().default(0),
  attemptCost: bigint("attempt_cost", { mode: "number" }).notNull().default(0),
  revealedAt: timestamp("revealed_at", { withTimezone: true }),
  ...timestamps,
});

export const houseSecretClues = pgTable("house_secret_clues", {
  id: uuid("id").defaultRandom().primaryKey(),
  houseSecretId: uuid("house_secret_id").notNull().references(() => houseSecrets.id, { onDelete: "cascade" }),
  chapter: integer("chapter").notNull().default(1),
  text: text("text"),
  assetPath: text("asset_path"),
  isDecoy: boolean("is_decoy").notNull().default(false),
  releasedAt: timestamp("released_at", { withTimezone: true }),
  createdAt: timestamps.createdAt,
});

export const houseSecretSubmissions = pgTable("house_secret_submissions", {
  id: uuid("id").defaultRandom().primaryKey(),
  houseSecretId: uuid("house_secret_id").notNull().references(() => houseSecrets.id, { onDelete: "cascade" }),
  playerId: uuid("player_id").notNull().references(() => gamePlayers.id),
  theory: text("theory").notNull(),
  result: text("result").notNull().default("pending"),
  submittedAt: timestamp("submitted_at", { withTimezone: true }).defaultNow().notNull(),
});

export const gameEvents = pgTable("game_events", {
  id: uuid("id").defaultRandom().primaryKey(),
  gameId: uuid("game_id").notNull().references(() => games.id, { onDelete: "cascade" }),
  roundId: uuid("round_id").references(() => gameRounds.id),
  kind: text("kind").notNull(),
  title: text("title").notNull(),
  body: text("body"),
  payload: jsonb("payload").notNull().default({}),
  isPublic: boolean("is_public").notNull().default(false),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  createdAt: timestamps.createdAt,
});

export const displayCues = pgTable("display_cues", {
  id: uuid("id").defaultRandom().primaryKey(),
  gameId: uuid("game_id").notNull().references(() => games.id, { onDelete: "cascade" }),
  revision: uuid("revision").defaultRandom().notNull(),
  createdAt: timestamps.createdAt,
});

export const playerPowers = pgTable("player_powers", {
  id: uuid("id").defaultRandom().primaryKey(),
  playerId: uuid("player_id").notNull().references(() => gamePlayers.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),
  config: jsonb("config").notNull().default({}),
  usedAt: timestamp("used_at", { withTimezone: true }),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  createdAt: timestamps.createdAt,
});

export const ballots = pgTable("ballots", {
  id: uuid("id").defaultRandom().primaryKey(),
  roundId: uuid("round_id").notNull().references(() => gameRounds.id, { onDelete: "cascade" }),
  voterPlayerId: uuid("voter_player_id").notNull().references(() => gamePlayers.id),
  targetPlayerId: uuid("target_player_id").references(() => gamePlayers.id),
  kind: voteKind("kind").notNull(),
  weight: integer("weight").notNull().default(1),
  lockedAt: timestamp("locked_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [uniqueIndex("ballot_unique").on(table.roundId, table.voterPlayerId, table.kind)]);

export const theoryNotes = pgTable("theory_notes", {
  id: uuid("id").defaultRandom().primaryKey(),
  gameId: uuid("game_id").notNull().references(() => games.id, { onDelete: "cascade" }),
  playerId: uuid("player_id").notNull().references(() => gamePlayers.id, { onDelete: "cascade" }),
  targetPlayerId: uuid("target_player_id").references(() => gamePlayers.id),
  targetHouseSecretId: uuid("target_house_secret_id").references(() => houseSecrets.id, { onDelete: "cascade" }),
  body: text("body").notNull(),
  ...timestamps,
});

export const auditEvents = pgTable("audit_events", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  gameId: uuid("game_id").references(() => games.id, { onDelete: "cascade" }),
  actorUserId: uuid("actor_user_id").references(() => profiles.id),
  action: text("action").notNull(),
  resourceType: text("resource_type").notNull(),
  resourceId: uuid("resource_id"),
  metadata: jsonb("metadata").notNull().default({}),
  createdAt: timestamps.createdAt,
});

// Curated pool of ready-made secrets, chosen by category at game creation so a
// Quick Night can start without every player typing one. Prompt content only —
// readable by any authenticated user, written by the seed / service role.
export const secretBank = pgTable("secret_bank", {
  id: uuid("id").defaultRandom().primaryKey(),
  category: text("category").notNull(),
  locale: text("locale").notNull().default("en"),
  text: text("text").notNull(),
  createdAt: timestamps.createdAt,
}, (table) => [
  uniqueIndex("secret_bank_unique").on(table.category, table.locale, table.text),
]);

// One player's answer to a broadcast dilemma (option_1 / option_2). The host
// reads every row for their game; a player reads and writes only their own.
export const gameEventResponses = pgTable("game_event_responses", {
  id: uuid("id").defaultRandom().primaryKey(),
  gameEventId: uuid("game_event_id").notNull().references(() => gameEvents.id, { onDelete: "cascade" }),
  playerId: uuid("player_id").notNull().references(() => gamePlayers.id, { onDelete: "cascade" }),
  choice: text("choice").notNull(),
  ...timestamps,
}, (table) => [
  uniqueIndex("game_event_responses_unique").on(table.gameEventId, table.playerId),
  check("game_event_response_choice", sql`${table.choice} in ('option_1', 'option_2')`),
]);
