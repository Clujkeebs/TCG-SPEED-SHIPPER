# Speed Scan (S0 foundation + S1 camera groundwork)

Search for cards, set your defaults once, build a list with prices, download a CSV for the
TCGplayer Seller Portal import. Works offline after the first visit. No build step, no dependencies.

## Try it in one minute
1. `node suite/scan/serve.js`, open <http://localhost:8080/scan/public/> (phone: same Wi-Fi, use the computer's address; the camera needs https or localhost).
2. Pick **Quick price rule** (for example "5% under market"). Set condition, finish, language once.
3. Type a name ("bolt"), press Enter to add the top match, or tap **Add**. Wrong card? **Undo**.
3b. **No camera? Try 20 cards in a minute:** on the Add tab tap **Upload photos**, select every file in `suite/scan/sample-photos/` (20 synthetic card pictures). About 12 of 20 are added by themselves; the rest show likely matches to tap. Go to **List**, type a product ID where asked, **Download CSV**.
4. **Start live camera**: hold a card steady and it is picked up when it stops moving (swap cards to keep going). Or **Upload photos** (pick or drop several). It finds the card, reads the name, set code and number with a self-hosted reader (first scan downloads about 11 MB, then it works offline), and adds it or shows the likely matches to tap.
5. Type TCGplayer product IDs where asked, then **Download CSV**. Remember the columns are unverified.

## Testing with other sellers
`docs/suite/SCAN-BETA.md` is a one-page plain-language how-to with the feedback questions. The card list is only the 96-card sample until real index files are built (`docs/suite/SCAN-COVERAGE.md`).

## Finding any card
The built-in list is only 96 sample cards. With **Look up any card online** ticked (default), a search that finds nothing locally asks Scryfall / Pokémon TCG / YGOPRODeck from your browser and remembers the result on the device. Tested with simulated responses only.

## Prices, links and problems
Prices from the card sites carry the time they were fetched; older than 24 hours means a refetch, or a red warning on the row. For a card with no TCGplayer product id, paste its TCGplayer page address (only the number is read from the text; the page is never opened). **Report a problem** copies a short plain-text note for the board inbox.

## Lists, bulk edit, and measuring real use
- **Lists** (List tab): several named lists on the device (newest 20 kept): new, rename, open, copy, delete (asks first), a CSV per list, and **Open a CSV from Speed Scan** to continue a saved file (cards are matched by TCGplayer product id; unknown ones show as "TCGplayer product N").
- **Bulk edit**: tick rows (or Select all), set condition or finish for all of them, or re-apply your price rule to them; **Undo** reverses the whole change at once.
- **Right first time** (List tab): counts only, kept on this device: added by itself, you tapped its first guess, you fixed it. It is also in **Report a problem**.
- **Share my results**: copies a short anonymous text (the raw text the reader saw on the title and number strips, the card we matched, the card you ended with, the game, how sure we were; newest 60 cards; no photos, names or prices). `node scan/eval/from-results.js <file>` (from `suite/`) turns a pasted one into accuracy and the commonest failure patterns, so the parser can be tuned on real reader output.

## iPad / iPhone (Safari) notes
Camera starts only from a tap, video is inline and muted, constraints are "ideal" only; plain-words messages for blocked,
missing, busy camera and non-https pages; screen stays awake while scanning (quietly skipped if the browser has no Wake Lock);
pictures are shrunk to 1600 px before reading; the card reader is shut down after a minute idle; **Check my device** on the first
screen (its result is included in **Report a problem**); home-screen icon, full-screen mode, notch and home-bar spacing; fields
are 16 px so Safari does not zoom. A new version waits and shows "New version ready, tap to refresh" (`AUTO_ACTIVATE` in `public/sw.js` is false; `node scan/dev/sw-update-check.cjs` proves the flow in Chromium). Only tested in Chromium here; Safari-specific behaviour is untested.

## Host it on its own site
`node suite/scan/build.js` writes a plain static folder to `suite/scan/dist/` (about 130 KB). Upload that folder to any
static host (Netlify, Cloudflare Pages, GitHub Pages) with https. Nothing runs on a server. The folder is not committed.

## Try it (details)
```
node suite/scan/serve.js          # then open http://localhost:8080/scan/public/
```
(Any static server works if its root is the `suite/` folder.) Type "bolt m11", press Enter to add the
top match, or tap Add. Change defaults at the top; prices follow your rule.

## Test (offline, no network)
```
cd suite && npm test
```

## What is verified, and what is not
| Thing | State |
|---|---|
| Price rules (basis, percent, floor, ceiling, minimum, rounding, condition multipliers) | Tested with edge cases |
| Queue (add, quantity, edit, remove, undo, merge duplicates, totals, saving) | Tested |
| **CSV column names** | **UNVERIFIED.** From a third-party importer's description. The "Condition" column is a guess. Needs a real TCGplayer export file from the owner. Change `FORMAT` in `core/csv.js` only. |
| Rows with no `tcgplayerProductId` | Never guessed. Left out of the CSV and shown for the seller to fill in by hand. |
| Scryfall adapter | Tested on hand-written fixtures in the documented shape. Never run against the real service. `dev/fetch-scryfall.js` (not used by tests) can fetch a set, politely and cached. Check Scryfall's terms first. |
| Sample data (`data/sample/`, 96 printings, 4 games) | Names and set codes are public facts; **collector numbers are best effort, not checked**. Prices are **made-up demo numbers**. No product IDs, no images. |
| Camera, card detection, text reading (Tesseract.js in `vendor/`), parsing, lookup, accept-or-ask | Measured on synthetic cards only (see `docs/suite/SCAN-EVAL.md`). **No accuracy on real photos yet.** |
| CSV columns | All in `core/csv-format.js`. The **CSV check** tab compares a pasted real export header with ours. Unverified until a real export arrives. |
| Pokémon, Yu-Gi-Oh!, One Piece adapters | Written against assumed response shapes, tested on hand-written fixtures only. |
| Phone layout | Checked at 390px and 1280px in a headless browser. Not yet tried on a real iPad or iPhone. |

## Layout
`core/` pricing, csv, session · `data/` index, provider adapters, sample · `public/` the app · `vision/` card detection · `ocr/` parse, lookup, pipeline · `eval/` harness and simulated cases (`node scan/eval/run-simulated.js` from `suite/`) · `dev/` scripts not used by the app.
