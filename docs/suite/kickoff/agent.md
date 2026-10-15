# Kickoff: Speed Agent (session "agent")

Started Oct 15 at the owner's request ("get started on all of it"). Scan S0 is merged
(`suite/scan/core/pricing.js` is the price-rule engine). The Chrome extension session is running.

You are the **Speed Agent builder** for the TCG Speed Suite. The repo (`Clujkeebs/TCG-SPEED-SHIPPER`)
is checked out on `main`. Your branch: `suite/agent`. Read first, in order: `CLAUDE.md`, `AGENTS.md`,
`docs/agents/PERMISSIONS.md`, `docs/suite/README.md`, `PLAN.md` (especially 4.3), `WORKING-AGREEMENT.md`,
`DATA-MODEL.md`, `LOG.md`, `suite/shared/models.js`, `suite/scan/README.md`. You write only in
`suite/agent/`, your own docs under `docs/suite/` and the log (append only).

## Mission
An AI assistant that helps a trading-card seller run and grow the business, with a bias toward our
own tools (Shipper orders, Scan inventory). It works through a tool registry with permission tiers
(read, draft, act, autopilot), an audit log, spending limits and a kill switch. It will later live in
the Chrome extension side panel and a web app; right now you build the engine and prove it offline.

## Milestone A0: foundation (no real model calls in tests)
1. `registry.js`: register tools with a name, description, input schema, tier and handler. Refuse
   to run `act` tools without an approval callback. Tests.
2. `audit.js`: append-only audit entries (`AuditEntry`), hashing arguments (never raw), in-memory and
   IndexedDB stores. Tests.
3. `limits.js`: per-run and per-day caps on calls and on spend (counted in cents), plus a kill
   switch. Tests.
4. `loop.js`: the agent loop around a model interface (`complete(messages, tools)`). Tests use a
   scripted fake model. A thin adapter for the Anthropic Messages API with tool use lives in
   `adapters/anthropic.js`; it reads its key from an environment variable and is never called by
   tests.
5. First read-only tools on fixture data: `orders.search`, `orders.stats` (repeat buyers, shipping
   cadence, destinations by state), `inventory.search`, `pricing.suggest` (uses the engine in
   `suite/scan/core/pricing.js`).
6. A scenario-based evaluation harness: scripted conversations with expected tool calls, runnable
   offline.
7. `suite/agent/README.md`: how to run the harness, how to add a tool, the tier rules.

## Then A1: read-only analytics and drafts, on fixture data
Repeat-customer report, shipping cadence and destination report, restock list from inventory,
support-reply drafts from an order plus a buyer message (a draft only, never sent), and a weekly
summary. Build realistic fixtures with made-up buyers (a few hundred orders over six months). Write
`docs/suite/AGENT-EVAL.md` listing the scenarios and results. Then A2 (inventory and CSV sync) if the
earlier steps are solid. **Keep going through milestones; stop only at a gate that needs the owner or
the Builder, or when your list is done.**

**Done (A0) when:** `cd suite && npm test` is green and offline; the harness runs; the log entry is
written; the PR is merged or waiting for the Builder.

## Do not
Send any message to a customer, change any listing, or spend money, even in demos. Call marketplaces.
Scrape. Put keys in the repo. Use real buyer data (fake people only). Touch `server.js`, `public/`,
the root `test/`, billing or auth.
