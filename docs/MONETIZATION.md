# Monetization strategy

Final plan for pricing, tier gating, and abuse monitoring. No advertising.

## Model in one line

**Free** is the complete game for a small group (1 host + 5 players). **Pro** is
the same game for a party (up to 50 players) plus the wider content and advanced
modes. Only the host ever pays; players always join free by code, no account
required.

## Tiers and price

| SKU | Price | Grants | Term |
| --- | --- | --- | --- |
| **Free** | $0 | 1 host + 5 players, all core mechanics | never expires |
| **Pro — 3 games** | **$5** | 3 Pro game credits (up to 50 players, every Pro feature) | credits expire **1 year** after purchase |
| **Pro — Unlimited** | **$10** | unlimited Pro games for the term | access ends **1 year** after purchase |

- Both Pro SKUs are **one-time purchases**, not subscriptions. They lapse after
  12 months; the host buys again to continue.
- The account reverts to Free on expiry — saved history and recaps stay
  readable; new games fall back to the 5-player / Free feature set.
- **First Pro game is free**, once per account, so a host can run a full
  50-player game with shared secrets and image decks before paying.

## What counts as "a game"

- A credit is consumed — and the game-count for monitoring is incremented —
  **when the host starts round 1**, not when the lobby is created.
- A game that ends with **0 completed rounds** refunds the credit and does not
  count.
- Only the host's plan matters. Player devices never consume anything.

## Feature matrix

| Capability | Free (1 host + 5) | Pro (up to 50) |
| --- | --- | --- |
| Players per game | **5** | **50** |
| Languages FR / EN | ✅ | ✅ |
| Email + Google sign-in, invitations | ✅ | ✅ |
| Realtime player UI, host control room, TV dashboard | ✅ | ✅ |
| Dashboard themes — full set | ✅ | ✅ |
| **Secrets — private** | ✅ | ✅ |
| **Secrets — shared** | ❌ | ✅ |
| **Host replaces / swaps a secret** (+ replacement audit) | ❌ | ✅ |
| **Hints — text decks** | ✅ | ✅ |
| **Hints — image decks** | ❌ | ✅ |
| Hint economy — free sharing, paid hint buzzes, fixed-price sales | ✅ same for all | ✅ same for all |
| Accusation buzzes | ✅ | ✅ |
| Wallets + immutable balanced ledger | ✅ | ✅ |
| **Missions — private** | ✅ | ✅ |
| **Missions — team & public** | ❌ | ✅ |
| **Max missions per game** | **2** | unlimited |
| **House Secret** — clues, theories, attempt costs, vault | ✅ | ✅ |
| Finale scoring — custom templates | ✅ | ✅ |
| Game history + post-game recap | ✅ | ✅ |
| **Share / Steal team dilemmas** | ❌ | ✅ |
| **Events, powers, private nominations, elimination rounds** | ❌ | ✅ |
| **Round schedules** | Quick Night | + Weekend, + Custom |

Pro sells three things: **scale** (50 players), **content breadth** (shared
secrets, secret replacement, image decks, team/public missions, unlimited
missions), and **advanced modes** (Share/Steal, events, powers, elimination,
Weekend/Custom schedules). Everything that makes the core night good — private
secrets, House Secret, custom scoring, history, full dashboard, the whole hint
economy — is in Free.

## Account-sharing monitoring

Applies to **Pro — Unlimited** (the only plan that can reach the thresholds).

- When an Unlimited account **starts its 10th game**, and again at its **20th
  game**, within the active 12-month term, the system sends an alert to the
  **project partner who owns the Vercel/Supabase account** (see
  `PRODUCTION_CHECKLIST.md`).
- The alert includes: account id and email, running game count, distinct player
  rosters across those games, distinct device / IP fingerprints, geographic
  spread, and timestamps.
- It is a **manual review checkpoint, not an automatic block.** The partner
  decides whether the pattern looks like one household / friend group (fine) or a
  resold host account serving unrelated groups (not fine).
- Implementation note: increment the counter in the same transaction that starts
  round 1; fire the alert from a Postgres trigger / edge function on counter
  values 10 and 20 so it survives client crashes.

## Unit economics

Marginal infrastructure cost (past Supabase Pro included tiers; Realtime messages
dominate):

| | Per game |
| --- | --- |
| Free game (1 host + 5 ≈ 7 connections) | ~$0.01 |
| Pro game (up to 50 ≈ 52 connections, ~50–80k messages) | ~$0.10 – $0.25 |

Fixed baseline: Vercel Pro $20/mo + Supabase Pro $25/mo = **~$45/mo**.

| SKU | Gross | Stripe fee | Net | Infra | Contribution |
| --- | --- | --- | --- | --- | --- |
| Pro — 3 games ($5) | $5.00 | ~$0.44 | ~$4.56 | ~$0.30–0.75 (3 games) | **~$3.80–4.25 / pack** |
| Pro — Unlimited ($10) | $10.00 | ~$0.59 | ~$9.41 | ~$0.15 × games played | **positive to ~50–60 games/yr, thin above** |

**Break-even on the $45/mo baseline:** ~5 Unlimited passes **or** ~10 three-packs
per month.

The Unlimited pass is deliberately cheap — an impulse price that removes the
subscription objection and renews attention every year. The 10th / 20th-game
alerts are what protect its margin: a genuine heavy household is left alone; a
shared or resold account gets caught at review.

## Growth logic

1. A Free night for 6 people is a real, complete game → word of mouth.
2. Players who joined by code become hosts later.
3. Conversion triggers: the group outgrows 6, or the host wants shared secrets,
   image decks, team missions, Weekend mode, or a big party.
4. $5 and $10 are one-tap decisions; the 1-year term brings buyers back.

## Reserved for later — do not build yet

An **Events / Organizer tier**: recurring 50-player facilitated games, multi-host
orgs, invoicing, team-building packaging. The 20th-game review is the lead signal
for who belongs here. Keep the pricing lane open; ship it only once the core
Free → Pro loop is proven.

## Open decisions

These were not called out explicitly and are set by inference — flip any of them
in one line:

- **Round schedules** gated as Free = Quick Night, Pro = + Weekend + Custom.
- **Share / Steal dilemmas** placed in Pro (ties to team play).
- **Events, powers, private nominations, elimination rounds** placed in Pro
  (advanced optional modules).
