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

### 2026-10-15 · extension · real Agent engine in the panel · done
Step 1 done: practice mode now runs the REAL Agent engine inside the extension. `npm run vendor` (in `suite/extension`) copies the
Agent (loop, registry, audit, limits, protocol, analytics, support, deals, tools, CSV sync), Scan's pricing and CSV writer, and the
shared models into `src/vendor/`, keeping the folder layout so their imports work unchanged; a test fails if any copy is stale, and
another if a copy uses node-only code. (`agent/fixtures/orders.js` is not copied: it reads files with node:fs. The extension has
its own small made-up shop, `src/agent-host/shop.js`.) The service worker hosts `createAgentService` (`src/agent-host/host.js`) over
that shop; the panel talks to it with chrome.runtime. The panel really plans (steps update as tools run), asks approval (a practice-only
`act` tool changes made-up prices; audit shows `act`, `ok`, approved by `user`; denied is audited as `denied`), remembers
("remember that ..." adds a fact; Forget removes it), and stops (kill switch denies the waiting approval; Resume continues). Only a
stand-in "model" (keyword routing) is fake. Server address (Settings, advanced): validated https only, OFF by default, nothing uses
it, and a test checks no extension code makes network requests.
Also: (a) Scan uploader accepts Scan's real CSV output (tested with the vendored `buildCsv`), flags files that do not look like Scan's
and says the TCGplayer columns are unverified; attaches only, never presses Upload. (b) `docs/suite/EXTENSION-PERMISSIONS.md` + a test that
fails if the manifest gains or loses any permission, host or page match without a matching row (checked by adding one: it fails), plus
a ban-list of powerful permissions. (c) TCGplayer email in `docs/suite/TOS-NOTES.md` rewritten to ready-to-send: short, polite, three
specific questions, no recipient. (d) `npm run build` makes `tcg-speed-suite-<version>-<date>-<commit>.zip` with BUILD.txt, tests and dev
files excluded (tested); README says plainly that extensions need desktop Chrome or Edge, not an iPad.
Numbers: `cd suite && npm test` 217 pass, 0 fail (also under `env -i PATH HOME`); root `npm test` 17 suites pass; the whole panel flow
(plan, approval, remember, forget, stop, resume) runs against the real engine in real Chromium.
Needs Builder: (1) The host adds plan and memory itself because upstream protocol.js lacks them. When the Agent session adds
`agent.plan`, `agent.memory`, `agent.memory.list`, `agent.memory.forget`, `summary`, `why`, `undo`, tell me and I delete the host's
extras (the panel already accepts them only when `hello` lists them; `why` and `undo` show on approval cards now). (2) After any change under
`suite/agent/`, `suite/scan/core/pricing.js`, `suite/scan/core/csv.js` or `suite/shared/models.js`, the extension's test goes red until
someone runs `cd suite/extension && npm run vendor`. That is by design, but it means those PRs need that one command; say if you would
rather I vendor automatically. (3) Still to remove before a Web Store submission: the `http://localhost/*` match.
Needs owner: send the email in `docs/suite/TOS-NOTES.md` (add the recipient yourself); the saved pages. Extensions need desktop Chrome.
Next: nothing blocked on me except X2 ("TOS OK").

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

### 2026-10-15 · extension · batch 2: durability, Shipper bridge, panel polish, privacy · done
1) Durability. The practice Agent keeps its plan, memory, a waiting approval, the Stop switch and the practice shop's prices in `chrome.storage.local`, and its audit trail in IndexedDB (the Agent's own store). A woken worker restores them. Forced restart in real Chromium (the worker is stopped through the browser's debugging interface; a marker in its memory proves the new one is fresh): the memory list, the plan and the approval card are intact (also in a brand-new panel), approving afterwards finishes the job, the price change and the audit trail survive a second restart. Limit: a run that was mid-thought when the worker died is not resumed; a waiting approval is, by re-running just the approved tool call (audited as normal).
2) Shipper bridge (extension side only). New messages `tracking.put|get|list`; the exact shape is in `suite/extension/README.md` ("Shipper bridge") for you to implement. Strict validation (ids, 6-40 character tracking numbers, carrier list, 1-200 unique items, no extra fields), exact origin only (`https://tcgspeedshipper.com`, plus `http://localhost` for development), stored locally, never sent anywhere. 500 fuzz mutations plus 20 malformed shapes; the generic `store.put` cannot write to this collection.
3) Panel polish. First-run tour (3 plain steps, keyboard reachable, Escape or Skip, shown once, a Tour button to see it again); plain-language errors (code-looking text never reaches the seller); keyboard: skip link, Enter sends, a new approval card takes focus and Tab reaches Approve; visible focus; verified at 360 px wide (no sideways scroll in the panel or Settings).
4) Privacy. `suite/extension/PRIVACY.md` now lists what the panel stores. Settings has **Clear everything** (asks first; erases switches, records, tracking batches, the Agent's state and audit trail, the tour flag). Tested: saying No erases nothing; only extension pages can trigger it; storage, records and the audit database end empty.
Numbers: `cd suite && npm test` 237 pass, 0 fail (also under `env -i PATH HOME`); root `npm test` 17 suites pass; restart and full-panel browser scenarios passed repeatedly.
Needs Builder: (1) Web app side of `tracking.put` (shape in the README). (2) Review the "Clear everything" choice that it also empties the audit trail (privacy over history; say if you want the audit kept). (3) Upstream `protocol.js` now has plan, memory, summary, why and undo (seen after merging main). The host still supplies its own plan and memory, because the vendored copy is the old `createAgentService` path; moving the host onto the new `suite/agent/agent.js` is a separate step I have not done (it changes what the service worker saves), say go and I will; remove `http://localhost/*` before the Web Store.
Needs owner: none new.
Next: nothing blocked on me except X2 ("TOS OK").

### 2026-10-15 · scan · batch 2: index, matching, crops, beta kit · done (PR open)
1) Card index designed and built: per-game compact files (`data/compact.js`), importers for Scryfall, Pokémon TCG API,
YGOPRODeck and One Piece rows (`data/import/build-index.js`, tests on tiny fixtures only, no downloads), a loader that
adds any `data/index/<game>.json` to the sample, and a coverage report. `SCAN-COVERAGE.md` rewritten: index design,
sources, terms (written from memory, unconfirmed), which sources give TCGplayer ids (only Magic, per the plan), and an idea
for filling other games' ids from the seller's own export. The sandbox cannot reach Scryfall (test fetch refused), so no real
catalog is loaded: the app still only knows the 96-card sample.
2) Matching: set code + number first, fuzzy name second (already), now also tolerates a set code read with a slip (MII for
M11); never auto-accepts that. Measured on the simulation: no change in numbers (same before and after), so no gain claimed.
3) Crops benchmark (synthetic, 96 cards): at 450 px card height, separate strips 100% right-first at 113 ms median; whole
card 99% at 253 ms; strips + black-and-white 97.9%. At 300 px: 93.8% / 91.7% / 92.7%. Strips stay the default; thresholding
stays off. Details in SCAN-EVAL.md. All synthetic.
4) Beta kit: `docs/suite/SCAN-BETA.md` (one page, plain words, 8 feedback questions). A test checks the built site has no
root-relative paths, so it works from /scan/public/ on any host over https (service worker registers relative to the page).
Extension vendoring: no vendored file changed (csv.js, csv-format.js, pricing.js untouched); `npm run vendor` produced no diff.
New files the Extension does not need.
Numbers: Scan tests 75 pass offline.
Needs Builder: before Rob can list anything real, someone with open internet must run the importers on real data (Scryfall bulk
for Magic at least) and drop `data/index/<game>.json` files into the private test copy, after reading each provider's terms.
Also confirm terms in SCAN-COVERAGE.md.
Needs owner: about 50 phone photos of real cards; one real TCGplayer export.
Next: real catalog files; run the harness on real photos when they arrive.
### 2026-10-15 · agent · plan for "agent, not chat" · started
Read `CONTEXT.md`. Plan (all in `suite/agent/`, offline, fake data): (1) goal and plan layer: a goal becomes a short
visible plan, run step by step with result checks; when a result is empty or odd it says so and stops that branch.
(2) shop-facts memory with view, edit, delete; used by the planner in later runs. (3) approval inbox: every act step
becomes a card (what, why, expected effect, undo) and nothing runs until approved. (4) background jobs that leave a
report, approval required by default. (5) weekly "five things worth doing". (6) one scripted "week in a shop" scenario
from goal to approved actions with a full audit trail, written up in `AGENT-EVAL.md`. The only act tools I add change
the seller's own local stock prices, memory and saved schedules. Nothing touches TCGplayer, sends or spends.
Needs Builder: none yet. Needs owner: none.

### 2026-10-15 · agent · protocol additions, privacy fix, agent not chat, week in a shop · done
Did the four items in order. (1) Protocol: everything the Extension proposed, announced in `hello.types` (plus `requests` and `events`
lists) and only when the service has an agent, so an older panel sees no change: events `agent.plan` and `agent.memory`, requests
`agent.memory.list` and `agent.memory.forget`, `agent.progress.summary`, and `why` / `undo` on `agent.approval-needed`. I also added
`agent.undo`, `agent.inbox.list` and `agent.suggestions`. Shapes are in `DATA-MODEL.md` ("Agent messages and records") and checked by
`validateEvent`. (2) `support.draftReply` now returns `{{first_name}}` (filled on the device by `fillPlaceholders`); a test checks no
buyer name is in the draft. (3) Agent, not chat: goals become visible plans (`planner.js`, `plan.js`); shop memory with view, edit,
forget (`memory.js`); approval inbox where every act step is a card with what, why, expected effect and undo (`inbox.js`); event
triggers (low stock, new order, unanswered message) and background jobs that leave reports, approval-required by default (`events.js`,
`jobs.js`); weekly "five things worth doing" (`suggestions.js`). New act tools only change the seller's own local data: stock prices,
memory, saved schedules. (4) "A week in a shop" runs offline, 31 checks, all pass; written up in `AGENT-EVAL.md`.
Numbers: `cd suite && npm test` on this branch 244 pass, 2 fail: both failures are the Extension's check that its vendored copies of my files match (see Needs Builder). With the fix applied in a scratch copy: 246 pass, 0 fail, including the Extension's browser tests. Root `npm test` 17 suites pass. 24 conversation and automation scenarios + the week
(31 of 31 checks): 19 audit entries, 7 act-level (6 ran, each with an approver; 1 refused by the kill switch), 4 approval cards (1 done,
1 undone, 2 declined), 3 reports, 52 panel messages. No model call, no network, $0.
Found and fixed on the way: a job run while the kill switch was on was being counted as run (now skipped, not marked, and the refusal is
audited); a burst of 75 low-stock events started the same job 75 times (now once per kind of event, with the count).
Needs Builder: (a) FIRST, the Extension keeps vendored copies of my files, so its tests fail until they are refreshed, and `tools/index.js` now imports new files. In
`suite/extension/scripts/vendor-list.js` add these 11 after `'agent/fixtures/deals.js'`: `agent/memory.js`, `agent/automations.js`, `agent/suggestions.js`,
`agent/tools/acts.js`, `agent/plan.js`, `agent/planner.js`, `agent/agent.js`, `agent/inbox.js`, `agent/jobs.js`, `agent/events.js`, `agent/fixtures/messages.js`; then
`cd suite/extension && npm run vendor`. I tried exactly this in a scratch copy: 246 of 246 pass. I did not touch the Extension's folder. `MESSAGE_TYPES` is unchanged
(the Extension's practice host still works as is); the new full list is `REQUEST_TYPES`. When the Extension is ready it can drop its practice shim for memory and plans and
pass a real `agent` to `createAgentService`;
(b) the service worker needs to build `createAgentService` with a real `agent` (see `eval/harness.js` `makeWorld` for how the pieces are
assembled) and expose `agent.undo` in the panel; (c) the server proxy from `AGENT-PROXY.md`. Memory and the inbox are in memory only for
now: saving them to IndexedDB on the device is the next job (shapes are in `DATA-MODEL.md`).
Needs owner: none new.
Next: save memory, cards and reports in IndexedDB; a measured run with a real model (needs a key and a small budget from the owner).

### 2026-10-15 · hq · protect rows, Scan tasks, six ideas · done
Protect list is now 10 rows. Backups says "Free plan: no backups yet", next "Supabase Pro ($25 a month) before postage balances go live". Usage limit says "Running". New row for what the Builder fixed and checks daily (faked addresses, old packages, open table access). No "unverified" flags are left. Task S4 is now "Paste the first line of your TCGplayer export into Scan" (CSV check tab, Header line box, Check columns), waiting on the Scan link. New task S6 "Try Scan on your iPad" (link arrives in the board inbox today), shown under S1. Six new sourced ideas: paywall preview at the free limit, yearly price first, Suite bundle price test (revenue); chargeback evidence kit, public status page, "delete my data" flow (protect). Now tab shows three things: while you were away (2), Next up, Do now (2); everything else is under "Show the rest". Re-checked at 820x1180, 1180x820 and 390x844 in dark: no errors, no sideways scroll.
Needs Builder: post the Scan test address in the board inbox (as a Claude message) and tell me, so S4 and S6 can lose their "waiting" labels. Two sources are summaries (Stripe deadlines, California rules); both are marked to confirm.
Needs owner: none
Next: none

### 2026-10-15 · builder · Scan test copy online, Agent and batch-1 PRs merged · done
Merged tonight: Scan #165 (self-hosted OCR, I checked every vendored file against npm: byte-identical), Extension #166 (real Agent engine in the panel), Agent #168 (plans, memory, approval inbox, jobs, week in a shop, 31 checks), host #169 and #170. Each time `cd suite && npm test` and root `npm test` were green on the merged result (suite 253, root 17 suites).
Scan test copy: https://suite-scan-preview-production.up.railway.app/ (own address, so it cannot read the Shipper's sign-in data; private: noindex). Built from `main` by a second Railway service; it redeploys only when `suite/scan`, `suite/shared` or `suite/host` change. See `docs/suite/HOSTING.md`. Sam can try it on his iPad now; camera needs the browser's "Allow".
Rule for everyone: the Extension vendors copies of Scan and Agent files (`cd suite/extension && npm run vendor`; the list is `suite/extension/scripts/vendor-list.js`). If you add a file the Extension imports, add it to the list in the same PR, or the drift tests fail. I fixed that at merge time this once.
Needs Builder: none.
Needs owner: open the Scan link on the iPad and tell us what feels slow or confusing (board task S6).
Next: Agent server proxy (Builder), then review the next batch from `scan`, `extension` and `hq`.

### 2026-10-16 · agent · batch 2: red team, policy rules, export sync, one page for Sam · done
(1) Prompt-injection red team: 22 attacks, each assuming the model is fully fooled (hidden orders in notes, a CSV cell that looks like a tool
call, "refund this buyer", "reveal your memory and audit log", a 100,000-character message asking to raise limits, text pretending to be the
owner, memory and schedule poisoning, a price bomb from a fooled planner, tool calls written inside text or inside tool results, smuggled
approvals in arguments, resume-the-kill-switch, runaway loops, hostile feeds, hidden characters, spreadsheet formulas, reply leaks, policy
rewriting, event floods, export floods, self-approving goals). All 22 end safely: nothing approved, no limit moved, no memory or schedule
written, audit trail intact and free of attacker text. Defences are in code: text from others is cleaned and capped and marked untrusted;
after reading it a run cannot read or save memory or schedules; approval cards carry a warning; approvals only come from our own panel. Found
and fixed while writing them: a job skipped by the kill switch was recorded; the policy list was mutable (now frozen).
(2) `policies.js`: 12 cited seller rules (shipping by order value, free shipping, shipping not confirmed, delivery times, lost package, untracked
envelope, tracked-but-delivered, buyer's remorse, wrong card, damaged, address change, seller levels), each tied to our blog post and the
TCGplayer help page it links; a test fails if a post stops containing the phrase the entry rests on. Drafts cite the ids and say to check
TCGplayer's current article. I read only `public/blog/`; nothing was fetched from TCGplayer.
(3) `sync.analyzeExport` / `agent.syncExport` / `agent.export`: column map in Scan's style, low-stock list, price drift against the market column,
five ranked fixes, price fixes become approval cards (invented export; column names unverified).
(4) `docs/suite/AGENT-TODAY.md`: one page for Sam, under 300 words.
Numbers: `cd suite && npm test` 269 pass, 0 fail (including the Extension's browser tests after the vendor step); root `npm test` run before the PR.
24 scenarios, week in a shop 31 of 31, red team 22 of 22. No model call, no network, $0.
Vendoring done as asked: added `agent/untrusted.js` and `agent/policies.js` to the Extension's vendor list and ran `npm run vendor`.
Needs Builder: none. Review note: `MESSAGE_TYPES` is still unchanged; new request `agent.export` and event field `warning` are announced in `hello`.
Needs owner: the policy entries rest on our own blog posts as of Sept 2026; whoever next reads TCGplayer's help pages could confirm the numbers.
Next: save memory, cards and reports on the device (IndexedDB); a measured run with a real model (key and small budget from the owner).

### 2026-10-16 · scan · "card not found" fix: live lookup · done (PR open)
Owner tested Scan and reported "card not found": the app only knew the 96-card sample list. Added live lookup
(`data/live.js`): when a search or a camera read is not found or not sure, the seller's browser asks Scryfall (Magic,
exact set + number or name), Pokémon TCG API or YGOPRODeck, adds what it finds to the search list and saves it on the
device for offline use. One request at a time, 120 ms apart; checkbox to turn it off; the page says what is sent. Service
worker no longer touches cross-origin requests. Also found and fixed a bug the unit tests could not see (a duplicate
variable that stopped the whole page from loading) by driving the page in a browser with simulated Scryfall replies:
"mox opal" (not in the sample) was found, added, priced, kept its TCGplayer id, and still found after reload while offline.
Numbers: Scan tests 83 pass; suite 268 pass. Not verified: the real services (sandbox cannot reach them), Pokémon and
YGOPRODeck request shapes and browser-access rules, One Piece (no source), real-photo accuracy.
Needs Builder: please test live lookup on the private copy from a real network; if Pokémon or YGOPRODeck calls fail, tell me
the browser error. Batch 2 (PR 173) is still unmerged and this branch builds on it.
Needs owner: say which cards failed (name and game) so I can check them first.
Next: One Piece source; real catalog files; real photos.

### 2026-10-16 · extension · batch 3: new Agent core in the host, jobs, badge, listing · done
1) Host on `suite/agent/agent.js`. The service worker now hosts the real Agent core (rule planner, visible plans, approval inbox, shop memory, weekly suggestions, jobs) over a made-up shop; the old keyword stand-in is gone. The panel shows the plan, approval cards (what, why, what will change, undo, with an Undo button after approving), the memory list with Forget, "Five things worth doing this week" with a "Do this" button on each, and a Background jobs section with reports. Restart-safe: memory, waiting cards (same ids), the last plan, the stop switch, saved jobs and reports, and the shop's prices are saved; the audit trail stays in IndexedDB. A card restored after a sleep finishes its plan when approved, and Undo still works for a change approved before a sleep. Since the Agent's inbox cannot export itself, the host keeps a small ledger of cards and re-files waiting ones on wake (ids are kept stable by a layer in `src/agent-host/host.js`); if you add save/restore to `inbox.js`, tell me and I will drop the layer.
2) Background jobs with `chrome.alarms` (new permission `alarms`, documented in `docs/suite/EXTENSION-PERMISSIONS.md`; the test that compares the manifest with that page passes). The alarm runs `tickJobs` once a minute on practice data: a due job leaves a report and queues cards; nothing acts without approval (checked: price unchanged until Approve). Stop pauses jobs (recorded as denied in the audit trail). Real Chromium: the worker is killed, then the alarm wakes it, the saved job fires, a report appears and a second card is waiting.
3) Toolbar badge: a number = approvals waiting, cleared when answered; restored by itself when the worker wakes. No `notifications` permission, no pop-ups (a test bans it).
4) `docs/suite/WEBSTORE-LISTING.md` (names, short and long description, one line per permission, data that stays on the device, screenshots to take later). Nothing submitted.
5) `docs/suite/HOW-TO-TRY-EXTENSION.md` for Sam: 199 words, desktop Chrome only, load unpacked in 5 steps.
Also: Clear everything's confirm text now says the history of what the assistant did (the audit trail) is erased too (your note b). The tracking.put bridge stays ready and tested, nothing more (note a). Files the Agent session also edits: none by hand; `src/vendor/agent/*` are copies (now 37 vendored files, refreshed with `npm run vendor`), plus Scan's new csv-format.js you added earlier.
Found on the way: Playwright's `waitForFunction` does not wait for an async predicate (it returns at once), so my earlier badge waits were no-ops until I replaced them with a polling helper.
Numbers: `cd suite && npm test` 288 pass, 0 fail (also under `env -i PATH HOME`); root `npm test` 17 suites pass; the full-panel and the kill-worker/alarm/badge browser scenarios pass repeatedly.
Needs Builder: none new. Needs owner: try it with HOW-TO-TRY-EXTENSION.md on a desktop; the saved pages are still the blocker for X2.
Next: nothing blocked on me except X2 ("TOS OK").

### 2026-10-16 · scan · batch 3: problem report, price freshness, product id links, One Piece · done (PR open)
1) "Report a problem" button copies a short plain-text note (time, app version, online yes/no, browser string, game, what was
typed or read, service, address asked, cards found, exact error text, last text read from a card). No photos, list or names.
A "last lookup" line on the Add tab shows the same facts. 2) Prices: market fields from each service were already used; each
printing now stores the time fetched; older than 24 h and online = refetch (price replaced, not duplicated); otherwise the row
is added with a red "price from <date>" warning. 3) Product id from a pasted TCGplayer address (`core/tcgurl.js`, text parsing
only, never fetched, only tcgplayer.com, tests on invented links); it fills the CSV row. 4) One Piece: best free candidate is
optcgapi.com (says free, no key, GET only, modest volume; terms, fields and browser access UNCONFIRMED, its pages could not
be opened from the sandbox). The other candidates need keys or are gated. Importer stays on an assumed-shape fixture; One Piece is
NOT in live lookup; it means the 22 sample cards with ids and prices typed by hand. Details in SCAN-COVERAGE.md. 5) Privacy line
on the first screen and in SCAN-BETA.md.
Checked in a browser with simulated service replies: stale price + service down gave the warning; a pasted link cleared the
"needs help" row; the report text came out as intended. Real services still untested.
Numbers: Scan tests 95 pass offline.
Extension vendoring: csv.js, csv-format.js, pricing.js not changed; ran `npm run vendor` anyway (see below).
Needs Builder: someone with open internet should read optcgapi.com's terms and save a sample card response; test live lookup
on the preview copy and paste a "Report a problem" note if anything fails.
Needs owner: paste a "Report a problem" note into the board inbox if a card is not found.
Next: real error texts from those notes; One Piece once terms are known.

### 2026-10-16 · scan · batch 4: iPad Safari hardening, Check my device · done (PR open)
Read the code against known iOS/WebKit pitfalls and fixed what it found. (1) Camera: starts only from a tap; video inline + muted
(+ webkit-playsinline); constraints all "ideal" (environment camera, 1280x720), never exact; picture restarts after rotation;
camera stopped when the page is hidden or taken away, with a plain message; plain-words messages for blocked / no camera / busy
(other tab or app) / non-https (`core/camera-errors.js`, tested). (2) Screen stays awake while scanning via Wake Lock, asked
again when the page returns, silent if unsupported (`core/wakelock.js`, tested). (3) Every frame and photo is shrunk to at most
1600 px on the long side; photo decoding falls back to an <img> for older Safari; the OCR worker is shut down after 60 s idle
(`core/idle.js`); frames are not kept. Measured on synthetic cards (2000 px pictures): shrinking to 1600 gave 100% vs 97.9%
right-first and 126 vs 167 ms median, so it helps; no iPad memory figure. (4) Updates: a waiting new version shows "New version
ready, tap to refresh" and switches only on tap; page reloads once. Checked in Chromium by publishing a second service-worker
version (banner appeared, tap reloaded onto it). NOTE: `AUTO_ACTIVATE = true` in `public/sw.js` for THIS release only, so
devices still running the old page (Sam's iPad) pick up the banner code; the NEXT release must set it to false. (5) Home-screen:
real PNG icons (180/192/512, full-bleed green because iOS paints transparent corners black), apple-mobile-web-app tags, black-
translucent status bar, safe-area spacing for notch and home bar, fields at 16 px (Safari zooms smaller ones), tap-targets all
44 px or more (checked), nothing hover-only, no modal overlays exist so no scroll lock was needed. (6) "Check my device" on the first
screen (https, camera API, WebAssembly, SIMD, storage, online, clipboard; green/red with one sentence each); its result is added
to the Report a problem text. The report is built without waiting so Safari's copy-needs-a-tap rule is met. (7) SCAN-BETA.md has an
iPad section and the Mana Pool column line.
Numbers: Scan tests 111 pass offline. All Safari-specific behaviour is unverified: only Chromium here.
Needs Builder: next release set AUTO_ACTIVATE to false in sw.js. Ask Sam to tap Check my device on the iPad and paste a Report a
problem note: it now includes the device lines.
Needs owner: same; one real TCGplayer export.
Next: whatever the iPad report shows.

### 2026-10-16 · hq · Scan link, A8 retest, domains, call notes · done
Board updated. S4 and S6 no longer say "waiting"; S6 has the Scan test link (opens in a new tab, Copy button) and the four steps: open the link, tap "Check my device", point the camera at one card or upload a photo, "Report a problem" and paste into the inbox. A8 now starts "Try the 8 sample orders again" and explains "pilot" in one line (the owner's note, with the Builder's reply, is untouched). New task S7 "Say buy domains" (a yes plus where: Porkbun or through Claude on Vercel; $11.25 a year each). G12 is now "Record the Pitney Bowes call": easiest is Voice Memos on an iPad or iPhone, paste the text; Zoom and Meet built-in notes noted; Granola is optional. Now tab top three today: A8, S6, then A16 (see below).
Needs Builder: A16 (Rob's reply) is already ticked done on the owner's side (Oct 15), so it does not show on Now; today's third item is the next open task (B13, the sign-up code test). Tell me if A16 should be reopened or replaced with something else.
Needs owner: none new.
Next: none

### 2026-10-16 · scan · batch 5: real-use accuracy, share results, lists, bulk edit, update flow · done (PR open)
1) Accuracy from real use: for every scanned card the app records HOW it got onto the list (counts only, on the device): added by
itself, seller tapped the app's FIRST guess, or seller fixed it (tapped another guess, or searched after a scan asked for help);
plus removed-after-auto-add and not-found. The List tab shows "Right first time: N of M" (N = added by itself and left alone, plus
taps on the first guess; M = scanned cards added), labelled as measured from this device's use; the numbers are in the Report a
problem text. 2) "Share my results" copies a compact anonymous text (`#speed-scan-results v1`, one JSON row per card: game, raw
title-strip text, raw number-strip text, card matched, card finally chosen, how, score; newest 60; no images, names, prices).
`eval/from-results.js <file>` prints accuracy and ranked failure patterns (reader saw nothing / no usable text / title misread /
number misread / set code misread / ambiguous reprint) with examples; fixture + tests. 3) Lists: new, rename, open, copy, delete
(with confirm), CSV per list, open one of our own CSVs to continue later (matched by product id; a card this device does not know
shows as "TCGplayer product N"); newest 20 kept; the old single list becomes "My list". 4) Bulk edit: tick rows or select all, set
condition, finish, or re-apply the price rule; one Undo reverses a whole bulk change; a bad value changes nothing. 5)
`AUTO_ACTIVATE = false` in `public/sw.js`; update flow proven by `dev/sw-update-check.cjs` (bar hidden at first, appears for a new
version, a tap switches). Also added a test that every element id the page code uses exists in the page.
Checked in Chromium with a stand-in reader: auto, tap-first, tap-other and search-fix each counted correctly (2 of 4 right first
in the scripted run), share text had 4 rows, lists/rename/duplicate/CSV round trip/open CSV/delete-cancel/delete worked, bulk
condition + price rule + undo worked, everything survived a reload. Not verified: any of this on Safari; a real scan session.
Numbers: Scan tests 132 pass offline.
Extension vendoring: csv.js, csv-format.js, pricing.js unchanged.
Needs Builder: when Sam pastes a "Share my results" text, run `node suite/scan/eval/from-results.js` on it and send me the output.
Needs owner: use it for a real session, then tap Share my results on the List tab and paste it into the board inbox.
Next: tune the parser on the real text.

### 2026-10-16 · extension · batch 4: import my orders, Insights, quick actions · done
1) Import my orders. The Insights tab takes the TCGplayer order export (drop it, or Enter on the drop area then pick it). It is read on the device (`src/orders/parser.js`; the Shipper's own sample file reads cleanly; real exports are unverified, so headers are matched loosely and a wrong file is explained in plain words), saved in IndexedDB in one all-or-nothing step, and the Agent is switched to it (`ext.orders.use`), so goals and the weekly list run on the seller's orders. Insights: repeat buyers (first name and last initial only), top states, busiest days, average order, latest week against the week before (the 7 days up to the newest order in the file). The parser sits behind a small interface (`src/orders/index.js`); the Agent session's faster parser can drop in. Nothing is sent anywhere. "Go back to the practice shop" removes it; Clear everything removes it and its confirm text says so (and still says the audit trail goes too). Rows that cannot be read are skipped and counted.
2) Five big buttons on the Assistant tab: What should I do today? (the Agent's weekly list in plain words), Who are my repeat buyers?, Where do I ship most?, Write my weekly summary, Draft a reply. Each runs the matching goal; the plan shows, and the result is shown as plain bullets (the Agent's report with "Goal/Plan" and raw statuses is cleaned up; buyer keys become "Ada A.").
3) Real Chromium (invented 2,000-row file): imported through the keyboard in about 0.3 s, heap +8 MB; all five buttons run; the worker is killed in the middle and the same repeat-buyer answer comes back from the stored orders; wrong file explained; Clear everything leaves no orders. Unit: 2,000 orders read and saved in under 1.5 s in Node; failed import leaves old orders alone; hostile cells stay plain text.
4) HOW-TO-TRY-EXTENSION.md (still under 250 words) and WEBSTORE-LISTING.md updated for the new tabs. Nothing submitted.
5) Accessibility, checked in the browser test: tabs move with the arrow keys, the whole import works by keyboard, focus rings, no sideways scroll at 360 px on both tabs and Settings, WCAG contrast of every visible text on both tabs (the checker is proven by catching a deliberately pale line). It found and fixed pale grey struck-through text and a `hidden` attribute that CSS was overriding.
Shared with the Agent session: nothing edited by hand. I use their `analytics.js` (vendored copy). `src/vendor/` has not changed in this batch.
Needs Builder: (a) When the Agent's faster order parser merges, tell me and I will vendor it and pass it as `parser`. (b) The Agent's report carries only one-line notes per step, so "Draft a reply" says a draft is ready but cannot show its text. If `agent.answer` (or the plan events) carried each draft step's result, the panel could show the reply to copy. (c) Imported orders have no stock or messages, so restock, repricing and replies still use the practice stock and messages; a stock-file import would be the next step.
Needs owner: try it with a real TCGplayer order export on a desktop and say what looks wrong; the saved TCGplayer pages are still the blocker for X2.
Next: nothing blocked on me except X2 ("TOS OK").

### 2026-10-16 · builder · Agent proxy built (switched off) · done
Built the server half of the Agent's model access: `POST /api/agent/messages` and `GET /api/agent/status` (`agent-proxy.js`), counters in
Postgres (`docs/db/2026-10-16-agent-usage.sql`, applied and smoke-tested on production), 88 tests. It is OFF until the owner sets
variables, so nothing changes today. Contract, settings and how the limits count: `docs/suite/AGENT-PROXY.md` (read "How to call it").
For the Agent session: (1) BUG FOUND in `adapters/anthropic.js`: every one of our 27 tool names has a dot (`orders.search`) and the model
provider only accepts letters, digits, `_` and `-`, so a direct call would be rejected on the first request. The proxy renames `.` to `__`
and back for you, so send the registry specs as they are and do not rename anything yourself (a tool name that already contains `__` is
refused). (2) Please build `suite/agent/adapters/proxy.js` next to the other adapter: post `{ messages, tools }` with the user's login
token, return `{ content, costCents }`, keep `remaining` and the plain-words `error`/`code`/`resetsAt` for the panel. Do not send `system`
or a model name (the server sets both and ignores yours). A conversation is ONE question and its tool steps, at most 8 model calls.
Test against a stub, like the other adapter. `adapters/anthropic.js` stays for local experiments only.
For the Extension session: the service worker needs the site login token (through the bridge) to call the proxy; no CORS setup is needed
from an extension worker that has host permission for the site. The side panel can show `remaining` from `GET /api/agent/status`.
Needs Builder: none.
Needs owner: nothing now. When the Agent adapter is done (HQ: add the owner task then): "Turn on a real model (costs money)": a key made
with its own spend limit, then five Railway variables. By default everyone together can spend at most 5 dollars a day, one person 25 cents.
Next: review the Agent's proxy-adapter PR.
