# Sub-$1 tracked envelopes: can we sell postage like eBay does?

Research by Claude, 2026-09-30, at the owner's request ("eBay and Etsy get
~97¢ shipping through Pitney Bowes; can we build that for TCGplayer?").
Sources are linked in each section. Prices change, so re-check before
quoting any of this publicly.

## Short answer

- **Yes, we can sell tracked envelope postage from our app for under $1.**
  Pitney Bowes' Shipping API sells USPS First-Class *letter* postage with
  an Intelligent Mail barcode (IMb) for scan tracking. It prints as a 4×6
  label or on a #10 envelope. Cost to us is **$0.78 per 1 oz letter**
  (metered rate). A stamp is $0.82.
- **We can't match eBay's $0.63 at the start.** eBay Standard Envelope is
  a *negotiated* USPS rate that eBay got through its volume. Nobody can
  buy it off the shelf. Getting a rate like that means proving volume
  first (hundreds of thousands of envelopes a month), then negotiating
  with Pitney Bowes or USPS.
- **"Tracked envelopes" alone isn't unique.** TCGTracking gives IMb
  tracking away free on stamped envelopes, and TCGHaulTracker charges
  $9–79/mo for it. What nobody offers TCGplayer sellers is **postage and
  tracking printed in one step, in the same file as the labels and
  slips**. Being *cheaper than a stamp* is the part that would be unique,
  and that only comes with volume.
- **IMb tracking does NOT satisfy TCGplayer's tracking rule** for orders
  of $49.99 and up. Those still need Ground Advantage or better. The IMb
  envelope is for the sub-$50 orders that go out in PWEs today, as proof
  of mailing and delivery scans for missing-package disputes.

## How eBay does it

- **eBay Standard Envelope** covers trading cards, coins and stamps under
  $20. It costs **$0.63 / $0.87 / $1.11** for 1 / 2 / 3 oz and comes with
  scan tracking and up to $20 of protection. Labels are bought in eBay
  and powered by Pitney Bowes.
  ([ship24](https://www.ship24.com/shops/ebay-tracking/ebay-standard-envelope),
  [eBay announcement](https://community.ebay.com/t5/Announcements/We-re-expanding-the-eBay-standard-envelope-shipping-service-to/ba-p/31822590),
  [terms](https://pages.ebay.com/sell/standarddelivery/termsofservice.html))
- It's cheaper than a stamp because **eBay negotiated a special USPS rate**
  for these items. That rate belongs to eBay's program, and eBay orders
  only.
  ([eBay community](https://community.ebay.com/t5/Shipping/Cheapest-way-to-ship-small-light-envelope/td-p/34295691/),
  [eCommerceBytes](https://www.ecommercebytes.com/2023/01/10/ebay-announces-new-rates-for-its-standard-envelope-shipping-option/))
- **TCGplayer already uses Pitney Bowes for its own Direct orders**:
  under-$50 Direct orders get a PB tracking code that doesn't show on
  USPS.com. So TCGplayer could build its own "standard envelope" for
  marketplace sellers someday. That's the biggest competitive risk to
  this idea. ([TCGplayer help](https://help.tcgplayer.com/hc/en-us/articles/201996857-Buying-from-TCGplayer-Direct))

## What we can buy today

| Option | What we get | Cost to us | Notes |
|---|---|---|---|
| **Pitney Bowes Shipping API** | First-Class letter postage (`carrier USPS, service FCM, parcelType LETTER`, size `DOC_6X4` or `DOC_9X4`) with an IMb; tracking via their Track API (`carrier=IMB`) | $0.78 postage; the first 3,000 labels/mo are free, then $0.05/label; tracking-only $0.02; a 3% fee if we fund the account by card | Letter support is documented. USPS doesn't *guarantee* IMb scan events. ([PB labels FAQ](https://docs.shippingapi.pitneybowes.com/faqs-shipping/labels.html), [PB pricing](https://www.pitneybowes.com/us/ecommerce-fulfillment-software/shipping-plans.html)) |
| EasyPost | USPS letters with IMb tracking events | 3,000 free labels/mo, then $0.08; **plus 3% on all USPS postage since June 2026** | The 3% makes it worse than PB for this. ([EasyPost pricing](https://www.easypost.com/pricing/), [the 3% fee](https://goshippo.com/blog/what-easyposts-new-3-fee-means-for-your-usps-shipping-costs)) |
| DIY IMb (free) | We print an IMb on envelopes the seller stamps, and read scans from USPS Informed Visibility | $0 (needs the owner's USPS Mailer ID) | That's what TCGTracking does for free. It's parity, not an edge. See the "IMb path" in `docs/competitors.md`. |

USPS letter prices since July 12, 2026: stamp $0.82, metered $0.78 for
1 oz ([Stamps.com](https://help.stamps.com/hc/en-us/articles/20820467721371-USPS-Rate-Changes-2026)).

## The money, honestly

**Per tracked envelope (Phase 1, PB API, metered $0.78):**

| | At a $0.82 price (same as a stamp) | At a $0.89 price |
|---|---|---|
| Postage | −$0.78 | −$0.78 |
| PB label fee (only after 3,000/mo) | −$0.05 | −$0.05 |
| Funding costs (ACH top-ups; card funding adds ~3%) | ~−$0.01 | ~−$0.01 |
| **Net per envelope** | **about −$0.02 to +$0.03** | **about +$0.05 to +$0.10** |

- **Postage on its own is a thin-margin business.** Pirate Ship makes
  money on scale and partnerships, not markups.
- **The real payoff is subscriptions.** "Tracked envelopes printed with
  your labels" makes Premium worth paying for, and every seller who funds
  a postage balance with us stays with us.
- **Volume scenarios** (hypothetical, not forecasts): 100 active sellers
  × 400 envelopes/mo is 40k/mo, or $2–4k/mo at +5–10¢. 1,000 sellers is
  400k/mo, or about 5M a year. At that volume a negotiated rate becomes
  realistic, and every 10¢ of discount is worth about $40k/mo that we can
  split with sellers. That's the scale-to-crazy scenario, and it has to be
  earned in order.

## Plan, in order

**Phase 0: free tracking parity (about 1 week of work, $0)**
- Owner: USPS Business Customer Gateway and a **Mailer ID**. It's free
  and slow; it's already on OWNER-TODO.
- We print an IMb on our #10 envelopes and Avery labels, read scans from
  USPS Informed Visibility, and show "Accepted / In transit / Out for
  delivery" per order.
- Matches TCGTracking and beats TCGHaulTracker's price.

**Phase 1: postage in the app (about 2–3 weeks of work)**
- Owner:
  - A **Pitney Bowes Shipping API** developer account (free up to 3,000
    labels/mo).
  - An **LLC** before handling postage money.
  - Read PB's and USPS's postage terms, ideally with a lawyer. Sellers
    must accept USPS terms, and unused labels need a refund flow.
- Build:
  - A prepaid **postage balance**: Stripe top-ups, ACH preferred.
  - Server-side PB `LETTER` shipments.
  - Postage printed on the 4×6 label or the #10 envelope.
  - Tracking status in the app.
  - Refunds for unused labels, and PB webhook and ledger reconciliation.
- **Pilot with Rob** (500+ labels a month). Start at a stamp-equal price.
- Also offer **Ground Advantage labels for $49.99+ orders** through the
  same account. That gives sellers one app for every order.

**Phase 2: negotiated rate (after 6–12 months of real volume)**
- Take the volume data to Pitney Bowes and USPS and ask for a
  negotiated rate for trading-card letters, like eBay's.
- If it works, that's the "only one under a stamp for TCGplayer" moment.

## Risks

- **TCGplayer builds it first.** They already use PB for Direct.
  Mitigation: move fast, own the seller relationship, and stay
  marketplace-agnostic (eBay/Whatnot CSVs).
- **Postage handling** means refunds, fraud (stolen cards funding
  balances), reconciliation and support load. Start with ACH and a small
  pilot.
- **IMb scans aren't guaranteed**, and IMb isn't TCGplayer-valid
  tracking. Market it as "delivery scans", not "tracking" for $50+ orders.
- **Seller agreement:** printing postage and our return address is fine.
  No marketing on slips (see C-15).

## Owner decisions needed

1. Go or no-go on Phase 0: apply for the Mailer ID now (free).
2. Go or no-go on Phase 1: PB developer account, LLC, legal read.
3. Pricing stance: stamp-equal ($0.82, subscription-driven) or a small
   markup ($0.89, per-label profit).
