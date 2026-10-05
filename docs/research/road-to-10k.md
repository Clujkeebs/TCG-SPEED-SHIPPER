# Road to $10k/month

Plan by Claude, 2026-09-30. Starting point: about $36/mo MRR, 9 paying
of 16 accounts, and one power user (Rob, 500+ labels/mo). The rule from
the owner: **don't raise prices.** Grow by adding things sellers already
pay for somewhere else.

## The core insight

Right now we make money once per seller (a $2.99–5.99 subscription). The
sellers who ship the most (Rob: 500+ orders a month) spend **$400–600 a
month on postage** somewhere else: stamps, Pirate Ship, Click-N-Ship.
Every tool that reaches real money in shipping earns on **volume**
(postage, insurance, partner income), not seats. Pirate Ship charges
nothing extra and lives entirely on carrier partnership income
([how Pirate Ship makes money](https://www.pirateship.com/usps/commercial-pricing)).

So the plan: **become the place TCGplayer sellers buy postage**, and
keep the subscription as the cheap entry ticket.

## Five revenue streams (none raises a price)

| # | Stream | How we earn | Per unit (est.) | Needs |
|---|---|---|---|---|
| 1 | **Tracked envelope postage** (the eBay Standard Envelope idea) | Postage at a stamp-equal price; we pay the $0.78 metered rate | $0.02–0.05 per envelope now; more with a negotiated rate | Pitney Bowes API, owner accounts |
| 2 | **Ground Advantage labels** for $49.99+ orders | Pitney Bowes platform or partner income on volume, like Pirate Ship | $0.05–0.25 per label (negotiated; unverified) | Same PB integration |
| 3 | **Shipping insurance** for envelopes and parcels | A commission on premiums (Shipsurance / InsureShield APIs) | ~$0.03–0.10 per insured order | Insurance partner agreement |
| 4 | **Supplies affiliate** (envelopes, toploaders, thermal printers, labels) | 3–8% on referred purchases | $1–8 per buyer | Affiliate accounts (Amazon, supplier programs) |
| 5 | **Shops / Enterprise** (#56) | $49–199/mo custom plans | Per shop | Sales conversations |

## Update 2026-10-05: postage is built (pilot), with a fee per label

- Shipped: a Buy postage panel, a prepaid balance (add $20/$50/$100 or a
  custom amount up to $2,000), labels with tracking, reprints and refunds.
  It runs in sandbox until the owner adds Pitney Bowes keys and
  switches production on.
- Pricing model (owner's call): postage passes through at cost, plus our
  fee per label. Defaults: **$0.21 per letter** (a tracked letter totals
  $0.99) and **$0.30 per Ground Advantage label**. Change them with
  `PB_FEE_LETTER` / `PB_FEE_GROUND`.
- **Validation:** Rob pays **$30/mo to rent a postage meter** and said he'd
  drop it, and accept a higher subscription, for postage in the app.

**What we keep per label** (after PB's $0.05 once past 3,000/mo, and
payment fees on top-ups: card about 3.5% on $50, bank/ACH 0.8%):

| | Fee | Seller pays | Keep (card) | Keep (bank) |
|---|---|---|---|---|
| Letter | $0.21 | $0.99 | $0.13 | $0.15 |
| Letter | $0.30 | $1.08 | $0.21 | $0.24 |
| Ground (≈$4.50 postage) | $0.30 | $4.80 | $0.08 | $0.21 |
| Ground | $0.50 | $5.00 | $0.28 | $0.41 |
| Ground | $1.00 | $5.50 | $0.76 | $0.91 |

Recommendation: keep letters under $1 ($0.21), raise ground to $0.50, and
push bank top-ups. About 44k labels/mo (70% letters, 30% ground) reaches
$10k/mo from fees alone, roughly 90 sellers like Rob.

## What $10k/month actually takes

These are illustrative scenarios, not forecasts. They assume a heavy
seller ships about 400 envelopes and 100 tracked parcels a month.

| Scenario | Subscriptions | Envelope postage | Parcel labels | Insurance | Supplies | **Total/mo** |
|---|---|---|---|---|---|---|
| 100 heavy sellers | $500 | 40k × $0.04 = $1,600 | 10k × $0.15 = $1,500 | $600 | $300 | **≈ $4,500** |
| 250 heavy sellers | $1,250 | 100k × $0.05 = $5,000 | 25k × $0.15 = $3,750 | $1,500 | $500 | **≈ $12,000** |
| 250 + a negotiated envelope rate | $1,250 | 100k × $0.12 = $12,000 | $3,750 | $1,500 | $500 | **≈ $19,000** |

**Honest read:** 100 users gets us to roughly half of the goal, and only
if they're real shippers. **About 250 active shipping sellers gets us
past $10k.** Past that point, a negotiated envelope rate is the multiplier.

## The build, in order

**1. Pitney Bowes postage (the big one, 3–4 weeks of build)**
- **Account model.** PB lets a platform onboard sellers two ways
  ([PB merchant accounts](https://docs.shippingapi.pitneybowes.com/merchant-accounts.html)):
  - *Individual Postage Account:* each seller adds their own card in PB's
    merchant portal, and PB charges them directly. **We never hold
    postage money.** Lowest risk, so start here.
  - *Bulk Postage Account:* we pay all postage from one account ("Register
    a Known Shipper" API) and bill sellers ourselves. That gives us more
    control and margin, and also more risk (refunds, fraud, reconciling).
    Set up through PB client support.
- **Envelope label:** `Create Shipment` with carrier USPS, service FCM,
  parcelType LETTER, size DOC_9X4 (#10) or DOC_6X4 (4×6). PB returns the
  indicia plus an IMb, which we print on our envelope and label layouts.
  Tracking comes from the Track API with `carrier=IMB`
  ([PB labels FAQ](https://docs.shippingapi.pitneybowes.com/faqs-shipping/labels.html)).
- **Parcel label:** the same API with Ground Advantage for orders of
  $49.99 and up. TCGplayer's tracking rule is satisfied, and we fill the
  tracking into the TCGplayer import file automatically, which already
  exists (#20-era `buildTrackingImport`).
- **In the app:**
  - "Buy postage" on the Shipping Plan: envelope orders get letter
    postage, $49.99+ orders get Ground Advantage.
  - One click prints labels, postage, slips and the TCGplayer tracking
    file.
  - A per-order tracking status page.
  - Void and refund for mistakes.
- **Pilot:** Rob, then the 9 paying accounts.
- **Ask PB directly:** a platform or partner revenue share, and what
  volume unlocks a negotiated letter rate.

**2. Insurance at checkout (1 week, after postage)**
- An "Insure this order" toggle with the premium shown per order.
  Shipsurance and InsureShield both have APIs
  ([Shipsurance integration](https://www.shipsurance.com/integration),
  [InsureShield APIs](https://www.insureshield.com/us/en/shipping-insurance/multi-carrier-shipments/insureShield-connect/connectivity-tools/apis.html)).
- Competitor price point to beat: TCGTracking charges a $0.17 minimum
  per envelope.

**3. Browser extension (2–3 weeks): the "number one app" move**
- TCGplayer has closed its API to new developers
  ([status](https://cardgrader.ai/blog/tcgplayer-api-alternatives)), so
  every tool is stuck with CSV exports.
- A Chrome extension reads the seller's own Orders page. **No export
  step:** it pulls orders into our app and, after printing, **pastes
  tracking back into TCGplayer**. That's the entire shipping day in two
  clicks.
- **Risk:** TCGplayer could object to automation on its site. Keep it to
  the seller's own data, never scrape the marketplace, and read the
  seller agreement first.

**4. Supplies store / affiliate (2 days)**
- A "Shipping supplies" page and in-app nudges: "Running low? These
  envelopes fit the #10 format."
- Uses affiliate links only. No inventory.

**5. Multi-marketplace (ongoing)**
- The same app for eBay, Whatnot and Mana Pool orders (CSV presets,
  eBay's public API). A bigger market, and less dependence on TCGplayer.

## What's defensible

- **All-in-one:** labels, postage, slips with card lists, tracking back to
  TCGplayer, insurance. Every competitor does one or two of these
  (TCGTracking: envelope tracking; TCGHaulTracker: IMb; Pirate Ship:
  postage; TCGplayer: slips).
- **Privacy:** order data stays in the browser. Postage makes this
  harder: buying a label sends that order's address to PB. Say so
  plainly.
- **Price:** subscriptions stay $2.99–5.99, and postage is priced at or
  below a stamp.
- **Biggest threat:** TCGplayer (owned by eBay) could roll out its own
  "standard envelope" through PB. Being first, multi-marketplace and
  seller-loved is the defense.

## This week

- **Claude:**
  - An early-access list in the app ("Postage + tracking for envelopes,
    at stamp price or less"). It proves demand and gives us pilot users.
  - A PB integration spike once sandbox keys exist.
- **Owner (30 min total):**
  1. Create a Pitney Bowes developer account (free sandbox):
     developer.pitneybowes.com, then send Claude the sandbox keys via
     Railway variables. Never paste them in chat.
  2. Apply for the USPS Mailer ID (already on the to-do).
  3. Email PB client support: platform partnership, revenue share, and a
     Bulk Postage Account. Claude will draft the email.
  4. Start the LLC (needed before we take postage money).
