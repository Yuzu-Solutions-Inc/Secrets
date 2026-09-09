# Database migrations

## Source of truth: Supabase CLI migrations

Every schema change ships as a timestamped SQL file in `supabase/migrations/` and
is applied with `supabase db push`. The files in that folder — in filename order —
are the complete, authoritative history of the database:

| File | What it contains |
| --- | --- |
| `0000_secrets_core.sql` | All base tables, enums, constraints, indexes |
| `0001_mission_team_assignments.sql` | Mission/team assignment follow-up |
| `0002_public_display_cues.sql` | Public display cue table |
| `20260908034241_secrets_security_and_functions.sql` | RLS policies, `is_*` helpers, security-definer money/game functions, triggers, storage policies |

`supabase/seed.sql` loads the built-in system round templates and is idempotent.

## `src/db/schema.ts` is types-only

The Drizzle schema exists so application code gets typed table definitions. It is
**not** wired into the deployment path:

- Do **not** run `drizzle-kit push` — it would diff against the schema and try to
  mutate the database out of band.
- `npm run db:generate` may be used locally to draft DDL, but the generated SQL
  must be reviewed and folded into a hand-written `supabase/migrations/*.sql`
  file (with matching RLS + grants) before it is committed. The `meta/` snapshot
  folder is a Drizzle artifact and is not consulted by `supabase db push`.

When you change `schema.ts`, add the corresponding Supabase migration in the same
commit so the two never drift.

## Known drift to reconcile

The deployed database has at least one hardening step that is **not** in these
migration files: `SELECT` on `public.games` (and likely other tables) is revoked
from the `anon` role in production, but no migration performs that revoke. Before
relying on `supabase db push` to rebuild the database from scratch, capture the
production grant/revoke state into a new migration. See
[`PRODUCTION_CHECKLIST.md`](./PRODUCTION_CHECKLIST.md).

## CI

`.github/workflows/ci.yml` starts a throwaway Postgres with
`supabase db start` (which runs every migration plus the seed) and executes the
pgTAP suites in `supabase/tests/` via `supabase test db`. A migration that does
not apply cleanly, or that breaks an RLS boundary, fails the `db-tests` job.
