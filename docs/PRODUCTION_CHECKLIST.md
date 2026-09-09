# Production checklist

Vercel and Supabase for this project live on a **separate account owned by the
project partner**. The items below need that account's dashboard access; the
app repo and CI cannot do them.

Live URLs: <https://secrets-game.vercel.app> · Supabase project `fqsqeoxkjedftdvajlpx`.

## 1. Supabase — schema and security

- [ ] Confirm every file in `supabase/migrations/` is applied
      (`supabase migration list --linked` shows no pending).
- [ ] Run **Advisors → Security** and **Advisors → Performance** in the Supabase
      dashboard; resolve or record every finding.
- [ ] Capture production grant/revoke state that is missing from migrations
      (at minimum: `SELECT` on `public.games` is revoked from `anon` in prod but
      no migration does this). Add it as a new `supabase/migrations/*.sql` so the
      database can be rebuilt from scratch. See [`MIGRATIONS.md`](./MIGRATIONS.md).
- [ ] Verify the `game-assets` Storage bucket exists, is **private**, and its
      policies match `20260908034241_secrets_security_and_functions.sql`.

## 2. Supabase — auth

- [ ] **Auth → URL Configuration → Redirect URLs** includes
      `https://secrets-game.vercel.app/auth/callback` and every preview origin
      that needs to log in.
- [ ] Site URL is set to `https://secrets-game.vercel.app`.
- [ ] If Google login is used: OAuth client configured and enabled.
- [ ] Password reset and email confirmation templates send and the links land on
      `/auth/callback`.

## 3. Vercel — configuration

- [ ] Environment variables set for Production (and Preview if previews should
      work): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`,
      `SUPABASE_SECRET_KEY`, `DATABASE_URL`, `NEXT_PUBLIC_APP_URL`.
- [ ] `SUPABASE_SECRET_KEY` and `DATABASE_URL` are **not** `NEXT_PUBLIC_` and are
      not exposed to the browser bundle.
- [ ] `NEXT_PUBLIC_APP_URL` is `https://secrets-game.vercel.app`.
- [ ] Production branch is `main`; deploys are green.

## 3b. Billing (Stripe) — see [`BILLING_SETUP.md`](./BILLING_SETUP.md)

- [ ] `20260914090000_billing_and_paywall.sql` applied to production.
- [ ] Live-mode Stripe products/prices created; `STRIPE_PRICE_PRO_PACK` and
      `STRIPE_PRICE_PRO_UNLIMITED` set in Vercel.
- [ ] `STRIPE_SECRET_KEY` (live) and `STRIPE_WEBHOOK_SECRET` set in Vercel;
      optional `BILLING_ALERT_WEBHOOK_URL` set.
- [ ] Live webhook endpoint `…/api/stripe/webhook` created for
      `checkout.session.completed` + `checkout.session.async_payment_succeeded`;
      a real $5 purchase returns `200` and grants 3 credits (then refund it).
- [ ] `billing_review_queue` is visible in Studio and someone owns reviewing it.

## 4. Realtime rehearsal (multi-session)

Run through the full game with at least three browser sessions (one host, two
players, one TV dashboard):

1. Sign up / sign in; host creates an organization and a game.
2. Host invites players; players accept via the invite link and email match.
3. Players submit private secrets; host locks them.
4. Host starts a team round → players see wallets, buy a hint, share/sell a hint.
5. A player raises an accusation buzz with a stake; host rules correct / partial /
   wrong; confirm the ledger transfers and that a revealed secret stops further
   purchases against that player but not their play.
6. Team dilemma: players pick Share/Steal; host settles; confirm payouts match
   `resolveDilemma` and balances never go directly editable.
7. House Secret round: release clues, submit theories, host adjudicates.
8. Nomination round → finale with the template scoring formula; export results.
9. Mid-game: refresh and reconnect each session; confirm realtime state recovers.
10. Open `/<locale>/display/<public_code>` on the TV; confirm it shows only public
    data (no secrets, private missions, or ballots) and updates live.

## 5. Free-tier operations

- [ ] Document who owns billing and the Supabase/Vercel logins.
- [ ] Free Supabase projects pause after inactivity — before a game night,
      restore the project and smoke-test login + realtime.
