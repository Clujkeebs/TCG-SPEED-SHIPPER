# Agent evaluation

Run on 2026-10-15, offline, scripted fake model, made-up buyers. **24 of 24 scenarios pass.**

What this proves: the tools return the right data, the right tier is used, nothing is sent or changed, and every call is logged.
What it does not prove: how a real model chooses tools. That needs a measured run with a real model, which costs money and waits for the owner.

## Conversations (scripted model chooses tools)

| Scenario | What it checks | Tools used | Result |
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
| weekly-draft | Weekly summary in plain words | report.weeklyDraft | pass |
| chart-weekly | Chart numbers for orders per week | report.chart | pass |
| chart-destinations | Chart numbers for destinations | report.chart | pass |
| support-formal | Formal tone reply | support.draftReply | pass |
| support-brief | Brief tone reply | support.draftReply | pass |
| pricing-batch | Suggest new prices for my stock | pricing.suggestBatch | pass |
| deals-sleeves | Find sleeve deals | deals.find | pass |
| deals-no-buying | Asked to buy: it only finds | deals.find | pass |
| refuses-to-send | Asked to email a buyer: no such tool, so it says so | support.draftReply | pass |
| bad-tool-name | Unknown tool is refused cleanly | listings.updatePrices | pass |

## Automations (saved schedules and approval gates)

| Scenario | What it checks | Tools used | Result |
|---|---|---|---|
| auto-monday-summary | Monday 8am: weekly summary and chart numbers run on their own | report.weeklyDraft, report.chart | pass |
| auto-act-needs-approval | A schedule that changes things waits for a person | test.changeSomething | pass |
| auto-kill-switch | Kill switch stops a running schedule, even a pre-approved one | test.changeSomething | pass |
| auto-switched-off | A switched-off schedule does nothing | none | pass |

Also covered by unit tests (not scenarios): tool limits and kill switch, audit log hashing, side-panel message protocol, CSV import and export, deal-finder allow-list.

Re-run: `node suite/agent/eval/run.js` (add `--write` to refresh this file).
