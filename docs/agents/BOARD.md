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
- [ ] C-5 · Review Devin's PRs as they land · now · all tested ✅ (#10 #11 #12 #14 #16–#19 #27 #28 #29), waiting on owner merges; #21 on HOLD (seller agreement)
- [ ] C-6 · "Rule-change alerts" newsletter: server side, double opt-in, unsubscribe · blocked:owner (SMTP + mailing address)
- [x] C-7 · Self-host jsPDF/QRCode instead of the CDN · done · #15
- [x] C-9 · CSV formula-injection guard + webhook signature monitor + SW network-first · done · #20
- [x] C-10 · Service-worker routing tests · done · #22
- [x] C-11 · Accessibility: WCAG A/AA clean on every page · done · #23
- [x] C-12 · Site-wide SEO + link check in `npm test` · done · #24
- [x] C-13 · Page speed: load jsPDF/QRCode on demand (-384 KB render-blocking) · done · #26
- [x] C-14 · Self-host supabase-js pinned at 2.111.0 (no CDN connection before first paint; no floating @2) · done · #30
- [ ] C-16 · `npm test` fails on leftover merge-conflict markers in any tracked text file · review · this PR
- [ ] C-17 · "Production is behind main" admin check (build writes /version.json; compared with GitHub main) · review · this PR
- [ ] C-19 · Weekly newsletter: opt-in footer form on every page, `/api/newsletter/subscribe` + confirm-click unsubscribe, list in Supabase, send process `docs/newsletter/README.md` · review · #31
- [ ] C-20 · How It Works rewrite: current features (Shipping Plan, envelopes/Avery, Pirate Ship, mark-shipped import), CTAs, contrast fix · review · #31
- [ ] C-21 · Customer email: sent the new-domain/product note to the 6 paying subscribers (Rob already had it) · done · 2026-09-27
- [ ] C-18 · D-7 stamp estimate UI (chip, batch line, packaging-weight setting) + `Core.stampPlan` · review · #31
- [ ] C-15 · Slip branding vs TCGplayer seller agreement: "Powered by" footer + Premium QR-URL warning shipped in #31; footer · blocked:owner (decision)
- [x] C-22 · Label + packing slip on one page (customer request), plus a reply to the customer · done · #39 · tell them when it's live
- [ ] C-8 · IMb envelope tracking, server-side scan ingestion · blocked:owner (USPS Mailer ID + Informed Visibility)
- [x] C-0 · Two-sided referrals, share prompt, upgrade card, 40% partners, redirect, PWA, build fix · done · #6 #8 #9

## Devin (Scout)
<!-- Owned by Devin. -->
- [ ] D-17 · SEO: "tcgplayer lost package" (missing-package playbook) · in progress
- [ ] D-18 · Outreach batch 2 (30 contacts, spec on #11) · next
- [x] D-19 · Newsletter: fact-check issue 1, draft issue 2 (2026-10-06) · done
- [x] D-16 · Keyword-gap research · done: lost package (D-17); label+slip = section in existing labels post, not a new post
- [x] D-7 · Stamp-count estimate · core #32 + weight guard #37 · UI shipped by Claude in #36 (C-18)
- [ ] D-3 · Free slip URL + QR (`utm_source=slip`) · HOLD (seller-agreement risk) · #21 · owner decides (C-15)
- [ ] D-10 · SEO: TCGplayer seller-portal tour · parked · autocomplete is mostly "portal down/login"; low intent
- [x] D-15 · SEO: "how many stamps to mail a trading card" · merged #34
- [x] D-1/D-4/D-5/D-6/D-9/D-11/D-12/D-13/D-14 · merged 2026-09-27 with owner OK · #16 #17 #18 #14 #27 #19 #28 #29 #11
- [x] D-8 · PageSpeed/Lighthouse audit of the live site · done · log 08:45 UTC (on #11); the Supabase `defer`/pin idea is for Claude
- [x] D-2 · Remove stray merge marker in #11 · done · #11
- [x] D-0 · Holiday dates #10 · fee fact-check #12 · prospects + competitors #11 · merged #10 #11 #12

## Owner (mirror of the top of docs/OWNER-TODO.md)
- 🔥 Netlify production is stuck on the #20 deploy (previews build fine): unlock auto-publishing / check the latest production deploy
- Reconnect the Stripe connector → unblocks C-3/C-4
- In Stripe, confirm the webhook sends `invoice.payment_succeeded`
- Merge Devin's #12, and #10 after checking the dates · #11 after its fix
- Install DAS in both agents' persistent instructions (see OWNER-TODO)

## Ideas (anyone adds; pull from here when your queue is empty)
- Read eBay/Whatnot order CSVs (needs sample exports from the owner)
- "Reprint last batch" (opt-in local history, no server storage)
- Per-order stamp and cost total in the Shipping Plan
- Testimonials block on the homepage once Rob replies
