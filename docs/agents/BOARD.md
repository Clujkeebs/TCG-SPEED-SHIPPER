# Board: who's doing what (DAS §3)

Each agent edits only its own section plus Ideas. Status is one of
`now` · `next` · `review` · `blocked:<who>` · `done`. At most 2 items at
`now` per agent. The log (`DEVIN_AI.md` in this repo) is for talking; this
file is for state.

## Claude (Builder)
- [ ] C-1 · Dual Agent System v1 (this doc set) · now · PR #13 · Devin to co-review and propose edits
- [ ] C-2 · Admin Setup checks (webhook event monitor) · review · PR #13 · waiting on Devin Review
- [ ] C-3 · Stripe: create $2.99/mo, $29/yr, $59/yr prices, set env vars, verify webhook events + customer portal · blocked:owner (Stripe connector "connect incomplete")
- [ ] C-4 · Yearly "save 2 months" nudge in the upgrade card · blocked:C-3
- [ ] C-5 · Review Devin's PRs as they land (#10 ✅, #11 one fix, #12 ✅) · now
- [ ] C-6 · "Rule-change alerts" newsletter: server side, double opt-in, unsubscribe · blocked:owner (SMTP + mailing address)
- [ ] C-7 · Self-host jsPDF/QRCode instead of the CDN (faster, fewer third parties, sturdier offline) · next
- [ ] C-8 · IMb envelope tracking, server-side scan ingestion · blocked:owner (USPS Mailer ID + Informed Visibility)
- [x] C-0 · Two-sided referrals, share prompt, upgrade card, 40% partners, redirect, PWA, build fix · done · #6 #8 #9

## Devin (Scout)
<!-- Owned by Devin. -->
- [ ] D-1 · Fix #8 findings: free-month fallback + invoice line price · now · branch pushed soon, PR to follow · your design (`setFriendTrial`)
- [ ] D-3 · Free slip URL + QR (`utm_source=slip`) · now · helper
- [ ] D-4 · Sample order button + CSV (`sample_loaded`) · now · helper
- [ ] D-5 · Pirate Ship CSV export (`Core.buildPirateShipCSV`) + tests · now · helper
- [ ] D-6 · SEO: "tcgplayer fees" post + calculator · review · #14 · your 🟡 fixed in `b842850`
- [ ] D-11 · DAS v1.1 co-edit + Devin runbook · review · this PR
- [ ] D-9 · SEO: "how to ship graded cards" · next · check search demand first
- [ ] D-10 · SEO: TCGplayer seller-portal tour · next · check search demand first
- [ ] D-7 · Stamp-count estimate (needs a real weight source) · next
- [ ] D-8 · PageSpeed/Lighthouse audit of the live site → log first · next
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
