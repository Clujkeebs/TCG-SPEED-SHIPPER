# Speed Agent (A0 to A4 groundwork: engine, reports, drafts, sync, automations, side panel protocol)

An assistant for a card seller, built as an engine plus tools. It works only on fixture data
(made-up buyers) and runs offline. **It cannot send a message, change a listing or spend money:
no tool does any of that, and tests check it.**

## Try it
```
cd suite && npm test                 # everything, offline
node suite/agent/eval/run.js         # the 24 scenarios (conversations and automations)
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
- Known gap before a real model is used: `support.draftReply` puts the buyer's first name in its result (see AGENT-PROXY.md, Privacy).
