# Kickoff: Speed Scan (session "scan")

You are the **Speed Scan builder** for the TCG Speed Suite. The repo
(`Clujkeebs/TCG-SPEED-SHIPPER`) is already checked out. Your branch: `suite/scan`.

Read first, in this order, and then follow them exactly: `CLAUDE.md`, `AGENTS.md`,
`docs/agents/PERMISSIONS.md`, `docs/suite/README.md`, `docs/suite/PLAN.md`,
`docs/suite/WORKING-AGREEMENT.md`, `docs/suite/DATA-MODEL.md`, `docs/suite/LOG.md`,
`suite/shared/models.js`. You write only in `suite/scan/`, your own docs under `docs/suite/`, and
the log. The owner pays for this on a weekly usage limit: do not loop on a failing approach. If you
fail the same step twice, log it under "Needs Builder" and move on.

## Mission (the owner's words, tidied)
A phone camera app for trading-card sellers. Point the camera at a card and it identifies it. The
seller sets, once: condition, finish (foil or not), language, and a price rule such as "5% below
market" or "last sold", then rapid-fires cards one after another. It works for Magic, Pokémon,
Yu-Gi-Oh! and One Piece first. At the end the seller downloads a CSV, uploads it to TCGplayer, and
the cards are listed. Later a browser extension makes the upload one click.

## Milestone S0: start now (foundation, no camera yet)
Build in `suite/scan/`, with tests. Vanilla ES modules, no build step, no runtime dependencies
unless you can justify one in the log. Import contracts from `../shared/models.js`.

1. `core/pricing.js`: apply a PriceRule (see DATA-MODEL) to a printing's prices for a condition and
   finish. Basis, percent, floor, ceiling, minimum-to-list (returns "skip"), rounding (cent, nickel,
   dime, ends-99, ends-95, dollar), condition multipliers. Whole cents only. Table-driven tests with
   edge cases (rounding up past the ceiling, floors, missing prices).
2. `core/csv.js`: write the CSV for TCGplayer's Seller Portal import. Source of truth is TCGplayer's
   help article (link in PLAN.md section 2) and, when the owner supplies one, a real export. Until
   then put the columns in one `FORMAT` constant (start from `TCGPlayer Id`, `Total Quantity`,
   `TCG Marketplace Price`; the price is required), say in the UI and README that the format is
   **unverified**, and record in the log that you need a real export file from the owner. Rows
   without a `tcgplayerProductId` must be listed separately for the seller to fix by hand, never
   guessed. Guard against spreadsheet formula injection in text cells.
3. `data/providers/scryfall.js` (Magic): normalize a provider response into a Printing. Tests use
   saved response fixtures you write by hand from the provider's documented shape. No network in
   tests. A separate dev script may fetch real data, with a cache and polite rate limits, if the
   provider's terms allow it.
4. `data/index.js`: an offline search index (name, set code, number) over a small sample dataset
   in `data/sample/`: about 100 printings across mtg, pokemon, yugioh and onepiece. Card names and
   set codes are facts; no images. Add `tcgplayerProductId` only where a fixture really contains one.
5. `core/session.js`: the queue of ListingDrafts: add, change quantity, edit, remove, undo, merge
   duplicates (same printing, condition, finish, language), totals. Persist to IndexedDB with an
   in-memory fallback so the same code runs in Node tests.
6. `public/`: `index.html`, `app.js`, `styles.css`, `manifest.webmanifest`, `sw.js`. A defaults
   panel (game, condition, finish, language, price rule, quantity), search-and-add, the queue, and
   Download CSV. Works at 390px width, big tap targets, offline after the first load, accessible
   (labels, focus, contrast). Match the look of the live site (cream background, dark green accent;
   see `public/index.html`) without importing from it.
7. `README.md` in `suite/scan/`: how to run (any static server), how to test, what is verified and
   what is not.

**Done when:** `cd suite && npm test` is green and offline; you can add 10 cards by search, apply
a price rule, and export a CSV; the README says how to try it; the log entry is written; the PR is
merged or waiting for the Builder. Take screenshots at 390px and 1280px and look at them yourself.

## Then S1: camera and OCR for Magic and Pokémon (PLAN.md section 6)
Capture with `getUserMedia`, find the card, crop it, read the set code and collector number (and
the name), look it up. Evaluate a WebAssembly OCR (a self-hosted Tesseract.js build is the obvious
first candidate; compare one alternative if time allows) and image embeddings as a fallback. iOS
Safari is the hard case: assume no text-detection API. Write `docs/suite/SCAN-EVAL.md` with measured
accuracy and time per card on a labeled set. If the sandbox cannot reach card-image hosts, build the
harness anyway, use synthetic rendered cards for unit tests, and write down exactly what the owner
must supply (about 50 phone photos of real cards, mixed games, normal light). Never claim an
accuracy number you did not measure.

## Do not
Touch `server.js`, `public/`, the root `test/`, billing, auth or anything outside your folder. Call
TCGplayer. Spend money. Add analytics. Use model names in commits. Leave secrets or real buyer data
anywhere.
