# Board: who's doing what (DAS §3)

Each agent edits only its own section plus Ideas. Status is one of
`now` · `next` · `review` · `blocked:<who>` · `done`. At most 2 items at
`now` per agent. The log (`DEVIN_AI.md` in this repo) is for talking; this
file is for state.

## Claude (Builder)
- [x] C-1 · Dual Agent System v1 · done · #13 · waiting on Devin's v1.1 edits
- [x] C-2 · Admin Setup checks (webhook event monitor) · done · #13 · Devin's 3 🟡 fixed
- [ ] C-3 · Stripe: create $2.99/mo, $29/yr, $59/yr prices, set env vars, verify webhook events + customer portal · blocked:owner (Stripe connector "connect incomplete")
- [ ] C-4 · Yearly "save 2 months" nudge in the upgrade card · blocked:C-3
- [ ] C-5 · Review Devin's PRs as they land · now · all reviewed ✅ (#10 #11 #12 #14 #16 #17 #18 #19 #21), waiting on owner merges
- [ ] C-6 · "Rule-change alerts" newsletter: server side, double opt-in, unsubscribe · blocked:owner (SMTP + mailing address)
- [x] C-7 · Self-host jsPDF/QRCode instead of the CDN · done · #15
- [x] C-9 · CSV formula-injection guard + webhook signature monitor + SW network-first · done · #20
- [x] C-10 · Service-worker routing tests · done · #22
- [x] C-11 · Accessibility: WCAG A/AA clean on every page · done · #23
- [x] C-12 · Site-wide SEO + link check in `npm test` · done · #24
- [ ] C-13 · Page speed: load jsPDF/QRCode on demand (-384 KB render-blocking) · review · this PR
- [ ] C-8 · IMb envelope tracking, server-side scan ingestion · blocked:owner (USPS Mailer ID + Informed Visibility)
- [x] C-0 · Two-sided referrals, share prompt, upgrade card, 40% partners, redirect, PWA, build fix · done · #6 #8 #9

## Devin (Scout)
<!-- Owned by Devin. -->
- [ ] D-1 · Fix #8 findings: free-month fallback + invoice line price · review · #16 · owner merges
- [ ] D-3 · Free slip URL + QR (`utm_source=slip`) · review · #21 · owner merges
- [ ] D-4 · Sample order button + CSV (`sample_loaded`) · review · #17 · owner merges
- [ ] D-5 · Pirate Ship CSV export (`Core.buildPirateShipCSV`) + tests · review · #18 · owner merges
- [ ] D-6 · SEO: "tcgplayer fees" post + calculator · review · #14 · owner merges
- [ ] D-11 · DAS v1.1 co-edit + Devin runbook · review · this PR
- [ ] D-9 · SEO: "how to ship graded cards" · review · #27
- [ ] D-12 · SEO: "Does TCGplayer provide shipping labels?" (Google autocomplete shows demand) · now · helper
- [ ] D-13 · SEO: "Does TCGplayer require a packing slip?" (autocomplete demand) · next
- [ ] D-10 · SEO: TCGplayer seller-portal tour · parked · autocomplete is mostly "portal down/login"; low intent
- [ ] D-7 · Stamp-count estimate (needs a real weight source) · next
- [x] D-8 · PageSpeed/Lighthouse audit of the live site · done · log 08:45 UTC (on #11); the Supabase `defer`/pin idea is for Claude
- [x] D-2 · Remove stray merge marker in #11 · done · #11
- [x] D-0 · Holiday dates #10 · fee fact-check #12 · prospects + competitors #11 · review (owner merges)

## Owner (mirror of the top of docs/OWNER-TODO.md)
- Reconnect the Stripe connector → unblocks C-3/C-4
- In Stripe, confirm the webhook sends `invoice.payment_succeeded`
- Merge Devin's #12, and #10 after checking the dates · #11 after its fix
- Install DAS in both agents' persistent instructions (see OWNER-TODO)

## Ideas (anyone adds; pull from here when your queue is empty)
- Read eBay/Whatnot order CSVs (needs sample exports from the owner)
- "Reprint last batch" (opt-in local history, no server storage)
- Per-order stamp and cost total in the Shipping Plan
- Testimonials block on the homepage once Rob replies
