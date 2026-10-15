# Postage go-live runbook

How we move from free test labels (Pitney Bowes sandbox) to real postage.
Written 2026-10-14 for Claude and the owner. No keys, IDs or addresses in
this file, ever: names of variables only.

## Where we are

- The code buys USPS labels through Shipping 360 (`pb-client.js`,
  `postage.js`). It is **sandbox by default**. Real postage needs both
  `PB_ENV=production` **and** `PB_LIVE_OK=yes`, so nothing real can be bought
  by accident.
- Rollout is gated by `PB_ACCESS`: `owner` (default) → `pilot` (owner +
  `PB_PILOT_EMAILS`) → `all`.
- Sellers prepay a balance through Stripe Checkout; each label draws it down
  (`tcgss_postage_ledger`). Every label is saved in `tcgss_postage_labels`.
- Fees today: letters 15¢ on Free and Base, 12¢ on Premium, 10¢ on Pro
  (decided Oct 14, `LETTER_FEE_BY_PLAN`); Ground Advantage 50¢ for everyone.
  `PB_FEE_LETTER` / `PB_FEE_GROUND` override a fee for every plan. Revisit
  after Pitney Bowes' rate sheet.

## Ask Pitney Bowes on the call

Each answer maps to a code or config change, so write them down:

| Ask | If the answer is... | We do |
|---|---|---|
| How do we get production access, and how long? | Keys on our existing account | Owner pastes the production Client ID/Secret into Railway (`PB_API_KEY`, `PB_API_SECRET`) |
| Is a Shipper/Merchant ID or partner header required in production? | Yes | Add an env var and send it as a header in `pb-client.js` (partner id already supported: `PB_PARTNER_ID`) |
| Which company holds the account and signs? | The family corporation, signed by its officer | The officer signs; the owner is the day-to-day contact |
| How is postage paid (card, ACH, funded balance)? | Any | The owner and the corporation's officer set it up in the PB portal; never in chat |
| Our per-label cost for letters and Ground Advantage, and tiers | Numbers | Update fees and `docs/pricing-plan.md` (decision C6) |
| Does the production letter label carry our Mailer ID or theirs? | Either | Note it; IMb tracking (A11) only matters if ours |
| Refunds: package labels yes, letters no (USPS rule)? | Confirm | The app already says this on the Refund button; add it to Terms/FAQ (A10) |

## Flip steps (owner approves each money step)

1. The corporation's officer confirms the PB contract and the payment
   method. Claude never signs or pays.
2. Railway variables (owner or Claude via `set-variables`, never list them):
   `PB_API_KEY`, `PB_API_SECRET` = production values. Keep `PB_ACCESS=owner`.
3. Add `PB_ENV=production` but **not** `PB_LIVE_OK` yet. `/api/health`
   should still show `pb_mode: sandbox`.
4. Owner says "go live" in the board inbox. Then set `PB_LIVE_OK=yes`.
   `/api/health` now shows `pb_mode: production`, and balances switch on.
5. Owner adds a small top-up (the $20 minimum), then buys **one real letter**
   to his own address. Check:
   - the label prints and scans as a USPS label;
   - `tcgss_postage_labels` has one row with `mode = 'production'`;
   - the balance dropped by exactly `price` (postage + fee);
   - the charge shows on the PB account.
6. Buy and refund one **Ground Advantage** label (cancel works for packages,
   not letters). Check the balance is credited and PB shows the refund
   request.
7. Pilot: `PB_ACCESS=pilot`, `PB_PILOT_EMAILS=<Rob's login email>`. Watch the
   first week daily (SQL below).
8. Everyone: Claude first updates Terms, Support and FAQ (task A10), then
   `PB_ACCESS=all`.

## Daily check during the pilot

```sql
-- labels, postage cost and our fees by mode and service
select mode, service, status, count(*) labels,
       sum(amount) postage, sum(fee) fees, sum(price) charged
from tcgss_postage_labels group by 1,2,3 order by 1,2,3;

-- money held for sellers (what we owe back if everyone left)
select sum(cents)/100.0 as held_dollars from tcgss_postage_ledger;
```

Weekly: compare `sum(amount)` (postage we paid) with the PB statement. They
should match to the cent. Refunded letters will never match: letter postage
is not refundable.

## Rollback

Remove `PB_LIVE_OK` (or set it to anything but `yes`): the app returns to
sandbox at once. Labels already bought stay valid; package labels can still
be refunded from the label list; seller balances are untouched.

## After the call

Claude turns the answers above into: a PR with any header/env changes, the
fee update, the Terms/FAQ edits (A10), and an updated board with exact steps
for the owner. Anything that moves money waits for the owner's "go".
