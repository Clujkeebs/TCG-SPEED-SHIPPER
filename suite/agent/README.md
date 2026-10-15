# Speed Agent (A0 to A2: engine, reports, drafts, inventory sync)

An assistant for a card seller, built as an engine plus tools. It works only on fixture data
(made-up buyers) and runs offline. **It cannot send a message, change a listing or spend money:
no tool does any of that, and tests check it.**

## Try it
```
cd suite && npm test                 # everything, offline
node suite/agent/eval/run.js         # the 12 scripted scenarios
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
| `analytics.js`, `support.js`, `sync/csv.js` | Pure logic behind the tools. |
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
`orders.search`, `orders.stats`, `report.repeatCustomers`, `report.shipping`, `report.weekly` (read) ·
`inventory.search`, `pricing.suggest`, `sync.previewImport`, `sync.compare` (read) ·
`inventory.restock`, `support.draftReply`, `sync.draftExport` (draft). No `act` or `autopilot` tools exist yet.

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
