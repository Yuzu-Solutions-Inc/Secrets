# Billing setup (Stripe + Free/Pro paywall)

The plan and feature split are in [`MONETIZATION.md`](./MONETIZATION.md). This file
is the operational checklist to make it run.

## What ships in the repo

- `supabase/migrations/20260914090000_billing_and_paywall.sql` — `entitlements`,
  `purchases`, `billing_events`, `billing_review_queue`, the `create_game()` RPC,
  credit consume/refund in `host_transition()`, the player-cap trigger, tier
  guards on the Pro-only RPCs, and a Free entitlement row for every user.
- `src/lib/billing/*` — pure tier logic (`plan.ts`), Stripe client (`stripe.ts`),
  entitlement reader (`entitlement.ts`), server-action guards (`guard.ts`).
- `src/app/actions/billing.ts` — `startCheckout` (Stripe Checkout redirect).
- `src/app/api/stripe/webhook/route.ts` — fulfilment webhook.
- `src/app/[locale]/(app)/billing/*` — plans page + success page.

## One-time Stripe dashboard setup (account owner)

Do this in **Test mode** first, then repeat in **Live mode** — the ids differ.

1. **Products & prices** (Products → Add product). Create two, each a **one-time**
   price (not recurring):
   | Product | Price | SKU it maps to |
   | --- | --- | --- |
   | Secrets — 3 Pro games | $5.00 USD one-time | `pro_pack_3` |
   | Secrets — Pro Unlimited (1 year) | $10.00 USD one-time | `pro_unlimited` |
   Copy each **Price ID** (`price_…`).
2. **Webhook** (Developers → Webhooks → Add endpoint):
   - URL: `https://<your-domain>/api/stripe/webhook`
   - Events: `checkout.session.completed`, `checkout.session.async_payment_succeeded`
   - Copy the **Signing secret** (`whsec_…`).
3. **API key**: Developers → API keys → copy the **Secret key** (`sk_test_…` / `sk_live_…`).

## Environment variables

Set these in the Vercel project (Production + Preview) and in local `.env.local`:

```
STRIPE_SECRET_KEY=sk_test_...            # sk_live_... in production
STRIPE_WEBHOOK_SECRET=whsec_...          # the endpoint's signing secret
STRIPE_PRICE_PRO_PACK=price_...          # pro_pack_3 price id
STRIPE_PRICE_PRO_UNLIMITED=price_...     # pro_unlimited price id
BILLING_ALERT_WEBHOOK_URL=               # optional Slack/Discord incoming webhook
```

`SUPABASE_SECRET_KEY` (already required) is what the webhook uses to call
`apply_purchase` — no new Supabase key needed.

## Apply the migration

> **Not yet.** `20260914090000_billing_and_paywall.sql` carries a HOLD header and
> must **not** be pushed to the live Supabase project until billing goes live.
> The branch is not deployed and CI only runs it against an ephemeral local
> database, so committing it changes nothing in production.

When billing is ready:

- Local: `supabase db reset` (or `supabase migration up`).
- Production: `supabase db push` against the project — the Vercel/Supabase account
  is owned by the project partner (see `PRODUCTION_CHECKLIST.md`).

The migration is deliberately non-blocking if it lands early: every tier guard
only trips on `settings->>'tier' = 'free'`, and existing games are grandfathered
as Pro with `proGameSource` pre-set so no host is ever charged for a pre-billing
game.

## Local end-to-end test

```bash
# 1. forward webhooks to the dev server
stripe listen --forward-to localhost:3000/api/stripe/webhook
# ^ prints a whsec_... — put it in .env.local as STRIPE_WEBHOOK_SECRET

# 2. run the app
npm run dev

# 3. in the app: sign in -> /en/billing -> "Buy 3 games"
#    pay with test card 4242 4242 4242 4242, any future date, any CVC
```

`stripe listen` will show `checkout.session.completed` → the webhook calls
`apply_purchase` → `/en/billing` shows `3 Pro games left` and an expiry ~1 year out.

You can also drive it headless:
`stripe trigger checkout.session.completed` (won't carry our metadata, so it is
ignored — use the real Checkout flow to exercise fulfilment).

## How entitlements are spent

- A game created with tier **Pro** does not spend anything until the host starts
  round 1 (`host_transition` → `next_round`). At that point `consume_pro_game_start`
  charges, in order: the **free trial** (once per account) → **Unlimited** (no
  balance change) → a **pack credit**.
- Completing a Pro-pack game that never ran a round refunds the credit
  (`refund_pro_game`).
- **Abandoned** Pro-pack games (never completed) are *not* auto-refunded. The
  owner can refund manually: find the row in `purchases` / the game in `games`
  (`settings->>'creditConsumed' = 'true'`, status not `completed`) and
  `update public.entitlements set pro_credits = pro_credits + 1 where user_id = …`.

## Account-sharing review

When a Pro-Unlimited host starts their **10th** and **20th** game, a row is
inserted into `public.billing_review_queue` (and, if `BILLING_ALERT_WEBHOOK_URL`
is set, a best-effort POST fires). Review in Supabase Studio:

```sql
select q.*, p.email
from public.billing_review_queue q
join public.profiles p on p.id = q.user_id
where q.resolved_at is null
order by q.created_at desc;
```

Set `resolved_at = now()` once checked.

## Going live

- [ ] Repeat the Stripe dashboard setup in Live mode; swap the 4 env vars in Vercel.
- [ ] Confirm the live webhook endpoint shows successful `200`s after a real $5 test purchase (refund it afterwards).
- [ ] Confirm `docs/PRODUCTION_CHECKLIST.md` billing items are ticked.
