# Pricing plan v2 (draft for the owner's decision)

Claude, 2026-10-06. Status: **plan only.** Nothing here is built, priced in
Stripe, or announced until the owner says go. Owner decisions so far are
marked ✅; Claude's pushback is marked ⚠️.

## The plans

Four plans on the price page. Enterprise is a "talk to us" link under them,
with **no price** ✅.

| | Free | Base | Premium | Pro (new) |
|---|---|---|---|---|
| Price | $0 | $2.99/mo · $29/yr | **$6.99/mo · $69/yr** (new customers) | **$14.99/mo · $149/yr** |
| Labels a month | 10 | 500 | **1,000** ✅ | Unlimited |
| Postage labels | **10 a month to try it** ✅ | Unlimited | Unlimited | Unlimited |
| Our fee per letter | $0.15 | $0.15 | $0.12 | $0.10 |
| Our fee per package | $0.60 | $0.60 | $0.45 | $0.30 |
| Paste addresses, Design Studio | – | – | ✓ | ✓ |
| Pro extras (below) | – | – | – | ✓ |

Fees are on top of postage at cost. ✅ The owner approved these amounts.

### Why these fees: at least $0.10 kept on every label
Our costs per label are Pitney Bowes' $0.05 (only after 3,000 labels a
month) plus the payment fee on the top-up (cards ≈3%, bank 0.8%). Working
backwards from "keep $0.10 after a card top-up":
- A letter (≈$0.78 postage) needs a fee of at least **$0.18** (superseded:
  the owner chose a 5–10¢ minimum on letters, see below).
- A package (≈$4.50 postage) needs a fee of at least **$0.30**.

Pro sits exactly on that floor, and every other plan keeps more. Bank
top-ups keep about $0.02–0.12 more per label.

#### ⚠️ Rob's feedback (Oct 6): the letter price
Rob asked whether we sell at the $0.78 metered rate or the $0.82 stamp
price, and said sellers won't switch if the total isn't competitive with
services that offer $0.78. A tracked letter today would be $0.78 + $0.21 fee
= $0.99. Options for the owner:
- **A. Keep $0.21** (total $0.99). That's still below the stamp + tracking
  combos, but it reads as "more than a stamp".
- **B. Letters at cost + $0.04–0.08** (total $0.82–0.86, "stamp price, with
  tracking"). We make our money on the subscription and package fees
  instead. That breaks the $0.10/label floor on letters.
- **C. Letters at cost for Premium and Pro only** (the plan is the reason
  to pay), with the $0.21 fee on Free and Base.
**✅ Decided Oct 6 (owner): keep 5–10¢ on every label.** Letter fees are
now Free/Base $0.15, Premium $0.12, Pro $0.10, so a 1 oz letter costs about
$0.88–0.93. After card fees (about 4¢), that keeps 6–11¢ per letter.
Past 3,000 labels a month, Pitney Bowes' 5¢ cuts that to 1–6¢: steer
heavy users to bank top-ups (0.8%), and revisit the fee then.
Letters get USPS in-transit scans but **no delivery scan**. Sell them as
"stamp price + tracking scans", never as "delivery confirmation". Packages
(Ground Advantage) include full tracking and delivery confirmation.

## Existing customers
- **Current Premium subscribers keep $5.99 and unlimited labels.** Their
  price and limit don't change. They get their own short email saying so.
- Current Base subscribers keep $2.99 and 500 labels.
- In Stripe this means creating *new* prices for Premium. The old $5.99
  price is never edited, so existing subscriptions can't move.

### Free plan postage: 10 labels a month ✅ (with guardrails)
⚠️ A free account plus a stolen card is the classic postage-fraud pattern.
Guardrails that keep the trial but stop that:
- 10 postage labels a month, with the same fee as Base.
- First top-up is at most $25 on a free account.
- Package labels for free accounts only after one letter label has been
  bought, or after a bank top-up. Cheap letters let people try it, and
  expensive labels need some history first.
- Refunds go back to the balance, never to a card. That's already how it
  works.

## Pro extras: small, genuinely useful, new
Ranked by value per hour of build:
1. **Lowest postage fees.** The pitch: "Pays for itself at about 50
   packages a month."
2. **Auto-reload:** "add $50 when my balance drops under $10." No failed
   batches mid-shipping-day.
3. **One-click "mark shipped" file:** after buying postage, one click makes
   the TCGplayer tracking upload for the whole batch.
4. **Monthly postage report** (a PDF or CSV, plus a short email on the 1st):
   labels by service, postage spend, and average cost per order. Useful at
   tax time.
5. **Saved batches:** reopen last week's batch to reprint or check what
   shipped, for 90 days.
6. **Multiple stores:** separate return addresses and slip styles per
   store, picked per batch.
7. **Priority support** (reply within 1 business day), and early access to
   new features.
8. **Duplicate-order guard:** warns if an order number was already printed
   in the last 30 days. It saves double-shipping, which every heavy seller
   has done at least once.

Building 1–4 and 8 is roughly a week. 5–6 come next.

## Postage packs
✅ The owner dropped separate packs. Top-ups stay as they are ($20/$50/$100
or any custom amount). The only twist: **bank top-ups of $250+ get a small
bonus (+2%)**, paid for by the card fees we don't pay. No monthly postage
subscriptions, because unused credit piling up means refunds and support
work.

## Annual
- Yearly plans give about 2 months free (prices above).
- One add-on at checkout, not a separate plan: **Pro yearly + $50 postage
  credit for $189** (about $10 off).

## Price page layout
1. A Monthly / Yearly switch, then 4 plan cards. Pro is highlighted as
   "Best for 300+ orders a month".
2. "Postage": a small table of the fee per label on each plan, how top-ups
   work, and "your first 10 labels on us to try it" (wording TBD: the
   postage itself isn't free, the plan access is).
3. "Running a shop? Enterprise: talk to us." No price.

## The announcement email ⚠️
The owner wants one big email to all accounts today. Claude's
recommendations:
- **Yes to one email to all 20 accounts**, framed as a product update ("what
  we've shipped, what's coming"), with an unsubscribe link and the mailing
  address. The address is required because it also promotes paid plans.
- **Don't promise postage prices or dates yet.** Pitney Bowes hasn't
  approved production. Say "coming soon, under $1 tracked letters is the
  goal", not "$0.99 on Nov 1". A broken promise in a launch email costs more
  than it earns.
- **Don't announce the Premium cap until the new price page ships.**
  Existing Premium customers are unaffected anyway. They get a short "your
  plan doesn't change" note *when* the change ships, not before. That avoids
  worrying them about something that may still change.
- Drafts are in Gmail for review; nothing is sent.

## Stripe ⚠️
The Stripe connector only reaches the **live** account. There's no test
mode. To keep "nothing live", Claude will not create products or prices
through it. Options:
1. (Recommended) In Stripe, turn on a **Sandbox** (Dashboard → account menu
   → Sandboxes → Create) and connect it in claude.ai → Connectors. Claude
   builds everything there.
2. Or, when the owner says go: create the new prices in live with
   `active: false`. They exist but nobody can buy them until switched on.

## Build order once approved
1. Pricing config in one place (plans, limits, fees per plan), with tests.
2. Postage fee by plan, and the free-plan guardrails.
3. Premium 1,000 cap for new subscribers only (existing ones grandfathered
   by Stripe price id).
4. The Pro plan in Stripe (sandbox first), checkout, and webhook mapping.
5. Pro extras 1–4 and 8.
6. Price page redesign, behind the owner-only switch, until the owner
   approves it.
