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

### 2026-10-15 · scan · S1 finish + S2 + polish · done (reading engine still open)
Added: one-tap price presets (5% under market, at market, match lowest, 10% under, skip bulk), a static-site build
(`node suite/scan/build.js`, 130 KB, tested), a rendered-synthetic-card test of the card finder (measured: found 100/100
up to 5° tilt, 95/100 at 10°, about 2-3 ms per frame; synthetic only), `docs/suite/SCAN-COVERAGE.md` (TCGplayer id coverage
per game: all unconfirmed), and a one-minute "try it" in the README. Undo, tap-to-fix choices, auto-accept and
haptic/sound were already in. Still no real accuracy number: no text reader, no real photos.
Numbers: Scan tests 59 pass offline.
Needs Builder: approve vendoring the WebAssembly OCR build (still the one thing blocking real S1 numbers). Check whether
`cd suite && npm test` is green on main now (an extension e2e test timed out in my sandbox).
Needs owner: about 50 phone photos of real cards (SCAN-EVAL.md); a real TCGplayer export.
Next: when the engine is approved, plug it in and run the harness on the photos.
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

### 2026-10-15 · scan · look and live scan · done
Owner asked for the same design as TCG Speed Shipper, live camera streaming, and photo upload. Done: dark top bar with
mono tabs (Add / List / Price rule), cream page, serif headings, green gradient buttons, same fonts (own copy, OFL) and
tokens; live camera that watches frames, waits for a card to hold still, reads it once, then waits for the next card
(`core/live.js`, tested); photo upload with drag-and-drop, several at once; box drawn over the live video. Checked at 390px
and 1280px with a fake camera and a synthetic photo; no console errors. Reading text still needs the OCR engine, so live
and upload find the card but cannot yet name it (with a stand-in reader they add the card correctly).
Numbers: Scan tests 64 pass offline.
Needs Builder: approve the WebAssembly OCR build (still the blocker for naming cards).
Needs owner: about 50 phone photos of real cards; a real TCGplayer export.
Next: OCR engine, then measure on the photos.
### 2026-10-15 · hq · board next steps · done
Ideas tab now has 34 ideas, 11 new with sources (TCGplayer fee calculator and explainer, USPS Dec 17 holiday cutoff, pay-per-label plan, case study, shop kit, comparison pages and more). Roadmap tab shows the Suite milestones with live status from `suite/status`. Open owner tasks were cut to one why line and at most 4 steps. Re-checked at 820x1180, 1180x820 and 390x844 (dark and light): no errors, no sideways scroll. Drafted `docs/suite/SITES-PLAN.md` (one site per product, page lists, what the owner must do). Domain lookup (read-only, nothing reserved): tcgspeedscan.com, tcgspeedagent.com and tcgspeedsuite.com are free today.
Numbers: OpenRush keyword research was out of credits (402), so no search-volume numbers are claimed; ideas cite the TCGplayer fees page, the USPS holiday page and repo docs. The Uline 5 to 10% rate is from a third-party listing and is marked "confirm".
Needs Builder: none
Needs owner: say yes or no to buying the three domains in SITES-PLAN.md (the only step that costs money).
Next: none
### 2026-10-15 · extension · X3 and extras · done
Agent side panel shell: chat, a "practice mode" banner, and approval cards for `act`-level actions (Approve / Deny; only a
click answers, once). It speaks a small checked protocol (`src/agent/protocol.js`) through a transport. Today the transport is a
practice one on made-up data. Everything is added as plain text, never as markup. Also: Scan uploader module skeleton
(`src/modules/scan-uploader.js`: checks the CSV, attaches it to an import page, never presses Upload; off); a popup that shows
plain-words status per helper; a Settings page with a sentence for each switch; and an email draft to TCGplayer in `docs/suite/TOS-NOTES.md`
(not sent, no recipient chosen). TCGplayer helpers are still locked.
Numbers: `cd suite && npm test` 151 pass, 0 fail (also under `env -i PATH HOME`), root `npm test` 17 suites pass; side panel, popup and settings are exercised in real Chromium.
Needs Builder: the panel cannot import `suite/agent/` (an extension cannot load files outside its folder, and the Agent uses
`../shared`). To connect the real Agent: add a transport that implements `send(msg)` / `onEvent(fn)` with the messages in
`suite/extension/src/agent/protocol.js` (user_message, approval; text, tool_call, approval_request, done, error). Either a server
proxy (matches PLAN 4.3: no key in the browser) or a bundled copy of the loop. Your call; `loop.js` would need to emit those events
and call `ctx.approve` through the panel.
Needs owner: choose where to send the TCGplayer email in `TOS-NOTES.md` and send it yourself (or ask me to polish it); the saved pages.
Next: X2 stays off until "TOS OK".
### 2026-10-15 · agent · A3 + analytics depth + A4 groundwork · done
Did the Builder's list in order. (1) A3: automations (`automations.js`, DATA-MODEL shape, cron schedules, approval
modes always / first-run / never, disabled ones never run, kill switch and limits still apply) and a supply deal finder
(`deals.js`, allow-list of sources, made-up feed, never fetches or buys). (2) Chart-ready numbers (`report.chart`: orders
per week, destinations, weekday, buyer mix), a plain-words weekly summary draft, and three reply tones (friendly, formal,
brief). (3) `pricing.suggestBatch` and `pricing.rules` on top of the Scan price engine; they only suggest. (4) `protocol.js`:
side panel messages in the extension bridge's shape (ask, approve, stop, resume, limits, audit; only our own extension is
trusted; one conversation at a time; approvals time out as "no"), and `docs/suite/AGENT-PROXY.md` (limits, key handling,
cost per run). (5) `AGENT-EVAL.md` now lists all 24 scenarios.
Numbers: 68 Agent tests pass, 24 of 24 scenarios pass, offline; no real model call; $0 spent.
Cost estimate (assumed prices, not measured): about 5 cents per run. That is more than Base brings in per month if used
daily, so the doc proposes Premium only with a daily and a monthly cap.
Needs Builder: (a) the proxy route, a usage table and kill switch, as listed at the bottom of `AGENT-PROXY.md`;
(b) the extension session wires `suite/agent/protocol.js` to `chrome.runtime` and the side panel.
Gap I found: `support.draftReply` puts the buyer's first name in its result, which would reach a real model. Fix before
any real-model use: return `{{first_name}}` and fill it in on the device. Logged in the proxy doc.
Needs owner: decide the proposed limits in `AGENT-PROXY.md` and whether the Agent is Premium only. Nothing else.
Next: measured run with a real model (needs a key and a small budget from the owner); event triggers for automations.

### 2026-10-15 · hq · Suite HQ · done
Renamed the board "Suite HQ" (same address, owner data untouched). Library now opens with Plans: Growth plan, Marketing plan, Google Ads kit (all four ad groups with Copy buttons, built from `docs/google-ads/ALL-AD-COPY.txt`), Suite plan, and SEO and Reddit ads, each a short summary that expands. Pitney Bowes guide and meeting notes link from there. New product dropdown (All, Shipper, Scan, Extension, Agent) and milestone dropdown (S0 to S3, X0 to X3, A0 to A4) under the tabs: they filter Now, Roadmap, Suite and Ideas; a milestone shows what it covers, its status (from `suite/status`) and its tasks. Re-checked at 820x1180, 1180x820 and 390x844: no errors, no sideways scroll.
Needs Builder: the milestone status comes from the product `milestone` text in `suite/status` (it picks the last S/X/A code it finds, e.g. "S0 done, S1 next" gives S1 as next). Keep that wording style. Product ids it understands: shipper, scan, extension (or ext), agent, sites.
Needs owner: none
Next: none

### 2026-10-15 · extension · Agent panel on the real protocol · done
Rebuilt the side panel on `suite/agent/protocol.js` (read CONTEXT.md first). The panel now sends `tcgss-panel` requests
(`agent.hello/ask/approve/stop/resume`) and handles `tcgss-agent` responses and events (`agent.progress`,
`agent.approval-needed`, `agent.answer`, `agent.stopped`), all checked before use; a test fails if our mirror drifts from the
upstream constants. What the owner sees: a goal box ("What do you want done?"), a visible plan, approval cards (what, with every
argument as plain text; Approve / Deny, once), a Stop button that always works (and Resume), and a "what I remember" list with
Forget. Practice mode on made-up data via a fixture transport that follows the same protocol. TCGplayer modules still off.
Numbers: `cd suite && npm test` 196 pass, 0 fail (also under `env -i PATH HOME`), root `npm test` 17 suites pass; the whole
panel flow (plan, card, approve, forget memory, stop, resume) runs in real Chromium.
Needs Builder: the protocol has no plan or memory yet. The panel supports these PROPOSED additions and shows them only if `hello`
lists them in `types`: event `agent.plan` `{steps:[{text,state: todo|doing|done|skipped}]}`; event `agent.memory`
`{items:[{id,text}]}`; requests `agent.memory.list` and `agent.memory.forget {id}`. Also: `agent.progress` today carries only
`{tool, ok, denied}`; a short plain-words `summary` and the `why` / `undo` text for approval cards would help the "what, why, undo" card
in CONTEXT.md. The real wiring (service worker <-> `createAgentService`, and the server proxy) is yours; the transport shape is
`request(msg) -> Promise<response>` plus `onEvent(fn)`.
Needs owner: none new.
Next: nothing blocked on me except X2 ("TOS OK") and the saved pages.

### 2026-10-15 · hq · agents panel and protect list · done
Read `CONTEXT.md`. Suite tab now opens with an Agents panel: each chat's goal, its current milestone and its last log line, all from `suite/status`. Roadmap tab now has a Protect list: nine business risks, what guards each, a one-line status and the next action (statuses follow the owner's ticks, e.g. leaked keys, sign-up check, uptime alert, statement name). Milestone status now understands text like "X1 done, X2 waits for TOS OK, X3 next" (X2 shows as waiting). Re-checked at 820x1180, 1180x820 and 390x844: no errors, no sideways scroll.
Needs Builder: (1) the Agents panel matches log lines by the `who` field: scan, extension, agent, hq, builder. Keep those names. (2) Two Protect rows are unverified and say so: Backups ("Not checked") and Usage limit. Please confirm the Supabase backup plan and a restore test, then tell me the status to show.
Needs owner: none
Next: none

### 2026-10-15 · scan · OCR engine, CSV check, demo · done (PR open for review)
Vendored Tesseract.js 5.1.1 (Apache-2.0) with English model into `suite/scan/vendor/` (11 MB, `VENDOR.md` has versions,
sources, hashes), self-hosted, loaded on first use, cached for offline. Plugged into the live camera and photo upload
behind the same interface as the test stand-in. Parser: One Piece codes no longer mistaken for Yu-Gi-Oh!, tolerant of a
bullet read as a symbol; unit tests on invented realistic samples for all four games. CSV column map moved to one file
(`core/csv-format.js`) plus a "CSV check" tab that compares a pasted real export header and says what differs. Demo path:
20 synthetic card pictures in `suite/scan/sample-photos/` work with no camera. Batch uploads now keep every "tap the
right one" card on screen. Static build includes the reader.
Numbers (SYNTHETIC cards, 96 sample cards, headless Chromium on the sandbox CPU): right card first 100% at 700 px card
height, 100% at 450 px, 93.8% at 300 px; auto-accepted 64.6% with 0 wrong; median 117 ms and 90th percentile 158 ms per
card. 20-photo demo through the app (no game chosen, about 7 s total): 12 added automatically, 8 asked for a tap, 0 failed. Scan tests 68 pass offline.
Unverified: everything on real photos (accuracy, speed on a real phone, glare, foils, sleeves, tilt); TCGplayer CSV columns;
provider response shapes; the English model's licence wording (Apache-2.0 per the Tesseract project, confirm).
Needs Builder: review and merge. Root `npm test` and `cd suite && npm test` were green on my run.
Needs owner: about 50 phone photos of real cards (list in SCAN-EVAL.md); one real TCGplayer export (paste its first line in the CSV check tab).
Next: when the photos arrive, run the harness on them and report real numbers; then Yu-Gi-Oh!/One Piece tuning.

### 2026-10-15 · builder · evening restart and protect pass · done
The weekly limit no longer blocks (every session shows "allowed" as of 23:10 UTC). `hq` was already running; I re-woke `scan`, `agent` and `extension` with next goals: Scan has the OCR engine approved (vendor Tesseract.js into `suite/scan/vendor/`); Agent adds the plan, memory, summary, why and undo messages the panel asked for, then the "week in a shop" scenario; Extension makes practice mode run the real Agent engine in the service worker (vendored copy with a drift test). Each runs a short batch, opens a PR titled "Suite: ...", logs here, and stops.
Protect pass (all merged or applied, production healthy): visitors could fake `x-forwarded-for` to skip every per-IP limit, now fixed (`x-real-ip`, then `req.ip`); npm audit found 1 critical and 3 moderate (proxy-addr, qs, body-parser, express), fixed; `anon` and `authenticated` had full privileges on 6 tables (row level security blocked them), now revoked; the database schema was not in git and the Supabase free plan has no backups, so `docs/db/schema-2026-10-15.sql` now holds it (replayed in a scratch Postgres) and postage go-live is gated on Supabase Pro.
Numbers: root `npm test` 17 suites pass; `cd suite && npm test` 196 pass at the last run; Railway deploy SUCCESS, 0 errors since.
Needs HQ: (1) Protect list, "Backups": state "Free plan: no backups yet. Schema saved in the repo." next "Supabase Pro ($25 a month) before postage balances go live." (2) Protect list, "Usage limit": state "Running; each session works in short batches". (3) X posts: 5 drafts for Oct 16 are in `xposts`; the Builder's morning run now writes them daily.
Needs owner: none new.
Next: review PRs from `scan`, `agent` and `extension`; build the Agent server proxy once the protocol settles.
