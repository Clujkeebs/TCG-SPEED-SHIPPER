# TCG Speed Suite: Chrome extension (X0, X1, X3 and the practice Agent)

Manifest V3, plain JavaScript modules, no runtime dependencies, no build tools. **Nothing in it
touches TCGplayer yet**: there is no TCGplayer content script, and a code gate (`TOS_OK` in
`src/flags.js`) keeps those modules inert until the Builder records "TOS OK" in `docs/suite/LOG.md`.

## Load it unpacked (desktop Chrome or Edge only)
**Extensions need desktop Chrome (or Edge) on a Mac, Windows or Linux computer. They do not run on an iPad
or iPhone, so on the iPad use the website and the CSV route as today.**
1. Get the folder onto the computer (clone the repo, or unzip a package from `npm run build`).
2. Open `chrome://extensions`, switch on **Developer mode**.
3. **Load unpacked** and pick this folder (`suite/extension`; or the unzipped package folder).
4. Click the puzzle icon, pin "TCG Speed Suite". The popup links to Settings (flags, all off).
   The side panel is a placeholder.

## Run the tests (offline, no keys)
```
cd suite && npm test                 # shared + extension: unit tests and the browser test
cd suite/extension && npm test       # extension only
cd suite/extension && npm run build  # stamped zip in dist/ (needs `zip`): tcg-speed-suite-<version>-<date>-<commit>.zip
cd suite/extension && npm run vendor # refresh src/vendor/ from suite/ (a test fails when it is stale)
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
| `src/agent/` | The side panel's side of the Agent protocol (`suite/agent/protocol.js`, mirrored and checked by a test), a practice transport on made-up data, and the DOM-free panel controller. Goal box, plan, approval cards (only a click answers one, once), Stop/Resume, memory list with Forget. |
| `src/modules/scan-uploader.js` | Puts the Scan CSV in an import page's file box. Never presses Upload. Off. |
| `src/flags-text.js` | Plain-words text for Settings and the popup. |
| `src/ui/` | Popup, side panel placeholder, options page. |
| `PRIVACY.md`, `STORE-CHECKLIST.md` | Drafts for the Web Store. Not submitted. |

`src/vendor/` holds copies of files from elsewhere in `suite/` (the shared models, Scan's pricing and CSV writer,
and the whole Agent engine), because an extension cannot load files outside its folder. The list is in
`scripts/vendor-list.js`. A test fails if any copy is stale. Refresh with `cd suite/extension && npm run vendor`
(one command, copies them all).

**Practice Agent.** The service worker (`src/background.js`) hosts the real Agent engine over a made-up shop
(`src/agent-host/`): real tool registry, real approvals, audit and limits; only the "model" is a keyword stand-in,
so practice mode needs no key, no network and costs nothing. Its one `act` tool changes made-up data only.
Plan and memory (and the card's why/undo text) are proposed protocol additions: the panel shows them only when
the agent's `hello` lists them. The service worker may go to sleep, which resets the practice shop; that is fine.
**Server address** (Settings, advanced): off by default, nothing uses it yet.

**Permissions.** Every one is listed in `docs/suite/EXTENSION-PERMISSIONS.md`; a test fails if the manifest and
that page disagree.

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
