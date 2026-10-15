# Speed Scan (S0 foundation + S1 camera groundwork)

Search for cards, set your defaults once, build a list with prices, download a CSV for the
TCGplayer Seller Portal import. Works offline after the first visit. No build step, no dependencies.

## Try it in one minute
1. `node suite/scan/serve.js`, open <http://localhost:8080/scan/public/> (phone: same Wi-Fi, use the computer's address; the camera needs https or localhost).
2. Pick **Quick price rule** (for example "5% under market"). Set condition, finish, language once.
3. Type a name ("bolt"), press Enter to add the top match, or tap **Add**. Wrong card? **Undo**.
4. Tap **Start camera** and **Capture card**: it finds the card and buzzes. It cannot read it yet (no text reader installed), so add by search.
5. Type TCGplayer product IDs where asked, then **Download CSV**. Remember the columns are unverified.

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
| Camera, card detection, text parsing, lookup, accept-or-ask | Built and tested on synthetic data. **No text-reading engine is installed**, so the camera cannot yet name a card. No accuracy on real cards: see `docs/suite/SCAN-EVAL.md`. |
| Pokémon, Yu-Gi-Oh!, One Piece adapters | Written against assumed response shapes, tested on hand-written fixtures only. |
| Phone layout | Checked at 390px and 1280px in a headless browser. Not yet tried on a real iPad or iPhone. |

## Layout
`core/` pricing, csv, session · `data/` index, provider adapters, sample · `public/` the app · `vision/` card detection · `ocr/` parse, lookup, pipeline · `eval/` harness and simulated cases (`node scan/eval/run-simulated.js` from `suite/`) · `dev/` scripts not used by the app.
