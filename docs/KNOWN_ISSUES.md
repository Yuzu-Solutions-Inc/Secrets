# Known issues

## 1. RLS policies recurse on direct authenticated SELECT

**Status:** open · **Severity:** high (security model) · **Surfaced by:** CI `db-tests`

### Symptom

Running the pgTAP suites against a fresh database (`supabase db start` +
`supabase test db`) fails immediately:

```
ERROR: infinite recursion detected in policy for relation "secrets"
ERROR: infinite recursion detected in policy for relation "missions"
```

Both `supabase/tests/secrets_rls.sql` (pre-existing) and
`supabase/tests/knowledge_boundaries.sql` (new) reproduce it. In CI the
`supabase test db` step is marked `continue-on-error: true`, so the `db-tests`
job reports the failure in its logs but does not block the PR until this is
fixed.

### Root cause

Policies in `supabase/migrations/20260908034241_secrets_security_and_functions.sql`
contain inline `EXISTS (SELECT ... FROM <another RLS table> ...)` where that other
table's policy queries the first table back:

| Policy | Subquery on | …whose policy queries back |
| --- | --- | --- |
| `secrets_scoped_select` | `secret_holders` | `secrets` |
| `holders_scoped_select` | `secrets` | `secret_holders` |
| `missions_scoped_select` | `mission_assignments` | `missions` |
| `mission_assignments_scoped_select` | `missions` | `missions` |
| `hints_scoped_select` | `secrets`, `hint_grants` | `hints` |
| `teams_game_select` | `game_rounds` | (ok today, same shape) |

The `is_org_*` / `is_game_*` helpers avoid recursion because they are
`SECURITY DEFINER` with `SET search_path = ''`, so they never re-enter RLS. The
inline cross-table `EXISTS` subqueries do re-enter it.

### Why production still serves games

Application reads mostly go through `SECURITY DEFINER` RPCs
(`public_game_dashboard`, `house_secret_board`, the `*_action` functions), which
bypass RLS entirely. The recursive path is the **direct** PostgREST / authenticated
`SELECT` — precisely what the security model claims to protect, and precisely what
the pgTAP suites exercise.

### Fix direction

Mirror the existing helper pattern. Add `SECURITY DEFINER` functions such as:

- `public.is_secret_holder(p_secret_id uuid)`
- `public.is_mission_participant(p_mission_id uuid)`
- `public.can_read_hint(p_hint_id uuid)`

…and rewrite `secrets_scoped_select`, `holders_scoped_select`,
`hints_scoped_select`, `grants_scoped_select`, `missions_scoped_select`,
`mission_assignments_scoped_select` (and any peers) to call the helpers instead of
inline `EXISTS` on an RLS-protected table. Ship as a new
`supabase/migrations/*.sql`.

**Done when:** `supabase test db` passes both suites in CI, `continue-on-error` is
removed from the `db-tests` job, and production policies are reconciled with the
migration file (capture current prod state first — see
[`MIGRATIONS.md`](./MIGRATIONS.md)).

## 2. Production grants not captured in migrations

`SELECT` on `public.games` is revoked from the `anon` role in production, but no
migration performs that revoke. `supabase db push` against an empty database will
not reproduce production's grant state. Capture it into a migration before
relying on a from-scratch rebuild. See [`MIGRATIONS.md`](./MIGRATIONS.md).
