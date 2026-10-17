# Speed Agent (an agent, not a chat: goals, plans, memory, approval inbox, background jobs, suggestions)

An assistant for a card seller, built as an engine plus tools. It works only on fixture data
(made-up buyers) and runs offline. **It cannot send a message, change a listing or spend money:
no tool does any of that, and tests check it.**

## Try it
```
cd suite && npm test                 # everything, offline
node suite/agent/eval/run.js         # 24 scenarios + the "week in a shop" (31 checks)
node suite/agent/eval/run.js --write # also refresh docs/suite/AGENT-EVAL.md
```

## Parts
| File | What it does |
|---|---|
| `registry.js` | Registers tools (name, description, schema, tier, handler). Checks arguments. Refuses `act` tools with no approval callback, and `autopilot` tools outside an enabled automation. |
| `audit.js` | Append-only log, one `AuditEntry` per call. Arguments are hashed (SHA-256), never stored. Memory store and IndexedDB store. |
| `limits.js` | Caps on calls and spend (whole cents), per run and per UTC day. Kill switch. |
| `loop.js` | The agent loop around `model.complete(messages, tools)`. `scriptedModel` is the fake used in tests. |
| `adapters/anthropic.js` | The real model adapter. Reads `ANTHROPIC_API_KEY` and `ANTHROPIC_MODEL` from the environment. Tests only use a fake `fetch`. |
| `automations.js` | Saved schedules (cron) with approval gates: `always`, `first-run`, `never`. Disabled ones never run. |
| `deals.js` | Supply deal finder over an allow-list of sources and a saved feed. Never fetches, never buys. |
| `protocol.js` | Messages between the extension side panel and the Agent (same shape as the extension bridge). Also the approval flow and stop button. |
| `analytics.js`, `support.js`, `sync/csv.js` | Pure logic behind the tools (reports, chart data, reply tones, CSV). |
| `tools/index.js` | The tool list. |
| `fixtures/orders.js` | About 320 made-up orders over six months, made-up stock levels. Seeded, so identical every run. |
| `eval/` | Scenario harness and the scenarios. |

## Tiers
| Tier | Meaning | Rule in code |
|---|---|---|
| read | looks, changes nothing | runs |
| draft | prepares text or a file for a person | runs; output is a draft, never sent |
| act | changes something | needs an approval callback each time; logged with who approved |
| autopilot | runs by itself | only inside an automation with `enabled: true` |

Every call (including refused ones) is logged. Limits and the kill switch apply to every tool.

## Tools now
`orders.search`, `orders.stats`, `report.repeatCustomers`, `report.shipping`, `report.weekly`, `report.chart` (read) ·
`inventory.search`, `pricing.suggest`, `pricing.suggestBatch`, `pricing.rules`, `deals.find`, `sync.previewImport`, `sync.compare` (read) ·
`inventory.restock`, `report.weeklyDraft`, `support.draftReply` (tones: friendly, formal, brief), `sync.draftExport` (draft). No `act` or `autopilot` tools exist yet.

## Add a tool
Add an object to `createTools` in `tools/index.js`: `name`, `description`, `tier`, `inputSchema`
(`type`, `properties`, `required`, `enum`, `minimum`, `maximum`), `handler(args, ctx)`, optional
`costCents`. Keep names free of send/update/upload words unless the tier is `act`. Add a test and a scenario.
Tools must not return buyer names or street addresses; use `buyerKey`.

## What is verified and what is not
| Thing | State |
|---|---|
| Registry, audit, limits, loop, tools, scenarios | Tested offline |
| Real model behaviour | **Not measured.** Needs an API key and a small budget: owner decision |
| Spreadsheet column names (TCGplayer, eBay, Whatnot, Mana Pool) | **UNVERIFIED.** Change `HEADER_ALIASES` and `TARGETS` in `sync/csv.js` once real exports exist |
| Order and stock data | Made up. Real orders come later from the Shipper through the extension |
| Support drafts | Fixed templates, five cases. A real model would write better ones |

## Automations and the side panel
- An automation is saved in the `Automation` shape from `DATA-MODEL.md`. Only `cron` triggers run; `event` ones are refused for now.
  `tick({ store, registry, approve, now })` is meant to be called once a minute by whatever hosts the Agent.
- Side panel messages are listed at the top of `protocol.js`. The extension session wires them to `chrome.runtime`.
- Server proxy plan, limits and cost estimate: `docs/suite/AGENT-PROXY.md`.
- `support.draftReply` returns `{{first_name}}`; `fillPlaceholders()` puts the name in on the device.

## Agent, not chat (how the pieces fit)
| Need | File | In one line |
|---|---|---|
| Goal -> visible plan -> steps with result checks | `planner.js`, `plan.js`, `agent.js` | "Reprice my foils" becomes a short plan; read steps run, a step that finds nothing stops its branch and says so |
| Memory the seller owns | `memory.js` | view, edit, delete; used by plans (restock level, price rule); agent-proposed facts need a card |
| Approval inbox | `inbox.js`, `tools/acts.js` | every act step is a card (what, why, expected effect, undo); nothing runs until approved; kill switch keeps cards waiting |
| Background jobs | `jobs.js`, `events.js`, `automations.js` | cron or event (low stock, new order, unanswered message); leave a report; approval-required by default; only the owner can set autopilot |
| Proactive | `suggestions.js` | weekly "five things worth doing" from real numbers; each has a goal to start |
| Side panel | `protocol.js` | plan, memory, approval (why + undo) and progress (summary) messages; see `DATA-MODEL.md` |
| Proof | `eval/week-in-shop.js` | one scripted week from goals to approved actions with the audit trail checked |

Act tools that exist: `inventory.setPrices` (the seller's own stock list on this device), `memory.remember`, `memory.forget`,
`automation.save`, `automation.remove`. None touches a marketplace, sends a message or spends money. Steps after an approval-gated
step that depend on its result wait for a new run (none of the recipes need that yet).

## Security, policy and sync (batch 2)
| Need | File | In one line |
|---|---|---|
| Untrusted text | `untrusted.js`, `registry.js` | text from buyers, files and feeds is cleaned, capped, marked; after reading it a run cannot save memory or schedules; approval cards carry a warning |
| Red team | `eval/redteam.js` | 22 attacks that assume the model is fully fooled; checks run after each; results in `docs/suite/AGENT-EVAL.md` |
| Seller rules | `policies.js` | 12 cited entries (our blog, and the TCGplayer help page it links); drafts cite ids and say to check TCGplayer's current article; a test fails if the blog post changes under an entry |
| Seller Portal export | `sync/csv.js` (`columnMap`, `analyzeExport`), `agent.syncExport`, `agent.export` | column map, low stock, price drift against the market column, five ranked fixes; fixes that change prices become cards |
| For Sam | `docs/suite/AGENT-TODAY.md` | one page, plain words |

If you add or change a file the Extension imports, add new files to `suite/extension/scripts/vendor-list.js` and run `cd suite/extension && npm run vendor`.

## Order file, saving, briefing, voice (batch 3)
| Need | File | In one line |
|---|---|---|
| Order file at scale | `orderfile.js` | streaming parser + counters; reads the Shipper's real columns; 10,000 invented rows in about 60 to 130 ms; summary, weekly draft and chart numbers; buyer names stay on the device |
| Saved on the device | `persist.js` | IndexedDB behind the same store interfaces: loads on open, saves only changes, reports failures, leaves newer-version data alone. `openWorld({ idb })` in `eval/harness.js` shows the wiring |
| Morning briefing | `briefing.js` | plain text under 150 words, deterministic, no model |
| Voice profile | `voice.js` | derive an editable style card from 3 to 5 of the seller's own replies; drafts follow it; samples are not kept |
| Test fakes | `fixtures/fake-idb.js`, `fixtures/shipping-export.js` | a faithful fake IndexedDB; an invented shipping export |

The budget for the order file is written down in `orderfile.test.js` (10,000 rows, under 1,500 ms, under 100 MB growth).

## The real model (batch 4)
| Need | File | In one line |
|---|---|---|
| Real model through our server | `adapters/proxy.js` | posts only `{ messages, tools }` with the login token from a function you give it (never stored); checks the conversation shape first; returns `{ content, costCents, remaining }`; every failure is a `ProxyError` with the server's plain words, `code` and `resetsAt` |
| Contract stand-in | `fixtures/proxy-stub.js` | a local HTTP server that enforces the contract in `AGENT-PROXY.md` ("How to call it") so the adapter runs real `fetch` code with no real model |
| Direct provider adapter | `adapters/anthropic.js` | LOCAL EXPERIMENTS ONLY: refuses to start without `AGENT_LOCAL_EXPERIMENT=yes` and refuses to run in a web page; renames `.` to `__` like the server does |
| Draft text for the panel | `plan.js` `copyableOf`, `agent.fillCopy` | finished draft steps carry the text to copy in `agent.plan` (`output`) and `agent.answer` (`drafts`); first names are filled in on the device only |
| Cost per question | `eval/measure.js`, `docs/suite/AGENT-MEASURE.md` | six scenarios first, three numbers, tested against the stand-in |
