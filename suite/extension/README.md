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

**Practice Agent.** The service worker (`src/background.js`) hosts the real Agent core over a made-up shop
(`src/agent-host/`): the planner, visible plans, the approval inbox (what, why, undo), shop memory, weekly suggestions,
background jobs, tool registry, audit and limits. There is no model in practice mode: goals the rule planner knows
(repeat buyers, restock, reprice, replies, remember...) work; anything else says so honestly. No key, no network, no cost.
**Your own orders (Insights tab).** The seller picks or drops the TCGplayer order export; `src/orders/parser.js` reads it
on the device (header names loosely matched; the Shipper's sample file works; real exports are unverified), saves the orders
in IndexedDB (`orders`), and the host switches the Agent to them (`ext.orders.use`). The reader sits behind a tiny interface in
`src/orders/index.js` (`parser.parse(text) -> { ok, orders, skipped, rows }`), so the Agent session's faster parser can replace it.
Insights use the Agent's own `analytics.js`. Five quick-action buttons run goals the Agent already knows.
**Background jobs:** `chrome.alarms` wakes the extension once a minute; a saved job whose schedule has come runs on the
practice data, leaves a report and queues approval cards (it never acts on its own). The toolbar icon shows how many
approvals are waiting (a number, no pop-ups). Jobs, cards (same ids), plan, memory and the stop switch are saved, so a
worker that went to sleep wakes up where it left off. Requests beginning `ext.` (jobs list/add/toggle/remove) are
extension-only, not part of the Agent protocol.
**Server address** (Settings, advanced): off by default, nothing uses it yet.

**Permissions.** Every one is listed in `docs/suite/EXTENSION-PERMISSIONS.md`; a test fails if the manifest and
that page disagree.

## Talking to the extension from the web app
Post `{ source: 'tcgss-app', v: 1, id, type, payload }` to `window` and listen for
`{ source: 'tcgss-extension', id, ok, result | error }`. Types: `hello`, `store.put`, `store.get`,
`store.list`. Collections: `orders`, `listings`, `inventory`, `scans`. Anything else is refused.
I chose a content script with `postMessage` over `externally_connectable`: the page never gets a
direct line to the service worker, and each message is checked twice (page side and worker side).

## Shipper bridge: the exact message shape (for the web app)
The web app (tcgspeedshipper.com, or localhost in development) posts to its own window and listens for the answer:
```js
window.postMessage({ source: 'tcgss-app', v: 1, id: 'any-unique-string-up-to-80-chars', type: 'tracking.put',
  payload: { batchId: 'batch-2026-10-15-1',            // 1-80 of A-Z a-z 0-9 . _ -
             items: [ { orderId: 'ORD-1001',           // same character rule; unique within the batch
                        trackingNumber: '9400 1000 0000 0000 0000 00',  // 6-40 letters, digits or spaces
                        carrier: 'USPS' } ] } },      // optional: USPS, UPS, FedEx, DHL or other
  location.origin);
// answer, delivered with window.postMessage to the same origin:
// { source: 'tcgss-extension', v: 1, id: <same id>, ok: true, result: { key: 'batch-2026-10-15-1', count: 1 } }
// or { ..., ok: false, error: 'plain reason' }
```
Rules: 1 to 200 items per batch; no other fields anywhere (extra fields are refused); a second `tracking.put` with the
same `batchId` replaces the first. Also `tracking.get` `{ batchId }` (returns `{ batch: { id, receivedAt, items } }` or
`{ batch: null }`) and `tracking.list` (no payload; returns `{ batches: [{ id, receivedAt, count }] }`). Only
`https://tcgspeedshipper.com` exactly, or `http://localhost[:port]` in development, can talk to the bridge. The first message
may be sent right after page load (early messages are queued). Everything is stored on the seller's computer only.
Other types: `hello`, `store.put|get|list` (collections `orders`, `listings`, `inventory`, `scans`; records are validated; 64 KB cap).

## Durability (the service worker can sleep at any time)
The practice Agent saves its plan, memory, a waiting approval, the Stop switch and the practice shop's prices in
`chrome.storage.local`, and its audit trail in IndexedDB. A worker that wakes restores them; a test kills the worker in real
Chromium and checks that the card is still there and the click still finishes the job. (A run that was in the middle of
thinking when the worker died is not resumed; an approval that was already waiting is.)

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
