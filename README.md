# Secrets

Secrets is an original, mobile-first party game for a night or weekend of hidden identities, clues, missions, teams and strategic buzzes. A separate fullscreen dashboard turns a TV or laptop into the shared game screen.

This project is inspired by social-deduction reality formats, but it does not include third-party names, logos, music, catchphrases or show assets.

## What is included

- French and English player experiences
- Admin and Player roles with email/password, Google OAuth, reset and hashed invitations
- Quick Night, Weekend and Custom round schedules
- Private or shared secrets with host lock, replacement audit and text/image hint decks
- Accusation buzzes and paid hint buzzes
- Free hint sharing and fixed-price hint sales; no direct cash transfers or player wagers
- Private, team and public missions with host adjudication
- Personal and team wallets backed by an immutable balanced ledger
- Simultaneous Share/Steal team dilemmas with deterministic payouts
- House Secret clues, theories, attempt costs and vault
- Events, powers, private nominations and optional explicit elimination rounds
- Template-controlled finale scoring
- Realtime mobile player UI, host control room and safe public TV dashboard

A zero balance or a revealed secret never removes a player. Only a host-added elimination round can change active-play permission.

## Stack

Next.js 16 App Router, React 19, strict TypeScript, Tailwind CSS v4, next-intl, Supabase Auth/Postgres/Realtime/Storage, Drizzle ORM, TanStack Query, Zod and Playwright.

## Local setup

1. Create a Supabase project.
2. Copy `.env.example` to `.env.local` and fill the values. Never commit this file.
3. Install dependencies:

   ```bash
   npm install
   ```

4. Link the Supabase CLI and apply migrations:

   ```bash
   npx supabase login
   npx supabase link --project-ref YOUR_PROJECT_REF
   npx supabase db push
   ```

5. In Supabase Auth, add local and production callback URLs ending in `/auth/callback`.
6. Enable Google in Supabase Auth if Google login is wanted.
7. Start the app:

   ```bash
   npm run dev
   ```

Open `http://localhost:3000/fr` or `/en`.

## Environment variables

- `NEXT_PUBLIC_SUPABASE_URL`: public project URL
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`: browser-safe publishable key
- `SUPABASE_SECRET_KEY`: server-only key used by authenticated asset relays
- `DATABASE_URL`: direct Postgres URL for Drizzle tooling
- `NEXT_PUBLIC_APP_URL`: canonical app origin

`SUPABASE_SECRET_KEY` and `DATABASE_URL` must never use a `NEXT_PUBLIC_` prefix.

## Security model

Every exposed application table has RLS enabled. Players can read only games they joined and knowledge explicitly scoped to them, their team or the public game. Locked secrets, ungranted hints, private missions, theory notes, dilemma choices and ballots are excluded from other players’ payloads.

Secret hint images live in the private `game-assets` bucket. An authenticated server route first checks hint-table RLS, then streams the object. The public dashboard receives only a purpose-built, security-definer projection; it cannot query private tables.

All money changes run through transactional database functions and create balanced ledger entries. Host corrections and reversals require reasons and remain auditable.

## Game formats

### Quick Night

Team investigation → Solo investigation → House Secret → Finale.

### Weekend

Team investigation → Surprise event → Solo investigation → House Secret → Team investigation → Nominations → Solo investigation → Finale.

### Custom

Add, reorder and duplicate team, solo, House Secret, event, nomination, elimination and finale rounds. Active round configuration is stored as a snapshot, so later template edits do not change a game in progress.

### Team dilemma defaults

- All share: 100% split equally
- One steals: 60% to the stealer, 40% among sharers
- Multiple steal: 30% among stealers, 70% among sharers
- All steal: 50% distributed, 50% remains banked

All amounts use integer minor units; stable player ordering resolves remainder cents.

## Verification

```bash
npm run lint
npm run typecheck
npm test
npm run build
npm run test:e2e
npx supabase test db
```

Unit coverage includes dilemma matrices, accusation economics, winner formulas, rounding and i18n parity. `supabase/tests/` exercises Admin/Player knowledge boundaries for secrets, hints, missions, dilemma choices, theory notes, House Secret theories, ballots and the money ledger.

### Continuous integration

`.github/workflows/ci.yml` runs on every pull request and on pushes to `main`:

- **verify** — `npm run typecheck`, `npm test`, `npm run build`
- **db-tests** — `supabase db start` (applies all migrations + seed) then `supabase test db` (pgTAP)
- **e2e** — Playwright specs that do not need authentication, across phone, laptop and 16:9 viewports

Merge through pull requests so these checks run; see [`docs/MIGRATIONS.md`](docs/MIGRATIONS.md) for the schema-change workflow.

## Deployment

Vercel and Supabase for this project are managed on a separate partner-owned
account. The full go-live checklist for that account — advisors, auth redirect
URLs, environment variables, migration verification and a multi-session realtime
rehearsal — is in [`docs/PRODUCTION_CHECKLIST.md`](docs/PRODUCTION_CHECKLIST.md).

The intended free setup is one Supabase Free project and one personal Vercel Hobby project.

1. Confirm Supabase reports a `$0` creation cost before creating the project.
2. Apply migrations and copy the project values into Vercel environment variables.
3. Import `Yuzu-Solutions-Inc/Secrets` into the personal Vercel account.
4. Add the production origin and callback URL in Supabase Auth.
5. Deploy and rehearse with multiple browser sessions.

Free Supabase projects may pause after inactivity. Restore the project in Supabase, then smoke-test login and Realtime before a game night.

## License

MIT
# Secrets
A mobile-first realtime party game of secrets, clues, missions, and strategy
