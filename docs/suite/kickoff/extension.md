# Kickoff: Chrome extension (session "extension")

You are the **Chrome extension builder** for the TCG Speed Suite. The repo
(`Clujkeebs/TCG-SPEED-SHIPPER`) is already checked out. Your branch: `suite/extension`.

Read first, in this order, and then follow them exactly: `CLAUDE.md`, `AGENTS.md`,
`docs/agents/PERMISSIONS.md`, `docs/suite/README.md`, `docs/suite/PLAN.md`,
`docs/suite/WORKING-AGREEMENT.md`, `docs/suite/DATA-MODEL.md`, `docs/suite/LOG.md`,
`docs/research/chrome-extension.md`, `suite/shared/models.js`. You write only in
`suite/extension/`, your own docs under `docs/suite/`, and the log. The owner pays for this on a
weekly usage limit: do not loop on a failing approach. If you fail the same step twice, log it under
"Needs Builder" and move on.

## Mission
One Chrome extension, "TCG Speed Suite", that will host (1) the Shipper helper: **Paste tracking**
into TCGplayer's own mark-shipped form and **Print shipping** from the Orders page without the CSV
step; (2) the Scan uploader: **Upload to TCGplayer** attaches the seller's CSV on the Import CSV
page; (3) the Agent side panel. Everything that touches a TCGplayer page is **off and
fixture-only** until the Builder records "TOS OK" in the log (PLAN.md sections 2 and 3). Every
action is a button the seller clicks. Never background activity against TCGplayer, never logging in
for the seller, never scraping.

## Milestone X0: foundation (start now)
Build in `suite/extension/`, with tests. Plain JavaScript (ES modules), Manifest V3, no framework
unless justified in the log, pinned dev dependencies only.

1. Manifest V3 skeleton: service worker, content script, side panel (placeholder UI), options page.
   Minimal permissions. Declare the host `https://seller.tcgplayer.com/*` but keep every
   TCGplayer-touching module behind a feature flag that defaults to **off**.
2. `flags.js`: feature flags stored in `chrome.storage.local`, default off, with a small options
   page to flip them for development. Tests for defaults and persistence.
3. A message bridge between the extension and the Speed Shipper web app
   (`https://tcgspeedshipper.com` and `http://localhost`) using `externally_connectable` or
   `window.postMessage` from a content script, whichever is safer. Validate every message against
   an allow-list and a schema. Tests for accepted and rejected messages.
4. A local store (IndexedDB wrapper with an in-memory fallback) that follows `DATA-MODEL.md` and
   uses the validators in `../shared/models.js`.
5. A Playwright harness that loads the unpacked extension in Chromium (the sandbox has Chromium at
   `/opt/pw-browsers/chromium` and Playwright under `/opt/node22/lib/node_modules`) and drives local
   fixture pages. Add one passing end-to-end test: a fixture page, the content script, a message to
   the service worker, the result stored.
6. A `build` script that zips a clean package, plus a checklist for the Chrome Web Store (privacy
   policy text, single-purpose statement, permission justifications). Draft the privacy policy text
   in `suite/extension/PRIVACY.md`. It must not contradict the site's Privacy Policy.
7. `docs/suite/TOS-NOTES.md`: a short, honest summary of what TCGplayer's Terms, Seller Agreement and
   API terms seem to say about automation, with links and "not yet read in full" marked clearly, and
   the exact questions to ask TCGplayer. The owner will read it.
8. `suite/extension/README.md`: how to load it unpacked, run the tests, what is verified.

**Done when:** `cd suite && npm test` is green and offline; the end-to-end test passes; the README
explains loading the unpacked extension; the log entry is written; the PR is merged or waiting for
the Builder.

## Then X1: the adapter framework (still off)
Page adapters with a common interface (`detectPage`, `readOrders`, `fillTracking`, `openImport`,
`attachFile`), selectors kept in a config file with a self-test that reports which selectors no
longer match, a dry-run mode that only logs what it would do, and synthetic fixtures. We do not
have real TCGplayer pages (they need a login and the sandbox cannot reach them), so write down in
the log exactly which saved pages you need from the owner or Rob (for example "Orders list" and
"mark as shipped", saved from the browser) and keep going without them.

## Do not
Touch `server.js`, `public/`, the root `test/`, billing, auth or anything outside your folder. Enable
a TCGplayer-facing module. Spend money or register a Web Store account. Add analytics. Use model
names in commits. Leave secrets or real buyer data anywhere.
