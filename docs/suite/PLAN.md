# TCG Speed Suite: plan

Status: v1 · 2026-10-15 · written by the Builder session (Claude) from the owner's vision.
Owner decisions are marked ✅. Everything else is a proposal until the owner says otherwise.
Facts about TCGplayer and data providers come from search results on 2026-10-15 (the sandbox
cannot open tcgplayer.com). **Re-check each one against the original page before relying on it.**

## 1. What we are building, in plain words

One toolkit for a trading-card seller's whole day.

| Product | What it does | Status |
|---|---|---|
| **TCG Speed Shipper** | Labels, packing slips and postage from TCGplayer orders | Live |
| **TCG Speed Scan** | Point a phone camera at cards; it names each card. The seller sets condition, finish and a price rule once, then rapid-fires cards. Download a CSV, upload it, and the cards are listed. Later: one-click upload. Magic, Pokémon, Yu-Gi-Oh!, One Piece first. | Planned. First session started 2026-10-15 |
| **TCG Speed Agent** | An AI assistant for running and growing the business: find and manage inventory, keep it in sync across platforms, draft customer replies, show repeat-customer and shipping analytics, hunt deals on supplies and closeouts, run automations. Works in a Chrome extension and the web app, and is slightly biased toward our own tools. | Planned. Starts once Scan and the extension have a base |
| **Chrome extension** | One extension that hosts the Shipper helper ("Print shipping", "Paste tracking"), the Scan uploader and the Agent side panel | Planned. First session started 2026-10-15 |

The products share data: Scan creates inventory, Shipper consumes it when orders ship, and the
Agent reads both. That shared data is the moat; any one product alone is easy to copy.

## 2. Ground truth (so we do not build on sand)

**TCGplayer** (per search results, Oct 2026)
- **No new API access.** The developer docs say TCGplayer is no longer granting new API access.
  Existing keys work under restrictive terms (approved purposes only, revocable).
  <https://docs.tcgplayer.com/docs/getting-started>
- **The sanctioned way to list is the Seller Portal CSV import.** Imports "always add inventory and
  never overwrite existing quantities", and the TCG Marketplace Price field is always required.
  A third-party importer (Mana Pool) reads the columns `TCGPlayer Id`, `Total Quantity` and
  `TCG Marketplace Price`. That is a hint, not a spec: the exporter must be built from the current
  help article and a real export file the owner provides.
  <https://help.tcgplayer.com/hc/en-us/articles/115002358027-Importing-and-Exporting-CSVs-to-Mass-Update-Prices-and-Quantities>
  · <https://support.manapool.com/hc/en-us/articles/21894301054487>
- **TCGplayer's own mobile app already scans cards** and can import scanned lists into "Staged
  Inventory". So "scan to list" is not new. Our edge has to be speed (rapid-fire), price rules,
  several games, and the link to Shipper and the Agent.
  <https://help.tcgplayer.com/hc/en-us/articles/17474327281303-How-to-Import-Lists-of-Cards-from-the-TCGplayer-Mobile-App-to-Inventory>
- **Rules on automation.** Secondary sources say TCGplayer's Terms forbid crawling or scraping
  without permission and the API terms forbid bots outside the API. The Marketplace Seller
  Agreement reportedly says nothing about automation. We have not read the originals.
  <https://help.tcgplayer.com/hc/en-us/articles/205004918-Terms-of-ServiceTCGplayer>
  · <https://help.tcgplayer.com/hc/en-us/articles/201307587-Marketplace-Seller-Agreement>
  · <https://help.tcgplayer.com/hc/en-us/articles/360061115874-TCGplayer-API-Terms-Conditions>
  **Consequence:** anything that automates TCGplayer pages is gated on the owner reading the rules
  and, ideally, TCGplayer's written OK. Never scrape TCGplayer. Never use tcgcsv.com or any other
  unofficial mirror of TCGplayer data as a dependency.

**Card data and prices** (verify terms, rate limits, attribution and commercial use for each)
- Magic: Scryfall (includes TCGplayer ids and USD prices; has rules about not paywalling its data).
- Pokémon: Pokémon TCG API / Scrydex, TCGdex. Yu-Gi-Oh!: YGOPRODeck. One Piece and Lorcana:
  community APIs. Multi-game paid options: PriceCharting, JustTCG.
- A listing needs a `tcgplayerProductId` for the CSV. Coverage differs per game. Where an id is
  unknown we say so; we never guess one.

**Our business today:** about $40/month, 12 paying accounts. Postage fees through Pitney Bowes are
the fastest route to $1k–$10k/month (see `docs/research/road-to-10k.md`). The Suite is the bigger bet
and must not slow that down.

## 3. Principles

1. **Sanctioned paths first.** CSV import, user-initiated actions, official or licensed data.
2. **Local-first.** Buyer data stays in the seller's browser unless the seller opts in to sync. Our
   public copy says "your buyers' addresses never leave your browser". Buying postage already sends
   an address to our postage partner, so wording must stay honest as features change.
3. **A human approves anything that moves money, changes listings or prices, or messages a
   customer.** (This is already the owner's rule for customer emails.)
4. **Never risk the live product.** Suite code lives in `suite/`, has its own tests, and ships behind
   flags. The live server never imports from `suite/`.
5. **Everything is testable offline** with fixtures and fake data. No real buyer data in the repo.
6. **Measure before building more.** Each milestone has a number to hit (section 6).

## 4. Products

### 4.1 Speed Scan

**Seller flow.** Pick the game. Set defaults once: condition, finish (foil, etc.), language, a price
rule (for example "5% below market, never under $0.25, end in .99") and quantity per scan. Start the
camera and rapid-fire. Each card: detect, identify, add to the queue with its price. Confident
matches are accepted automatically with a beep or haptic tick; unsure ones show the top few
candidates to tap. Undo is always one tap. Duplicates (same printing, condition, finish) merge into
quantity. When done, download the CSV (later: one click to upload).

**Identification pipeline** (staged; pick by measured accuracy and speed):
1. OCR the printed set code and collector number (modern Magic, Pokémon, Yu-Gi-Oh! and One Piece
   cards all print one) plus the card name, then look the printing up in the card database.
2. Image-embedding nearest-neighbour as a fallback, and to tell reprints apart.
3. A vision-model fallback for hard cases only, behind a cost cap (this costs money per scan, so it
   needs the owner's approval before any spend).
Target: 95% or better top-1 on modern cards in decent light, 98% or better when the seller can tap
one of the top three. Median time per card under 3 seconds.

**Pricing rules.** Basis: market, low, mid or fixed. Percent above or below. Floor and ceiling.
Rounding (cent, nickel, dime, ends in .99 or .95, dollar). Minimum price to list at all (skip
bulk). Condition multipliers (for example LP is 90% of NM). Different numbers for foil. All money
is whole cents (`suite/shared/models.js`).

**Output.** A CSV for the Seller Portal import, built from TCGplayer's own help article and a real
export file. Then a one-click upload through the extension, once the rules gate in section 7 is
cleared.

**Platform.** A progressive web app first, because the owner works on an iPad and a phone.
iOS Safari has no built-in text detector, so OCR must run in WebAssembly. If camera speed or
accuracy on iOS is not good enough, wrap it in a native shell (Capacitor) later.

**Not in v1:** grading, sealed product, collection valuation, other marketplaces.

### 4.2 Chrome extension

One extension ("TCG Speed Suite") with modules that each sit behind a feature flag, off by default:
- **Shipper helper.** "Paste tracking" fills tracking numbers into TCGplayer's own mark-shipped
  form. "Print shipping" hands the orders on screen to Speed Shipper without the CSV step. Draft:
  `docs/research/chrome-extension.md`.
- **Scan uploader.** "Upload to TCGplayer" opens the Import CSV page and attaches the file the
  seller just made.
- **Agent side panel.** The Agent's chat and approvals, with the page the seller is on as context
  (only after the seller says yes for that page).

Rules for every module: it acts only when the seller clicks; it never logs in for them, never
stores their TCGplayer password, never runs in the background against TCGplayer, never touches
other sellers' data. It starts as reading and filling forms the seller already has open.

Technical: Manifest V3 (service worker, content scripts, side panel), minimal permissions,
`chrome.storage` and IndexedDB, message bridge to the web apps, Playwright tests that load the
unpacked extension against saved HTML fixtures (never live TCGplayer). Chrome Web Store needs a
one-time developer fee, a privacy policy and a review for each update (1–3 days).

### 4.3 Speed Agent

An AI assistant, not a chatbot bolted on. It works through a registry of **tools**, and every tool
has a permission tier:

| Tier | Meaning | Examples |
|---|---|---|
| read | looks at data, changes nothing | search orders, repeat-buyer stats, shipping destinations, price suggestions |
| draft | prepares something for a human | a reply to a buyer, a listing CSV, a restock list |
| act | changes something, needs approval each time | update prices, mark orders shipped, send an approved message |
| autopilot | runs by itself, only if the owner switched that automation on | a weekly report, a daily price refresh within limits |

Every call lands in an audit log (what, who approved). Spending and rate limits apply to every
tool. There is a kill switch.

**Jobs it should do** (in build order): analytics (repeat customers, how often and where you ship);
support (draft replies from order context; never send without approval); pricing (suggest from
provider prices and the seller's rules); inventory (read a TCGplayer export and Scan sessions, show
what is low, what to relist); sync (CSV in and out for eBay, Whatnot and Mana Pool); deal-hunting
for supplies (sleeves, shelving, closeouts, monitors, scanners) from an allow-list of sources;
automations (cron-style schedules with approval gates).

**Under the hood:** Claude API with tool use. Run through a small server-side proxy with per-user
limits so our key is never in the browser. Local-first data store, synced only on opt-in. The cost
per active seller is a real number to track before pricing it.

## 5. Where the code lives

```
suite/                  code only; own package.json; the live server never reads it
  shared/               contracts (models.js + tests). Owned by the Builder session.
  scan/                 Speed Scan (PWA)
  extension/            the Chrome extension
  agent/                the Agent core (later)
docs/suite/             plan, data model, working agreement, log, kickoff prompts
```

Accounts, plans and billing reuse the existing Supabase and Stripe setup when we get there (the
owner approves any new Stripe prices). New pages on the live site are added by the Builder session
only, behind a flag.

## 6. Milestones and numbers to hit

Milestones are gated by results, not dates.

**Scan**
- **S0 Foundation, no camera.** PWA shell, price-rule engine, TCGplayer CSV writer built from the
  verified format, card-database adapter for Magic with fixtures, search-and-add UI, session queue,
  export. Done when: tests pass offline, and a seller can add 10 cards by search and export a CSV
  that matches the verified format.
- **S1 Camera and OCR for Magic and Pokémon.** Capture, find the card, crop, read set code and
  number. `docs/suite/SCAN-EVAL.md` records accuracy and speed on a labeled set. Done when: the
  numbers in section 4.1 are met on that set, or the report says plainly why not.
- **S2 Yu-Gi-Oh! and One Piece** (Lorcana if cheap). Check TCGplayer-id coverage per game. Rapid-fire
  polish.
- **S3 Beta.** Three to five real sellers (Rob first). **Pass:** each lists 100+ cards in a session
  and at least 90% of rows need no edit.

**Extension**
- **X0 Foundation.** Manifest V3 skeleton, feature flags (all TCGplayer modules off), message
  bridge, local store, fixture-based Playwright harness, privacy-policy draft, store checklist,
  `docs/suite/TOS-NOTES.md`.
- **X1 Adapter framework.** Page adapters with selectors in config and a self-test, dry-run mode,
  built against synthetic fixtures. Still off.
- **X2 Real pages. Gated** on the owner recording "TOS OK" (section 7). "Paste tracking" first.
- **X3 Agent side panel shell.**

**Agent** (after S0 and X0)
- **A0** tool registry, permission tiers, audit log, offline evaluation harness with scripted model
  stubs. **A1** read-only analytics and drafts on fixture data. **A2** inventory and CSV sync.
  **A3** automations and the deal finder. **A4** extension chat, server proxy, limits, billing.

**Kill or change course if:** by the end of S1 accuracy is under 85% even with tap-to-confirm; or
no beta seller completes a 100-card session; or TCGplayer says no to the extension and the CSV path
alone is not worth paying for.

## 7. Risks, worst first

1. **TCGplayer's rules and platform risk.** They already scan in their own app and could ship what
   we ship. Mitigation: CSV first, user-initiated actions only, ask permission in writing,
   differentiate on speed, price rules and the multi-product link.
2. **Scan accuracy.** Tiny printed text, glare, sleeves and foils. Mitigation: staged pipeline,
   an evaluation report, kill criteria above.
3. **Data licensing.** Provider terms differ. Mitigation: one adapter per provider, attribution,
   no resale of raw data, verify before shipping.
4. **Cost per scan and per agent run.** Mitigation: on-device first, caps, tiered pricing, owner
   approves any spend.
5. **Extension fragility.** TCGplayer changes a page and it breaks. Mitigation: selector config,
   self-test, quick-fix and Web Store review process.
6. **Privacy.** Buyer data and the "never leaves your browser" promise. Mitigation: local-first,
   honest copy, no real buyer data in tests or logs.
7. **Focus.** The live product still earns the money. Mitigation: Suite work is time-boxed, lives in
   its own folder, and the postage launch stays first.
8. **Usage limits.** Several long sessions at once burn the owner's weekly Claude limit.
   Mitigation: two sessions at a time, the Agent starts later.

## 8. Business sketch (hypotheses, not promises)

- Shipper stays as is (Free, Base, Premium, Pro, plus postage fees).
- Scan: a free allowance (for example 100 cards a month), then a paid plan.
- Agent: the top tier, with usage caps because every run costs money.
- A bundle for sellers who want all three.
- Arithmetic to keep honest: $10k/month is about 170 sellers at $59 or 200 at $49. Nobody has said
  yes to any of these prices. Test with five sellers before building billing.

## 9. What the owner decides

1. Say "go suite" (or what to change) after reading the one-page summary.
2. TCGplayer rules: read the Terms and Seller Agreement with Claude, then Claude drafts an email
   to TCGplayer asking for written OK for a seller-run browser helper. (Board task S2, and E5.)
3. Choose two or three sellers to test (Rob plus one or two).
4. Later: names and domains for Scan and Agent, spending approval for any paid data or model use.

## 10. How the sessions connect

- One shared log, `docs/suite/LOG.md` (append-only). The Builder session (the original chat) reads
  it every morning and turns anything the owner must do into a short board task.
- Rules for every suite session: `docs/suite/WORKING-AGREEMENT.md`.
- Shared shapes: `docs/suite/DATA-MODEL.md` and `suite/shared/`.
- Exact starting prompts: `docs/suite/kickoff/`.
