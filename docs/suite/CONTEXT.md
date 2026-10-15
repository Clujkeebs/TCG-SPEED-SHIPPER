# TCG Speed Suite: context for every session

Read this after `WORKING-AGREEMENT.md`. It says who we work for, where the business is, what each
session is trying to achieve, and how to do it well. Written by the Builder session, Oct 15, 2026.

## The owner and the business (plain facts)
- The owner (Sam) is a TCGplayer seller who built **TCG Speed Shipper** (tcgspeedshipper.com): drop in
  TCGplayer's shipping export, get print-ready labels, envelopes and packing slips. Free for 10 labels a
  month, no account needed; paid plans Base ($2.99), Premium ($5.99 for old customers, $6.99 new), Pro
  ($14.99, planned). Runs on Railway, Supabase, Stripe, Resend. He is not technical, works from an iPad,
  hates clutter and long text, and wants a few clear next steps.
- Today (Oct 15, 2026): about 170 visits and 100 order uploads a week, 23 accounts, 12 paying, about
  $40 a month. One loyal power seller, Rob (ships 250 to 500 labels a month), gives most of our product
  feedback. Goal: $10,000 a month. The fastest lever is **postage** (labels bought through Pitney Bowes,
  waiting on their production approval); the big bet is the **Suite** below.
- The vision, in his words: a TCGplayer empire. **Shipper** (labels and postage), **Scan** (point a phone
  at a card, set condition, finish and a price rule once, rapid-fire cards, download a CSV, list on
  TCGplayer; Magic, Pokémon, Yu-Gi-Oh!, One Piece), a **Chrome extension** (one-click upload and
  "paste tracking", hosts the Agent), and the **Agent** (an AI that helps run and grow the business:
  inventory, pricing, customer replies, repeat-customer and shipping analytics, deals on supplies,
  automations, syncing platforms). Later: a site for each product and one for the Suite.

## Rules that never bend
1. **TCGplayer's rules.** No scraping, no bots against their site, nothing automated on their pages
   until the Builder writes "TOS OK" in the log. Official CSV import is the sanctioned path.
2. **A human approves** anything that changes money, listings, prices or messages to customers.
3. **Seller privacy.** Fake buyers only in tests and fixtures. Never log buyer data.
4. **$0 spend, no keys, no sign-ups.** Ask in the log under "Needs owner" (plain words).
5. **Stay in your folder.** The live site must not break; the live server never imports from `suite/`.
6. **Measure, do not claim.** Accuracy and speed numbers come from runs; say "unverified" otherwise.

## What "agent, not chat" means (for the Agent session and anything user-facing)
A chatbot answers. The Agent **works**: it holds a goal, makes a plan, calls tools, checks results,
asks for approval at the right moments, remembers, and reports back. Build toward:
- **Goals and plans:** the seller states a goal ("get my low stock restocked", "who are my repeat buyers",
  "reprice my foils 5% under market"); the agent writes a short plan, shows it, runs it step by step.
- **Memory:** a store of facts about the seller's shop (settings, preferences, past decisions) with
  edit and delete; used in later runs.
- **An approval inbox:** every `act` step lands as a card (what, why, undo) the seller taps to approve.
- **Background jobs:** saved automations that run on a schedule and leave a report; nothing acts without
  approval unless the owner switched that one automation to autopilot.
- **Proactive suggestions:** daily or weekly "here are 5 things worth doing" from orders and inventory.
- **Transparent audit:** every tool call visible and exportable; a kill switch always one tap away.
- **Honest failure:** says when it does not know, shows its sources, never invents numbers.

## Per session: goal, how, done
- **Scan.** Goal: a seller lists 100 cards in minutes. How: reliable card reading (set code, collector
  number, name), fast rapid-fire loop (auto-accept confident reads, tap-to-fix the rest, one-tap undo),
  price rules like "5% under market, never below $0.25, end in .99", correct TCGplayer CSV (needs a real
  export from the owner). Done when: measured accuracy on real photos, the numbers in PLAN.md section 6.
  **Approved:** vendor a self-hosted WebAssembly OCR (Tesseract.js, Apache-2.0) into `suite/scan/vendor/`
  with licence files; keep the app working offline.
- **Chrome extension.** Goal: the seller's shipping and listing day in a few clicks, with the Agent in a
  side panel. How: adapters on fixtures, flags off, selectors in config with self-tests, approval cards,
  a ready-to-send permission email to TCGplayer. Done when: X3 works on fixtures and TOS OK exists.
- **Agent.** Goal: an assistant a seller would pay for. How: see "agent, not chat". Build planning,
  memory, approval inbox, scheduled automations, proactive suggestions, deal finder on an allow-list,
  analytics depth, and a design for a server proxy so keys never reach a browser. Done when: a scripted
  "week in a shop" scenario runs offline from goal to approved actions with a full audit trail.
- **HQ (Suite HQ board).** Goal: the owner's one home: next step, roadmap, Suite status, library of every
  doc and plan, meetings, ideas. How: calm, short, iPad-first, live status from the `suite/status`
  document. Done when: he can see in 10 seconds what to do and what changed.
- **Builder (master).** Reviews and merges, wakes idle sessions, keeps the log and board current,
  guards production, answers customers (drafts), watches revenue.

## How to work
Read in parts; keep context small. Write the plan in the log before big work. Small PRs. Run
`cd suite && npm test` and the root `npm test` before merging. Log every milestone with what you
measured and what you need. If blocked, log it and take the next item: never sit idle, never loop.
