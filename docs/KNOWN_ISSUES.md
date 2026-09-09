# Known issues

## 1. RLS policies recurse on direct authenticated SELECT — FIXED

**Status:** fixed in `supabase/migrations/20260909120000_fix_rls_recursion.sql`
· **Severity:** high (security model) · **Surfaced by:** CI `db-tests`

### Symptom

Running the pgTAP suites against a fresh database (`supabase db start` +
`supabase test db`) failed immediately:

```
ERROR: infinite recursion detected in policy for relation "secrets"
ERROR: infinite recursion detected in policy for relation "missions"
```

The player game page (`src/app/[locale]/(app)/games/[id]/page.tsx`) reads
`mission_assignments`, `hint_grants`, `team_members` and friends directly as the
authenticated user, so this was a live failure on that path, not just a test
artifact.

### Root cause

Policies in `20260908034241_secrets_security_and_functions.sql` contained an
inline `EXISTS (SELECT ... FROM <another RLS table> ...)` where that other table's
policy queried the first table back:

| Cycle |
| --- |
| `secrets` ↔ `secret_holders` |
| `hints` ↔ `hint_grants` |
| `missions` ↔ `mission_assignments` |

Postgres evaluates the referenced table's RLS mid-policy, re-enters the first
policy and aborts. The `is_org_*` / `is_game_*` helpers avoid this because they
are `SECURITY DEFINER` with `SET search_path = ''`, so their internal reads
bypass RLS.

### Fix

`20260909120000_fix_rls_recursion.sql` adds `SECURITY DEFINER` helpers for every
cross-table check that was inline (`is_secret_holder`, `can_admin_secret`,
`owns_game_player`, `is_on_team`, `can_admin_hint`, `plays_hint_game`,
`can_view_hint`, `is_mission_participant`, `can_admin_mission`) and recreates the
8 affected policies to call them. Each helper is a literal translation of the
predicate it replaced, so access semantics are unchanged. Verified by
`supabase/tests/secrets_rls.sql` and `supabase/tests/knowledge_boundaries.sql`
in the `db-tests` CI job (now blocking).

### Still to do (production)

The migration fixes a fresh database and any environment it is applied to. If
production's policies were hand-patched in the dashboard, apply this migration
there and confirm `secrets_scoped_select` / `missions_scoped_select` etc. match
the file. See item 2.

## 2. Production grants / policies not captured in migrations

**Status:** open · needs production database access (partner-owned account)

`SELECT` on `public.games` is revoked from the `anon` role in production, but no
migration performs that revoke — so `supabase db push` against an empty database
does not reproduce production's grant state, and there may be other hand-applied
differences (grants, or dashboard-edited policies).

This needs someone with `psql` access to the production database to dump the
current grant and policy state and reconcile it into a migration. It is on the
[`PRODUCTION_CHECKLIST.md`](./PRODUCTION_CHECKLIST.md). Do not guess a grant
matrix blind — e.g. revoking `anon` SELECT on `public.games` would break the
`display_cues_public_select` policy's subquery for anonymous viewers of the
public TV display.
