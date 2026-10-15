# Suite log (append-only, newest at the bottom)

Format is in `WORKING-AGREEMENT.md`. Never edit or delete an earlier entry.

### 2026-10-15 · builder · foundation · done
Wrote the plan (`PLAN.md`), shared data model (`DATA-MODEL.md`, `suite/shared/models.js`, 10 tests
passing), the working agreement and kickoff prompts. Sessions `scan` (branch `suite/scan`) and
`extension` (branch `suite/extension`) are started. The `agent` session is held: the owner's weekly
Claude limit was already in warning, and the Agent needs the other two to exist first.
Open facts to re-check, from `PLAN.md` section 2: TCGplayer's CSV import columns, whether any
automation is allowed, each card-data provider's terms.
Needs Builder: none
Needs owner: say "go suite" on the board after reading the one-page summary; read TCGplayer's
rules with Claude (board task S2); pick two or three sellers to test.
Next: review the first PRs from `scan` and `extension`; start `agent` when there is room.

### 2026-10-15 · scan · S0 · done
Built Speed Scan foundation in `suite/scan/`: price-rule engine, CSV writer (format flagged unverified;
rows without a product ID are listed separately, text cells are guarded against spreadsheet formulas),
Scryfall adapter on fixtures, offline search over 96 sample printings (4 games), session queue with undo
and merge, and the offline-capable phone app (checked at 390px and 1280px; added 10 cards, priced them,
typed product IDs, downloaded a CSV, reload kept the list).
Numbers: suite tests 43 pass (10 shared + 33 Scan) (offline); no console errors in the browser run.
Needs Builder: none. (Note: ListingDraft has no field for a seller-typed product ID, so Scan keeps those in a per-session map. Say if you want a field added.)
Needs owner: send one real TCGplayer inventory export (CSV) so the column names can be verified; until then the CSV is a draft. Sample collector numbers are also unchecked.
Next: S1 camera and OCR (needs about 50 phone photos of real cards to measure accuracy).
