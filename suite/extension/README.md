# TCG Speed Suite: Chrome extension (milestones X0, X1, X3)

Manifest V3, plain JavaScript modules, no runtime dependencies, no build tools. **Nothing in it
touches TCGplayer yet**: there is no TCGplayer content script, and a code gate (`TOS_OK` in
`src/flags.js`) keeps those modules inert until the Builder records "TOS OK" in `docs/suite/LOG.md`.

## Load it unpacked (Chrome or Edge, desktop)
1. Open `chrome://extensions`, switch on **Developer mode**.
2. **Load unpacked** and pick this folder (`suite/extension`).
3. Click the puzzle icon, pin "TCG Speed Suite". The popup links to Settings (flags, all off).
   The side panel is a placeholder.

## Run the tests (offline, no keys)
```
cd suite && npm test                 # shared + extension: unit tests and the browser test
cd suite/extension && npm test       # extension only
cd suite/extension && npm run build  # zip to dist/ (needs the `zip` command)
```
The browser test drives a local fixture page with Playwright and Chromium (found at
`/opt/pw-browsers`; override with `CHROMIUM_PATH` and `PLAYWRIGHT_PATH`). It skips itself with a note if
either is missing.

## What is in it
| File | Job |
|---|---|
| `manifest.json` | Permissions: `storage`, `sidePanel`. TCGplayer host is optional, asked for later. |
| `src/flags.js` | Feature flags in `chrome.storage.local`, all off; TCGplayer ones also need `TOS_OK`. |
| `src/bridge.js` | Origin allow-list and message schema (pure functions). |
| `src/content-bridge.js` | On tcgspeedshipper.com and localhost only: page <-> service worker. |
| `src/background.js` | Service worker: re-checks every message, then reads or writes the store. |
| `src/store.js` | IndexedDB (memory fallback), validated with `src/vendor/models.js`. |
| `src/adapters/selectors.js` | Every page selector, in one file (synthetic placeholders for now). |
| `src/adapters/index.js` | `detectPage`, `readOrders`, `fillTracking`, `openImport`, `attachFile`, `selfTest`. Dry run by default; never submits or uploads. |
| `src/agent/` | Side-panel protocol (checked messages), practice transport (made-up data), and the panel's DOM-free controller. Approval cards for `act` actions: only a click answers one, once. |
| `src/modules/scan-uploader.js` | Puts the Scan CSV in an import page's file box. Never presses Upload. Off. |
| `src/flags-text.js` | Plain-words text for Settings and the popup. |
| `src/ui/` | Popup, side panel placeholder, options page. |
| `PRIVACY.md`, `STORE-CHECKLIST.md` | Drafts for the Web Store. Not submitted. |

`src/vendor/models.js` is a copy of `suite/shared/models.js` (an extension cannot load files outside
its folder). A test fails if the copy drifts; refresh with `cp ../shared/models.js src/vendor/models.js`.

## Talking to the extension from the web app
Post `{ source: 'tcgss-app', v: 1, id, type, payload }` to `window` and listen for
`{ source: 'tcgss-extension', id, ok, result | error }`. Types: `hello`, `store.put`, `store.get`,
`store.list`. Collections: `orders`, `listings`, `inventory`, `scans`. Anything else is refused.
I chose a content script with `postMessage` over `externally_connectable`: the page never gets a
direct line to the service worker, and each message is checked twice (page side and worker side).

## Adapters (X1, still off)
`createAdapter(document, { dryRun })` works on a page you give it. In dry run (the default) it only
records what it would do in `adapter.actions` (tracking numbers are never written to that log). With
dry run off it fills fields and attaches the seller's CSV, but never clicks Save or Upload: the seller
does. `selfTest()` lists selectors that no longer match, which is how we spot a changed page. Extension
code must get adapters through `guardedAdapter(flag, ...)`, which refuses unless the flag is on and
`TOS_OK` is true. The fixtures in `test/fixtures/` are invented pages, not copies of TCGplayer.

## Verified (2026-10-15)
Unit tests for flags, bridge (accepted and rejected), store, handler and manifest; two browser tests
(fixture page -> content script -> service worker -> IndexedDB; adapters on synthetic pages). Not verified: real Chrome UI clicks,
the side panel, anything on TCGplayer.
