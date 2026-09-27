# Competitors: TCG seller shipping and tracking tools

Researched by Devin, 2026-09-26, from each product's public pages. Pricing and
features change, so re-check before quoting any of this publicly. "Not
verified" means I couldn't confirm it from a public page.

## Two groups

1. **Label / fulfillment tools** that compete with the core app: TCG QuickShip,
   TCG-ShipSync, TCGTracking and the Mana Pool seller tooling. The theme across
   them is integrations: multiple marketplaces, buying postage in the app, and
   writing tracking back to the marketplace.
2. **PWE (letter) tracking tools** that sell tracking for stamped envelopes
   using USPS Intelligent Mail barcodes (IMb):

| Product | How it works | Pricing (public) |
|---|---|---|
| TCGHaulTracker | Prints a USPS IMb on the envelope and tracks it through USPS mail processing | Free trial; paid tiers not verified |
| Where's My TCG | Uses USPS Informed Visibility. Sellers upload their packing slips and get the barcode embedded | Not verified |
| Card Pathfinder | Credit-based letter tracking | 5 free credits, then paid packs from $5 |

Three products in group 2 means sellers want to know "did my $0.78 envelope
arrive?" and will pay for it. We already print the envelope, which is exactly
where the barcode goes.

## What they have that we don't, with one-line "steal this" ideas

| Gap | Who has it | Steal this | Effort / owner |
|---|---|---|---|
| Buying postage for tracked orders | Label tools, Pirate Ship | **Pirate Ship CSV export** (in progress on a Devin branch). Buying postage stays in Pirate Ship; we never touch payments | Small · Devin |
| Tracking for envelopes (IMb) | TCGHaulTracker, Where's My TCG, Card Pathfinder | Print an IMb on our envelope and label layouts. See "IMb path" below | Large · needs owner accounts, then Claude (server) + Devin (layout) |
| Writing tracking back to TCGplayer | Some label tools | We already build the TCGplayer tracking-import file (`buildTrackingImport`). Make the paste-back step after a Pirate Ship import the obvious next click | Small · Devin |
| Multiple marketplaces (eBay, Whatnot, Mana Pool, Cardmarket) | Several | CSV presets for eBay and Whatnot order exports. Our parser already fuzzy-matches headers, so this is mostly sample files + tests | Medium · Devin, after the owner exports a real (redacted) eBay and Whatnot CSV |
| Listed where sellers look | Mana Pool lists third-party tools | Ask Mana Pool and TCGplayer about being listed (owner outreach) | Owner |

## Where we already win (use this in copy)

- **Privacy:** order data never leaves the browser. It's a strong point and
  belongs in the hero and the partner pitch.
- **No login to start:** 10 free labels without an account.
- **Price:** $2.99 Base / $5.99 Premium. Most label tools don't publish
  prices, so we shouldn't claim to be "cheapest" yet.
- **Shipping-rule tiers built in:** the Shipping Plan (envelope / tracking
  recommended / tracking / signature) applies TCGplayer's thresholds for you.

## IMb path (why it's not a quick win)

From USPS PostalPro and the USPS developer docs, a seller-facing IMb feature
needs, in order:

1. A USPS Business Customer Gateway account and a **Mailer ID** (owner's
   identity, free).
2. Informed Visibility (IV-MTR) access to receive the scan events.
3. A server job that assigns unique serial numbers per piece and polls or
   receives IV-MTR scan data (Claude: server + Supabase).
4. The barcode printed in the right place on the envelope in the IMb font or
   as drawn bars (Devin: layout).

It's a real product, likely a Premium feature or a per-envelope add-on, but
it's weeks of owner paperwork plus a server integration. **Recommendation:**
the owner applies for the Mailer ID now (free, slow), and we revisit once it
exists.
