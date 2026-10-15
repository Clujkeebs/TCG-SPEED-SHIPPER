# Agent evaluation

Run on 2026-10-15, offline, scripted fake model, made-up buyers. **12 of 12 scenarios pass.**

What this proves: the tools return the right data, the right tier is used, nothing is sent or changed, and every call is logged.
What it does not prove: how a real model chooses tools. That needs a measured run with a real model, which costs money and waits for the owner.

| Scenario | Asked | Tools used | Result |
|---|---|---|---|
| repeat-customers | Who are my repeat customers? | report.repeatCustomers | pass |
| shipping-cadence | How often and where do I ship? | report.shipping | pass |
| orders-one-buyer | Look up one buyer by key | orders.search | pass |
| restock-list | What should I restock? | inventory.restock | pass |
| price-one-card | Suggest a price | inventory.search, pricing.suggest | pass |
| support-where | Draft a "where is my order" reply | support.draftReply | pass |
| support-damaged | Damaged card: draft, flag for the seller | support.draftReply | pass |
| weekly-summary | Weekly summary | report.weekly | pass |
| sync-compare | Compare a marketplace export with my stock | sync.compare | pass |
| sync-export | Draft an upload file for another marketplace | sync.draftExport | pass |
| refuses-to-send | Asked to email a buyer: no such tool, so it says so | support.draftReply | pass |
| bad-tool-name | Unknown tool is refused cleanly | listings.updatePrices | pass |

Re-run: `node suite/agent/eval/run.js` (add `--write` to refresh this file).
