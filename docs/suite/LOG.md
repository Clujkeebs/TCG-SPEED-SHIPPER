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

### 2026-10-15 · extension · X0 · done
Built the Chrome extension foundation in `suite/extension/`: Manifest V3 (service worker, bridge content
script on tcgspeedshipper.com and localhost only, side panel placeholder, options page), feature flags
(all off; TCGplayer ones also locked by `TOS_OK = false` in code), a checked message bridge, an IndexedDB
store with memory fallback using the shared validators, a Playwright browser test, a zip build, drafts of
`PRIVACY.md` and `STORE-CHECKLIST.md`, `README.md`, and `docs/suite/TOS-NOTES.md` (nothing from TCGplayer
read in full; questions to ask them are in it). No TCGplayer content script exists. Nothing touches TCGplayer.
Choices: content script plus `postMessage` instead of `externally_connectable` (page never gets a direct line
to the worker; checked twice). TCGplayer host is declared as an *optional* host permission (no install-time
warning, asked only when a module is switched on later). `src/vendor/models.js` is a copy of
`suite/shared/models.js` because an extension cannot load files outside its folder; a test fails if it drifts.
Numbers: `cd suite && npm test` 71 pass, 0 fail (with Scan merged in), offline; root `npm test` 17 suites pass; browser test
passed 6 of 6 runs. Chromium helper processes can outlive the browser and hang the test runner, so the
browser runs in its own process group that the test kills.
Needs Builder: (1) when the site's web app should talk to the extension, it posts `{source:'tcgss-app',v:1,id,type,payload}`
(see `suite/extension/README.md`); wiring that into `public/` is yours. (2) If `suite/shared/models.js`
changes, run `cp suite/shared/models.js suite/extension/src/vendor/models.js`. (3) Remove the `http://localhost/*`
match from the manifest before the first Web Store submission.
Needs owner: read `docs/suite/TOS-NOTES.md`, and say yes or no to emailing TCGplayer the questions in it.
Next: X1 adapter framework (still off, synthetic fixtures). Saved pages I need from the owner or Rob, from
their own logged-in browser (File > Save Page As, "Webpage, Complete"), with made-up or blurred buyer details:
(a) Seller Portal Orders list, (b) one order's page, (c) the "mark as shipped" / tracking form,
(d) the Import CSV page, (e) the Export Shipping download dialog. Until then X1 uses synthetic pages.

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

### 2026-10-15 · builder · go-ahead · done
The owner said to start everything ("get started on all the Chrome extensions, agents, all that stuff",
then the sites). His test email from the hello@ address arrived, so the Resend domain works and
sign-up codes (`SIGNUP_EMAIL_CODE=on`) are now on in production. Reviewed Scan S0 (PR #143): only
`suite/` and the log changed; accepted. Shared model: `ListingDraft` now allows an optional
`tcgplayerProductId` (answers Scan's question). Sessions now: `scan` (idle after S0, told to continue
with S1), `extension` (X0 running), `agent` (A0, new), `hq` (new: redesigns the owner's board, see
`kickoff/hq.md`). Sites (one per product plus the Suite) wait on domains (owner) and a working Scan
and Agent.
Needs Builder: none
Needs owner: a real TCGplayer inventory export (board task S4); about 50 card photos (S5, when S1
starts); Granola set up before the Pitney Bowes call (G12); test the sign-up code with a second email
(B13).
Next: review PRs; write the `suite` status document to the board each morning.

### 2026-10-15 · scan · S1 + S2 groundwork · partly done
Switched to the new `tcgplayerProductId` on ListingDraft (per-session map removed). Built: camera capture,
card finding and crop, text-to-clues parser, offline lookup, accept-or-ask logic (auto-accept only when clear),
sound/vibration feedback, tap-to-fix choices in the app, evaluation harness, and Pokémon, Yu-Gi-Oh! and One Piece
adapters on fixtures (assumed response shapes, to be confirmed). **No text-reading engine is bundled, so the camera
cannot yet name a card.** `docs/suite/SCAN-EVAL.md` has simulated lookup numbers only, clearly labelled; there is no
real accuracy or speed figure.
Numbers: Scan tests 54 pass (offline). Simulated lookup: 98.3% right-first at 5% damaged characters (96 sample cards).
Needs Builder: (1) approve vendoring a self-hosted WebAssembly OCR build (Tesseract.js, several MB, check licence) into
`suite/scan/vendor/`; (2) the `suite/extension` e2e test "fixture page message reaches the service worker" times out
(60 s) in this sandbox, so `cd suite && npm test` is red for a reason outside Scan; I left my PR open instead of merging.
Needs owner: about 50 phone photos of real cards (details in SCAN-EVAL.md); a real TCGplayer export (still open).
Next: plug in the OCR engine once approved, run the harness on the photos, report real numbers.

### 2026-10-15 · agent · A0-A2 · done
Built the Agent engine in `suite/agent/`: tool registry with four tiers (act tools refuse to run without an
approval step), append-only audit log (arguments hashed, memory and IndexedDB stores), call and spend limits
with a kill switch, the agent loop, and an adapter for the real model API that tests never call. Read tools:
order search and stats, repeat customers, shipping cadence and destinations, weekly summary, inventory
search, price suggestions (uses the Scan price engine). Draft tools: restock list, support reply drafts
(never sent), inventory CSV compare and upload-file drafts for eBay, Whatnot and Mana Pool. About 320 made-up
orders over six months. 12 scripted scenarios in `docs/suite/AGENT-EVAL.md`.
Numbers: 40 Agent tests pass, 12 of 12 scenarios pass, all offline; root `npm test` 17 suites pass; no real model call was made; $0 spent.
In `cd suite && npm test`, 1 test fails: the extension's browser test ("fixture page message reaches the service worker"). It fails the same way on a clean `main` in this sandbox, so it is not from the Agent. Because of it I did not merge; the PR is open for the Builder.
Needs Builder: merge the PR after checking that browser test on a machine with a working browser. (Later: a server-side proxy so the model key never reaches a browser; wiring into the
extension side panel.)
Needs owner: nothing now. To measure a real model later, a small budget and an API key (owner decision).
Other marketplaces' CSV columns are guesses until real export files are supplied.
Next: measure with a real model once allowed; automations (cron with approval gates); supply deal-hunting.

### 2026-10-15 · hq · board redesign · done
Rebuilt the owner's board (`docs/shipper-hq.html`) with top tabs: Now, Roadmap, Suite, Library, Meetings, Ideas. Now shows the newest Claude posts, one Next up card and the open tasks in priority order (security first). Roadmap, Suite (product cards, milestones, upload box), Library (about 50 links), Meetings (call notes saved to `meetings`) and Ideas (24 ranked, Do this / Not now saved to `ideas`) are new. Added tasks B13, G12, S4, S5. The owner's ticks and notes (`progress`, `inbox`) are read and written as before; nothing was deleted.
Numbers: no console errors and no sideways scroll at 820x1180, 1180x820 and 390x844, in dark and light.
Needs Builder: write document `suite/status` in the board's database each morning: `{ updatedAt, products: [{ id: "scan"|"ext"|"agent"|"sites", name, state, milestone, line }], log: [{ at, who, line }] }`. Until then the Suite tab shows the Oct 15 starting facts.
Needs owner: none beyond the new tasks B13 and G12 on the board.
Next: none.
### 2026-10-15 · extension · X1 · done
Adapter framework in `suite/extension/src/adapters/`: one interface (`detectPage`, `readOrders`, `fillTracking`,
`openImport`, `attachFile`) plus `selfTest()` that lists selectors that stopped matching. All selectors live in
`selectors.js`. Dry run is the default and only logs; even with it off, nothing is submitted or uploaded (the seller
clicks Save / Upload). `guardedAdapter` hands out nothing unless the flag is on and `TOS_OK` is true. Built and tested
only on invented pages (`test/fixtures/`), run in real Chromium. Still off; nothing on TCGplayer.
Also fixed a real race from X0: the page's first message could arrive before the bridge script finished loading
and be lost; the loader now queues and replays early messages.
Numbers: `cd suite && npm test` 76 pass, 0 fail; root `npm test` 17 suites pass; browser tests passed 3 of 3 runs.
Needs Builder: none new.
Needs owner: saved pages are the blocker for X2 (and X2 is blocked by "TOS OK" anyway). From a logged-in browser,
File > Save Page As > "Webpage, Complete", for: Orders list, one order, "mark as shipped" form, Import CSV page,
Export Shipping dialog. Blur or change buyer names and addresses first. Selectors are guesses until then.
Next: X3 (Agent side panel shell) is allowed; X2 waits for "TOS OK". Stopping here to save the owner's weekly limit.

### 2026-10-15 · hq · board follow-up · done
Suite tab now reads the real `suite/status` document (product `milestone` text picks the current checklist step). Granola step now says to find Granola in the connector directory (custom address only as a fallback).
Needs Builder: none
Needs owner: none
Next: none

### 2026-10-15 · builder · morning check · done
All four sessions share the owner's one usage limit. It rejected everything at about 8:40 PM PT (resets 6:50 AM UTC); `scan` and `hq` stopped before doing work and were re-started this morning. State at 6:35 AM PT: `extension` X0 merged (#145), now on X1; `agent` running A0 (nothing pushed yet); `scan` re-started on S1; `hq` re-started on the board redesign. Production is healthy (0 server errors in 24h; Extension X0 deployed with no effect on the site).
Needs Builder: from `extension`: wire the web app to the extension later (post-message shape is in `suite/extension/README.md`); remove the localhost match before the first Web Store submission.
Needs owner: read `docs/suite/TOS-NOTES.md` and say yes or no to emailing TCGplayer (board task S2); saved pages from his own TCGplayer account for X1 (board task S4b).
Next: review PRs from `agent`, `scan` and `hq`; keep Builder turns short.

### 2026-10-15 · extension · test reliability · done
Answering the Builder's note: the browser tests now run the same in every shell. The child process gets an allow-listed
environment (PATH, HOME, TMPDIR, CHROMIUM_PATH, PLAYWRIGHT_PATH, PLAYWRIGHT_BROWSERS_PATH) instead of a copy of ours, so
proxy variables, NODE_OPTIONS, npm_config_* and the runner's own variables no longer reach it. Chromium starts with
`--no-proxy-server`. On a timeout the failure message now says so and prints the last 30 lines of the child's output.
Numbers: with fake proxy variables and `NODE_OPTIONS=--max-old-space-size=8192` set, `cd suite && npm test` 76 pass, 0 fail;
under `env -i PATH HOME npm test` 76 pass, 0 fail; `cd suite/extension && npm test` 33 pass. I could not reproduce the failure
in my sandbox before the fix either, so the cause in the Builder's sandbox is unconfirmed; if it still fails there, the new
timeout message will show why, and the fallback is to move the browser tests to `npm run test:e2e`.
Needs Builder: re-run `cd suite && npm test` in your sandbox and tell me if it is green.
Needs owner: none
Next: X3 (Agent side panel shell) when there is room.

### 2026-10-15 · hq · X posts tab · done
Added an "X posts" tab to the board. It reads collection `xposts`; the owner taps Copy / Open in X, posts himself, then taps Mark posted (or Skip). Five drafts for Oct 15 are in.
Needs Builder: add this to the morning routine, no later than 7 AM PT: write 3 to 5 new post drafts into the board's database, collection `xposts`, one document per post, id `YYYY-MM-DD-N`: `{ date: "YYYY-MM-DD", order: N, status: "draft", text, note? }`. Under 280 characters, plain words, true claims only (no prices or dates not decided, nothing about Pitney Bowes), no emoji walls, no engagement bait. Never set status to posted; only the owner does. Never post anything yourself. The owner's message "more x posts" in the inbox means write extra drafts.
Needs owner: none
Next: none

### 2026-10-15 · extension · hardening · done
Owner asked to make the extension bullet proof. Added: a 64 KB cap on any record sent through the bridge (and
refusal of records that cannot be serialized); fuzz tests (junk of every type, and good messages with each field
broken, never throw and are never accepted); browser checks that a page on a non-allow-listed origin gets no answer
at all, that the popup, side panel and settings page load with zero errors, and that switching a TCGplayer flag on in
Settings saves it but leaves the module locked.
Numbers: `cd suite && npm test` 139 pass, 0 fail (also under `env -i PATH HOME`); root `npm test` 17 suites pass;
the browser tests passed 10 of 10 repeated runs in a clean environment.
Not covered (honest list): real Chrome with a real signed-in profile; Edge/Firefox; the side panel opening from a click;
anything on real TCGplayer pages (selectors are still guesses until saved pages arrive).
Needs Builder: none. Needs owner: the saved TCGplayer pages listed in the X1 entry.
Next: X3 when there is room.

### 2026-10-15 · hq · board next steps · done
Ideas tab now has 34 ideas, 11 new with sources (TCGplayer fee calculator and explainer, USPS Dec 17 holiday cutoff, pay-per-label plan, case study, shop kit, comparison pages and more). Roadmap tab shows the Suite milestones with live status from `suite/status`. Open owner tasks were cut to one why line and at most 4 steps. Re-checked at 820x1180, 1180x820 and 390x844 (dark and light): no errors, no sideways scroll. Drafted `docs/suite/SITES-PLAN.md` (one site per product, page lists, what the owner must do). Domain lookup (read-only, nothing reserved): tcgspeedscan.com, tcgspeedagent.com and tcgspeedsuite.com are free today.
Numbers: OpenRush keyword research was out of credits (402), so no search-volume numbers are claimed; ideas cite the TCGplayer fees page, the USPS holiday page and repo docs. The Uline 5 to 10% rate is from a third-party listing and is marked "confirm".
Needs Builder: none
Needs owner: say yes or no to buying the three domains in SITES-PLAN.md (the only step that costs money).
Next: none
