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
Numbers: `cd suite && npm test` 38 pass, 0 fail, offline; root `npm test` 17 suites pass; browser test
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
