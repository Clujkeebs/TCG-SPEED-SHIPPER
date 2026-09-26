# Handoff: TCG Speed Shipper

This file is a shared handoff/status log between AI coding agents (Claude,
Devin, whoever picks this up next) working on this project for the owner
(Clujkeebs). **Read this first.** When you finish a work session, append a
dated entry to the Status Log at the bottom — don't edit or delete earlier
entries, just add to the log so the history stays intact.

## What this app is

TCG Speed Shipper — converts a TCGPlayer packing-list CSV (or pasted
addresses) into print-ready PDF shipping labels and packing slips, entirely
client-side. Free plan needs no account. Paid plans add higher volume and a
Design Studio. Live at **https://tcg-speed-shipper.netlify.app**.

Plans: Free (10 labels/mo, no account) · Base $1.99/mo (500/mo) · Premium
$5.99/mo (unlimited + paste-address mode + Design Studio: colors/fonts,
custom slip message, QR codes, saved return-address profiles, no branding).

## Architecture

- **Static site**: `public/` — served directly by Netlify's CDN.
- **API**: `server.js` (Express), wrapped as a single Netlify Function via
  `serverless-http` (`netlify/functions/api.js`). Routes are mounted at
  *both* `/api/*` and `/.netlify/functions/api/*` — Netlify's rewrite can
  hand the function either path depending on the deploy, and mounting only
  one previously 404'd everything. Don't "simplify" this to one prefix.
- **Database/Auth**: Supabase project `lwqnsvlfffugyvwblqaz` (dashboard name
  "vischeck" — that was originally another, unrelated app's project; its
  tables have since been dropped at the owner's request, since they were
  fully empty/abandoned. The project itself is kept — it's where this app's
  data lives now, under the `tcgss_` prefix. New tables should still use that
  prefix as a matter of hygiene, but there's no longer another live app to
  collide with.
- **Billing**: Stripe, **live mode** (real charges, not test mode).
  - Base price: `price_1U00soPpFiI6sg2WQvzev0Rm`
  - Premium price: `price_1U00srPpFiI6sg2W7Ps9Z7qK`
  - Webhook → `/api/stripe-webhook`, events: `checkout.session.completed`,
    `customer.subscription.created/updated/deleted`.
- **Netlify site ID**: `eed4a636-ed96-43b5-841c-0e5e03d245dc`.

### Required env vars (set in Netlify's dashboard — never commit these)
`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_BASE`,
`STRIPE_PRICE_PREMIUM`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
`PUBLIC_SITE_URL`. All were set and confirmed working as of this writing.

## Auth model (changed recently — read this carefully)

**Email + password is the only auth path.** Magic link (passwordless OTP)
was the original design, was briefly kept as a secondary option, and has
now been removed entirely — it depended on Supabase's shared email sender,
which was unreliably not delivering, and having two paths confused users.
Do not add it back without first configuring custom SMTP. Key points for
whoever touches auth next:

- Signup goes through `POST /api/signup` (server-side, using the Supabase
  **admin** API: `auth.admin.createUser({ email, password, email_confirm:
  true, user_metadata: { password_set_by_user: true } })`). This creates the
  account already-confirmed — **no email is sent or required for
  signup/login.** Password reset (`Forgot Password`) still goes through
  Supabase's email sending and is the one flow still exposed to that
  reliability problem.
- Passwords are hashed by Supabase Auth (bcrypt in `auth.users`) — never
  touch our own tables or logs in plaintext. Don't build custom password
  storage; there's no reason to.
- `user_metadata.password_set_by_user` is the load-bearing flag: it marks
  "this account has a real, user-chosen password." On a signup collision
  (email already registered), the server only overwrites the password if
  that flag is **absent** — i.e. it's a pre-existing account from before
  this feature existed (magic-link era) and could never have had a real
  password. If the flag is present, it's a genuine account and the server
  correctly refuses to let someone hijack it by re-registering the email.
  **Do not remove or weaken this check** — it's the difference between "fix
  stuck legacy accounts" and "anyone can steal any account."
- The owner's account (`clujkeebs@aol.com`, hardcoded — case-insensitively,
  via `tcgss_is_owner_email()`) gets `plan='premium', is_lifetime_free=true`
  automatically on signup, enforced at the RPC layer so Stripe can never
  downgrade it even accidentally (webhook handlers filter
  `is_lifetime_free = false`).
- `LEGACY_ACCOUNT_CUTOFF` (`server.js`) is the other half of that check: the
  repair path also requires `created_at` to be **before** the cutoff. The tag
  alone is not sufficient, because the client-side fast signup path
  (`sb.auth.signUp`) creates accounts through Supabase's public endpoint,
  which does not set the tag. Without the date condition, a brand-new account
  could be taken over by anyone re-registering that email. Keep both
  conditions.
- If anyone ever asks for magic link / passwordless sign-in back, configure
  custom SMTP in Supabase Auth settings first (Resend/Postmark/SendGrid with
  a verified sending domain). Supabase's shared default sender is what broke
  it the first time, and nothing about that has changed. That's a dashboard +
  third-party-provider setup only the owner can do.

## Billing rules that are easy to break

- **Never send a customer who already has a live subscription through Stripe
  Checkout.** Checkout creates a *new* subscription next to the existing one
  and bills for both. `create-checkout-session` checks Stripe (not our own
  table, which can be stale) for a subscription in `active`/`trialing`/
  `past_due`/`unpaid`, and if there is one it changes the price on that
  subscription instead, returning `{ switched: true }` with no redirect URL.
- **Never write `plan: 'free'` for an active subscription on an unrecognised
  price.** That turns a wrong or swapped price id into "everyone who paid
  loses access." The handlers log and leave the plan untouched instead.
- **Cancellation is matched on subscription id, not just customer id.** A
  customer who cancelled and resubscribed has two subscriptions; a delayed
  cancellation event for the old one must not downgrade the new one.
- `POST /api/sync-subscription` is the escape hatch for a webhook that never
  arrived: it reads the caller's live subscription from Stripe and writes the
  plan. The client calls it automatically when the post-checkout poll gives
  up. It relinks a profile to a Stripe customer only by the `supabase_user_id`
  stamped in customer metadata — never by email, which would let one account
  claim another's subscription.

## Referral program

Refer a friend who becomes a paying customer, earn a free month — **whether
or not you've ever paid yourself.** That last part was added 2026-09-24; see
the status log entry for that date for why (short version: it wasn't true
before, and a free-tier user referring a paying friend got nothing real).
Details that matter if you touch this:

- Every profile gets an 8-character `referral_code` (random, URL-safe
  alphabet — no `0/O/1/I/L`, no `+`/`/`) the moment it's created, via the
  `tcgss_handle_new_user` trigger. Share link is `<site>/?ref=<code>`.
- `?ref=` is captured client-side into `localStorage` and applied via
  `tcgss_apply_referral_code` right after a signup completes (not login).
  That RPC is the only real gate and enforces, independently of the client:
  no self-referral, one referral per account ever, and only within ~2 hours
  of the account being created — so an old account can't retroactively
  "become referred" by clicking a link.
- **Two reward paths**, chosen at the moment the reward is actually applied
  (not when it's earned), based on whether the referrer has a live Stripe
  subscription **right then**:
  - **Paying referrer → Stripe customer balance credit**, sized to whatever
    the referrer's current plan costs AT THE MOMENT it's applied, not the
    plan they were on when they earned it. This is deliberate: it's the only
    way "one free month" means the same thing whether the referrer is on
    Base or Premium, and it lets multiple earned rewards just stack (each
    credit knocks a month off, in order, until it's used up).
  - **Everyone else (free tier, never subscribed, or currently
    lapsed/canceled) → 30 days of free Premium**, granted directly via
    `tcgss_profiles.free_until` (`tcgss_grant_referral_free_month` — same
    mechanism the creator-affiliate program uses for its free year, and
    already treated as full Premium by `tcgss_get_status` /
    `tcgss_consume_label_credits`). No Stripe involved at all — the reward is
    real access, not a discount with nothing to discount.
  Which path a given credit took is recorded on the row itself
  (`tcgss_referral_credits.applied_method`: `'stripe_credit'` or
  `'free_month_grant'`) and surfaced back via `tcgss_get_referral_stats`
  (`stripe_credits_applied`, `free_months_granted`, alongside the existing
  `applied_credits` total and `pending_credits`).
- `tcgss_referral_credits` has one row per referred user, ever (unique
  constraint) — resubscribing after a cancellation cannot earn a second
  reward for the same referral. `tcgss_record_referral_conversion` is the
  only thing that inserts a row, called from the `checkout.session.completed`
  webhook handler, and only returns the referrer's id the first time (null
  on every later call for that same referred user).
- Reward is applied via a claim/apply/release cycle designed to survive a
  webhook firing twice or two webhooks racing:
  `tcgss_claim_pending_referral_credits` atomically flips `pending` rows to
  `processing` (row-level lock — only one caller ever wins a given row).
  `applyPendingReferralCredits` in server.js then checks the referrer's live
  Stripe subscription status for each claimed row and takes whichever path
  above applies; success marks it `applied` (via `tcgss_mark_referral_credit_applied`
  for the Stripe path, `tcgss_grant_referral_free_month` for the free-access
  path — the latter also does the `free_until` update, in the same function,
  so a row can never end up `applied` without the grant actually having
  happened). Failure of either path calls `tcgss_release_referral_credit` to
  hand the row back to `pending` rather than lose it. **Never apply a reward
  without going through claim first** — that atomicity is the only thing
  preventing a double-reward on a redelivered webhook.
- Because the free-access path fires immediately (no "wait until they pay"
  step), a converted referral essentially never sits `pending` for long
  anymore — it either becomes a Stripe credit or a free-month grant right
  away, in the same webhook delivery that recorded the conversion. `pending`
  now mainly means "claim/apply is mid-flight" or "the previous attempt
  failed and is waiting to be retried," not "waiting for the referrer to
  become a customer."
- All of this is exercised in `test/referral.test.js` against a stubbed
  Stripe/Supabase — including both reward paths, the resubscription-can't-
  double-earn case, and both the Stripe-call-fails and the grant-fails
  release-not-lose cases. The original claim/apply/release plumbing was also
  verified directly against the live database (self-referral, invalid code,
  the 2-hour window, idempotent conversion) before any application code was
  written, the same way RLS was verified elsewhere in this file.
- `tcgss_referral_credits` has RLS enabled with **no policies** — that's
  intentional, same pattern as everything else here: no direct table access
  for anyone, all reads/writes go through the SECURITY DEFINER functions
  above (or the service role from server.js). Supabase's linter flags this
  as an INFO-level "RLS enabled, no policy" notice; that's expected, not a
  bug to fix.

## Fully-free (100%-off) promo codes

Any promotion code whose coupon is **100% off** is treated as a distinct
class in `create-checkout-session`, detected generically
(`coupon.percent_off === 100`) — not by hardcoding a specific code string, so
any free-giveaway code created later in the Stripe dashboard gets the same
handling automatically, no app changes needed:

- The Checkout Session is created with `payment_method_collection:
  'if_required'`. This is set on **every** checkout session, not just
  free ones — it's a no-op for a normal paid checkout (Stripe still collects
  a card whenever the amount due is > 0) and only actually skips card
  collection when a 100%-off coupon makes the total $0. Do not make this
  conditional; there's no case where it needs to be.
- IP-based redemption limiting: `tcgss_promo_ip_redemptions` (promotion code
  id + sha256 of the client IP, unique together) stops the same connection
  from claiming the same free code twice. `getClientIp`/`hashIp` in
  server.js do the extraction/hashing; the raw IP is never stored, only the
  hash. This is a deterrent, not a guarantee — shared IPs (offices, campus
  wifi, VPNs) can still collide two unrelated legitimate people onto the
  same hash. Said so explicitly to the owner when this shipped.
- The check happens **twice**: once for early UX feedback in
  `GET /validate-promo-code` (so the "Apply Code" button can say "already
  used" before checkout), and again — authoritatively — right before the
  Checkout Session is created in `create-checkout-session`, since the two
  requests aren't guaranteed to come from the same IP.
- The redemption is recorded **on actual completion** (the
  `checkout.session.completed` webhook), not at session creation. The IP
  hash and promotion code id are stamped into the session's `metadata` at
  creation time specifically so the webhook has them later without a second
  lookup. This matters: recording at creation time would burn someone's one
  redemption if they started checkout and abandoned it.
- What happens after the free month: nothing special was added, and nothing
  needed to be. A `duration: 'once'` coupon only discounts the first billing
  cycle; the renewal invoice after that has no payment method to charge
  (none was ever collected), so Stripe fails to collect and the subscription
  status moves to `past_due`. `applySubscriptionToProfile` already treats
  any status outside `active`/`trialing` as `plan: 'free'` — so paid access
  is cut off immediately, automatically, using logic that already existed
  and is already tested. If the person adds a card later and pays the
  past-due invoice, the subscription just resumes as a normal paid Base
  subscription — that's an intentional, reasonable trial→convert path, not
  an oversight.
- Recommended (not yet created — needs a human in the Stripe dashboard, or
  the Stripe connector reconnected): a coupon restricted to the Base product
  specifically, `percent_off: 100`, `duration: 'once'`, with a Promotion
  Code on top that has `restrictions.first_time_transaction: true` set. That
  restriction is Stripe-native and stops the *same Stripe customer* from
  reusing the code across a cancel/resubscribe cycle — it's the other half
  of the protection the IP table provides (which stops different *new*
  accounts on one connection, not repeat use by one already-existing
  customer).

## SEO: the /guide/ pages

The site's long-form shipping-guide content used to live entirely inside
`public/index.html`, in a "Guide" tab (`#tab-guide`) rendered by client-side
JS with no URL of its own — reachable only by clicking through the nav's
"More" menu, no hash, no history entry. That meant Google had one single
title/meta description/canonical/H1 covering the tool AND the guide AND the
FAQ AND everything else, and nobody could link directly to, say, the printer
comparison. The content itself was already genuinely good; it just had no
way to rank for its own specific searches.

Fixed by extracting it into real static pages under `public/guide/`, each
with its own `<title>`, meta description, canonical URL, single `<h1>`,
Article/HowTo/BreadcrumbList JSON-LD, and cross-links to the others and back
to the app:

- `/guide/` — hub page, links to all of the below.
- `/guide/tcgplayer-shipping-guide.html` — the original guide content
  (tiers, supplies, packing, workflow, reputation, troubleshooting), minus
  the printer section, which now lives on its own page and is linked from
  here instead of duplicated.
- `/guide/thermal-printer-comparison.html` — Rollo vs. Dymo vs. MUNBYN vs.
  Zebra, now a dedicated comparison page with a real table.
- `/guide/how-to-print-tcgplayer-shipping-labels.html` — new, tool-usage
  focused, carries `HowTo` schema.
- `/guide/tcgplayer-packing-list-csv-format.html` — new, explains the CSV
  export and the most common parsing/missing-order problems.
- `/guide/free-vs-paid-tcgplayer-shipping-tools.html` — new, honest
  comparison of manual/free/Base/Premium, mentions the 1MFREE promo code.

All five share `public/guide/guide.css` (one stylesheet, cached once,
instead of duplicating a `<style>` block six times).

**If you touch guide content again: edit it in `/guide/`, not back inside
`index.html`.** The in-app "Guide" tab is now deliberately just a teaser
linking out to these pages — pasting the full content back into the tab
would create duplicate content competing with the real pages for ranking,
undoing the entire point of this change.

Also fixed while in here, both real (not cosmetic) SEO issues:
- **`index.html` had seven `<h1>` tags** — one per tab, all present in the
  DOM regardless of which tab was visually active. A page should have
  exactly one. All but the Home tab's ("Ship Cards Faster") are now
  demoted to `<h2>`/`<h3>` as appropriate.
- **The SPA had no hash routing at all** — `switchTab()` never touched the
  URL, so there was no way to link directly to a specific tab from
  anywhere, including the new `/guide/` pages' own CTAs. `switchTab` now
  syncs `location.hash` (e.g. `/#pricing`), and `openTabFromHash()` runs on
  boot and on `hashchange` so a link like `/#pricing` actually opens that
  tab instead of silently landing on Home. `VALID_TABS` in `index.html`
  lists the tab names this recognizes — keep it in sync with any new
  `tab-panel` id.

`sitemap.xml` was updated with all five new URLs. `robots.txt` already
allows everything under `/guide/` (`Allow: /`), no change needed there.
`googleff1e1a4a0e2eceaf.html` is the live Google Search Console
verification file — do not delete or rename it.

## Creator affiliate program (cash commission — separate from the consumer referral program)

A second, unrelated referral-shaped system, added because the owner started
personally recruiting content creators as paid partners. Do not confuse this
with the consumer "refer a friend, get a free month" program above — they
share a design pattern (a code, a link, an attribution window) but nothing
else. This one moves real money and has real legal/tax weight; that one
never leaves the app's own Stripe balance.

- **The deal**: no upfront payment. A partner gets a personal `?aff=CODE`
  link and a private dashboard (`/affiliate/?token=...`, token-authenticated,
  not a Supabase session — creators mostly won't have a TCGSS account at
  all). They earn **30% of every payment**, forever, from anyone who signs
  up through their link — not a one-time bonus. Paid out **monthly, by the
  owner, manually** (Venmo/PayPal/whatever) — there is no automated payment
  rail here, on purpose; see "Not yet done" below for why that matters.
  They get a free month to try the app themselves, and a free year on their
  own account once they commit. The agreement runs one year.
- **Attribution**: `tcgss_profiles.affiliate_id`, set once via
  `tcgss_apply_affiliate_code` (client captures `?aff=` into localStorage,
  applies right after signup) — same shape of guards as the consumer
  referral code (one-time, ~2-hour window, no self-referral), except
  self-referral here is checked by **email**, not by `user_id`, because an
  affiliate's own first signup happens before their account is linked to
  their affiliate record. If you ever touch that function, keep the email
  check — checking `user_id = auth.uid()` alone lets an affiliate's very
  first signup slip through unblocked, since `user_id` is null at that
  point. (Found and fixed this exact bug while building it, verified
  directly against the database before it ever reached server.js.)
- **Earnings**: computed from **`invoice.payment_succeeded` only** — not
  `checkout.session.completed`, not the subscription webhooks. This event
  fires for every paid invoice, first payment and every renewal alike, so
  it's the one place "30% of everything, forever" can be computed correctly
  without double-counting. `tcgss_record_affiliate_earning` is idempotent on
  `stripe_invoice_id` (unique constraint), so a redelivered webhook can never
  double-credit the same payment. **The live Stripe webhook endpoint's
  `enabled_events` had to be updated** to add `invoice.payment_succeeded` —
  it wasn't there before this feature and the handler is dead code without
  it. If you ever recreate the webhook endpoint, remember to include it.
- **The free year**: `tcgss_profiles.free_until` (new column), set by
  `tcgss_activate_affiliate` to one year from activation. Deliberately
  **not** `is_lifetime_free` — that flag is the owner's permanent grant and
  nothing else should ever set it. `tcgss_get_status`/
  `tcgss_consume_label_credits` treat `free_until > now()` the same as
  lifetime for plan purposes, but it actually expires.
- **Admin routes** (`/api/admin/affiliates*`) are gated by `requireOwner` in
  server.js — a hardcoded email check mirroring `tcgss_is_owner_email()` in
  the database. Use these to onboard someone once they've actually agreed:
  `POST /admin/affiliates` (create — returns their link and dashboard URL to
  send them), `POST /admin/affiliates/:id/activate` (starts the 1-year
  clock, grants the free year), `GET /admin/affiliates` (everyone's current
  balance, for the monthly payout run), `POST /admin/affiliates/:id/mark-paid`
  (call after actually sending the money).
- **RLS**: `tcgss_affiliates` and `tcgss_affiliate_earnings` have RLS enabled
  with no policies — same pattern as everything else here, all access is
  through SECURITY DEFINER functions or the service role.

### Not yet done / real gap here

**There is no payment rail.** The dashboard shows what's owed; nothing
actually sends money. The owner pays each partner by hand every month
(Venmo, PayPal, whatever) and then calls `mark-paid` to clear the ledger.
Building real payouts (Stripe Connect or similar) is a genuinely separate,
much larger project — KYC/onboarding per partner, payout scheduling,
failure handling — and wasn't attempted here.

**Tax/legal reality worth surfacing to the owner, not something I can fix in
code**: paying any one person or business $600+ in a calendar year in the US
generally creates a 1099-NEC filing obligation, which means collecting a W-9
from each partner before the first payout. Nothing in this system collects
that. Also: nothing here is an actual written contract — the terms in the
outreach email are the whole agreement right now. Worth the owner tightening
that up before the numbers get large enough to matter.

**Only 5 outreach emails were actually sent** (2026-09-13, to Team APS, MBT
Yu-Gi-Oh!, TOTALmtg, Lorcana Villain, and Don Diego Trading) — the only
creators found with a verified public business email in that session's
research. See the published "Creator Outreach List" artifact from that
conversation for the other ~25 real, named, but unverified-contact creators.

## Tests

`npm test` runs six suites (`test/`) with stubbed Stripe and Supabase
clients. No network, no live keys, runs in this sandbox:

- `signup.test.js` — pins both conditions gating the password-repair path, so
  the account takeover cannot be reopened. Also email normalisation, input
  validation, throttle.
- `checkout.test.js` — the upgrade/switch/first-purchase/owner paths and the
  webhook handlers.
- `webhook-signature.test.js` — drives the real Netlify function handler with
  genuine Stripe signatures, plain and base64 bodies, both path prefixes.
  Forged, unsigned and tampered deliveries are confirmed to write nothing.
- `referral.test.js` — the referral credit lifecycle: immediate application,
  pending-until-the-referrer-pays, one reward per referral ever even across a
  resubscription, and a failed Stripe call releasing rather than losing the
  claim.
- `free-promo.test.js` — the 100%-off promo path: `if_required` payment
  collection, the IP hash stamped into session metadata, redemption recorded
  only on actual completion (not session creation), a second attempt from
  the same IP refused before Stripe is touched, a different IP still
  allowed, and a non-100%-off code confirmed never subject to any of this.
- `affiliate.test.js` — earnings recorded only from `invoice.payment_succeeded`
  with the right invoice/customer/amount, a $0 invoice and an unrecognised
  customer both handled without error, the dashboard endpoint 404s cleanly
  on a bad or missing token without touching the database, and every admin
  route confirmed owner-only.

- `csv-parser.test.js` — the browser's CSV/paste parser (`public/js/shipper-core.js`)
  against realistic TCGplayer exports: column matching, quoting, BOMs,
  multi-line fields, item vs. "Product Weight"/"Item Count", PDF-safe text.

Run it before pushing anything that touches billing, auth, or parsing.

## Known-good, verified this session

- Supabase RLS on every `tcgss_*` table: tested directly (not just read from
  config) — e.g. `tcgss_newsletter_subscribers` allows `anon` to insert but
  a `select` immediately after by that same role returns 0 rows for a row
  proven to exist.
- `tcgss_consume_label_credits` / `tcgss_get_status` limit math (free=5,
  base=500, premium/owner=unlimited) checked directly against the DB.
- Promo code flow (Stripe Checkout `discounts` vs `allow_promotion_codes`,
  currency-aware description, correct `promoApplied` flag on fallback).
- Netlify routing under both path prefixes (simulated a real Netlify event
  locally, confirmed both resolve).
- Password-field CSS bug and the Create-Account dead-end for pre-existing
  users (see below) — both fixed and deployed.

## NOT yet done / explicitly deferred

- **No real, live, end-to-end paid checkout has been completed** since the
  auth rewrite and the Supabase pause/restore. Individual pieces are
  verified (routing, RLS, Stripe webhook config) but the full chain — sign
  up → upgrade → real Stripe Checkout → webhook fires → plan updates in
  Supabase — has not been watched happen for real. **This is the top
  priority for whoever picks this up next**, and the owner said they'd
  rather test it with a 100%-off one-time promo code than a real charge —
  ask before creating that code if it doesn't already exist.
- Supabase Auth setting **"Leaked Password Protection"** is disabled — a
  dashboard toggle, newly relevant now that real passwords exist. Not done
  (no MCP tool for Auth config in this environment).
- No custom SMTP configured for Supabase — "Forgot Password" emails use the
  same unreliable shared sender that caused the original bug. Only affects
  password reset now, not signup/login, but worth fixing for real users who
  forget their password.
- Rate limiting on `POST /api/signup` is a best-effort in-process throttle
  only (`server.js`, `signupAttempts` Map) — Netlify Functions aren't
  guaranteed to stay warm between invocations, so this is weak. Fine for
  now, not fine if abuse becomes real.
- The Stripe MCP tool in this environment periodically needs re-auth
  (session-dependent) — if it's unavailable, tell the owner rather than
  guessing at Stripe state.
- This sandbox/environment cannot make direct outbound calls to
  `*.supabase.co` or `api.stripe.com` (network egress policy) — only MCP
  tool calls reach them. Don't waste time debugging "connection refused"
  from a local `curl`/`node` test against those hosts; it's the sandbox, not
  the app. Test through the MCP tools or ask the owner to test the live
  site directly.

## A privacy note

A handful of real people had already signed up via the old magic-link flow
before this rewrite (found via Supabase logs while debugging the reported
"Create Account doesn't work" bug). Their accounts are fixed and will
self-repair the next time they try to sign up again — but **their email
addresses are deliberately not listed in this file** or anywhere else in the
repo. Don't paste real user PII into committed files; query the database
directly if you need to look someone up.

---

## Two things that will bite you if you don't know them

1. **Never tick "Contains secret values" on a Netlify env var this app needs.**
   Variables stored that way are not readable by the function at runtime. Three
   keys were stored that way and every `/api/*` route returned 503 as a result —
   signup looked broken while login (browser→Supabase direct) kept working.
   `/api/health` reports exactly which vars the function can actually see; use
   it first whenever the API misbehaves.
2. **Never build API clients at module load without a guard.** `server.js`
   originally called `new Stripe(...)` / `createClient(...)` unconditionally at
   require time, so one missing env var threw and killed the entire function.
   They're now built defensively with per-route 503s. Keep it that way.

## Status Log

Append new entries below, most recent last. Include date, who you are, and
what you did/found/changed.

### 2026-09-11 — Claude (Sonnet 5)
Built the whole payment-tiers feature this session: Free/Base/Premium
plans, Supabase backend, Stripe billing, promo codes, newsletter signup,
Netlify+Supabase+Stripe wiring. Found and fixed: the Supabase project had
been auto-paused (restored it — likely explains outages beyond just the
reported bug); replaced magic-link auth with email+password since the
shared email sender wasn't reliably delivering; found via Supabase auth
logs that the initial fix for that only covered *unconfirmed* stuck
accounts, while several real users had *confirmed-but-passwordless*
accounts from the old flow — fixed with the `password_set_by_user`
metadata approach described above, verified against the live DB that it
covers all affected accounts; fixed a CSS bug where the new password input
wasn't covered by the site's input styling at all.

Owner asked me to skip a full live payment-flow test for now (will do it
themselves in the morning with a 100%-off promo code) and to leave this
handoff doc in case their usage limit cuts the session short before that
happens. If you're reading this because that happened: the payment flow
top-priority item above is genuinely untested end-to-end — start there.

### 2026-09-11 — Claude (Sonnet 5), same day, follow-up
User counts as of this entry: **5 signed up, 0 paying** (4 on Free, 1 the
owner's lifetime-free account). Re-added magic link as an optional,
secondary sign-in method per the owner's request (see Auth model section —
`shouldCreateUser: false`, does not fix underlying email reliability, just
restores it as a convenience alongside the reliable password path). Dropped
all of the old "vischeck" app's tables (`businesses`, `scans`, `queries`,
`results`, `subscriptions`, `alerts`, `scan_requests`, plus the orphaned
`scan_status` enum) at the owner's explicit request — verified every one
was genuinely empty (0 rows) immediately before dropping, and confirmed via
`get_advisors` that the "RLS enabled, no policy" warnings for all seven are
gone post-drop with nothing new introduced. The Supabase project is no
longer shared with anything else.

The full live payment-flow test is still the top priority and is still
untested end-to-end — that has not changed.

### 2026-09-11 — Claude (Opus 5), evening
Sign-in and signup now confirmed working by the owner on the live site.

Root cause of the "can't sign up" outage: three env vars were stored with
Netlify's "Contains secret values" flag and were therefore invisible to the
function, so `createClient`/`new Stripe` threw at module load and every
`/api/*` route died. Fixed by re-storing them as normal vars, and hardened
so it can't recur silently (defensive client init + per-route 503s +
`/api/health` naming missing vars).

Magic link removed entirely — password is now the single auth path.

Security fix worth knowing about: the signup collision handler repaired
(overwrote the password of) any account lacking the `password_set_by_user`
tag. The client-side fast signup path creates accounts via Supabase's public
endpoint, which doesn't set that tag — meaning a freshly created account
could be taken over by anyone entering that email with a new password.
Repair now additionally requires `created_at < LEGACY_ACCOUNT_CUTOFF`
(2026-09-11). If you ever touch that logic, keep the date condition: it, not
the tag, is what makes overwriting safe.

Still open: the leaked-password-protection toggle in Supabase Auth (owner
action), custom SMTP for password-reset reliability (owner action), and the
end-to-end paid checkout, which the owner has reviewed but which still has
not been run for real.

### 2026-09-11 — Claude (Opus 5), later the same evening
Owner asked for a robustness pass before emailing their existing users. No
live payment test was run (still deferred to the owner); this was code and
database work only.

User counts at this entry: **5 signed up, 0 paying** — 1 owner
(lifetime-free Premium), 4 on Free. Checked every one of the 4 untagged
legacy accounts against `LEGACY_ACCOUNT_CUTOFF`: all were created
2026-08-31 or earlier, so all 4 will self-repair when they click Create
Account. That matters because those are exactly the people about to be
emailed. The login error message already points them at Create Account
when their password fails.

Found and fixed a real double-charge: a Base subscriber clicking "Upgrade
to Premium" was sent through Checkout, which starts a second subscription
next to the first. They would have paid $1.99 *and* $5.99 every month. See
the billing rules section above — that whole section is new and is there so
nobody reintroduces any of it.

Also closed two ways a paying customer could have been recorded as Free (an
unmapped price id, and a stale cancellation event), and added
`/api/sync-subscription` so a webhook that never arrives no longer strands
someone who has paid.

Added the `test/` suites described above — 74 assertions, all passing. The
webhook one is the useful one: it proves the raw request body survives
Netlify → serverless-http → Express with real Stripe signature
verification. If that plumbing ever broke, every payment would silently
stop converting to a paid plan with no error anywhere.

Supabase security advisors unchanged: the two `SECURITY DEFINER` warnings
are intentional (both functions derive identity from `auth.uid()`, so a
caller can only affect their own row), plus the leaked-password toggle,
which is still an owner dashboard action.

Still open and unchanged: leaked-password protection (owner), custom SMTP
for password reset (owner), and the end-to-end live paid checkout, which
still has not been run for real.

### 2026-09-24 — Claude (Sonnet 5)
Owner asked for a "make sure it's working great for paying users" pass.
User counts at this entry: **5 paying** (2 premium, 3 base — the end-to-end
live paid checkout from the item above has since happened for real, several
times over; this doc just hadn't been updated). Live site/deploy healthy,
real label-generation usage happening daily.

Found and fixed a real account-lockout bug via the auth logs: the signup
button tried a direct `sb.auth.signUp()` "fast path" before falling back to
`/api/signup`. This project has email confirmation ON, so that path never
actually signs anyone in — but it *does* create an unconfirmed account
first. Supabase's shared email sender (already known-unreliable — see the
auth model section above) then rate-limited the confirmation email, and the
user was stuck: login said "email not confirmed", `/api/signup` correctly
refused to touch a same-day account (LEGACY_ACCOUNT_CUTOFF is what stops
account takeover, working exactly as designed), and "Forgot Password" hit
the same unreliable sender. A real prospective customer hit this exact
trap yesterday (2026-09-23) across three email addresses before escaping on
the third. Removed the fast path entirely — signup now always goes through
`/api/signup` (admin API, `email_confirm: true`, no email ever sent, so this
whole failure class can't happen). Directly repaired the two accounts still
stuck from that (`onecardebay@gmail.com`, `onecardcollectibles@gmail.com`) —
confirmed them and tagged `password_set_by_user` so they can log in with the
password they already set. Full `npm test` still green (unaffected — this
was a client-only code path, no server tests cover it).

Also fixed the `auth_rls_initplan` performance advisory on
`tcgss_profiles`/`tcgss_label_usage` (wrapped `auth.uid()` as
`(select auth.uid())` in both SELECT policies) — pure query-plan fix, no
behavior change, verified via `get_advisors`.

Confirmed still-intentional and left alone: the "RLS enabled, no policy"
INFO notices and the `SECURITY DEFINER` WARN notices (same pattern
documented above — everything goes through SECURITY DEFINER functions or
the service role, by design).

Still open, unchanged, still owner-only dashboard actions: leaked-password
protection, custom SMTP for password reset. Worth prioritizing the SMTP one
now — it's the same unreliable-sender problem that caused today's bug, and
it's still the live path for "Forgot Password."

### 2026-09-26 — Claude (full audit pass)
Owner asked for a deep "make it bulletproof" pass. Counts at this entry: 14
profiles, 8 on a paid plan (incl. the owner).

**Security fix, applied directly to the live database:**
`tcgss_grant_referral_free_month` was executable by `anon` and
`authenticated` through PostgREST (`/rest/v1/rpc/...`, with the public anon
key from index.html), and it extended `free_until` for whatever user id it was
given without checking that a claimed credit existed. Anyone could have given
themselves unlimited free Premium. I checked first: no profile had
`free_until` set, so it had not been used. Fixed via migration
`tcgss_lock_down_referral_free_month_grant`: EXECUTE revoked from
public/anon/authenticated (service_role only), and the function now extends
`free_until` only if it actually flipped a `processing` credit for that
referrer (this also makes a replayed call a no-op). Advisors confirm it's gone.
**Root cause to remember:** Supabase grants EXECUTE on every new `public`
function to anon/authenticated by default. Any new server-only SECURITY
DEFINER function needs an explicit
`revoke execute ... from public, anon, authenticated` in the same migration.
Every other server-only function was already locked down, so this one
was missed when it was added on 2026-09-24.

**Bugs fixed:**
- CSV parser: TCGplayer's shipping export has "Product Weight" and
  "Item Count" columns, and the loose header match picked "Product Weight" as
  the item name, so packing slips listed weights ("• 0.12") as items. The
  parser also split rows on newlines before handling quotes, so any quoted
  field with a line break shifted every column after it. It had no
  escaped-quote (`""`) support, and an earlier "Order Date" column could
  beat an exact "Order #". I rewrote it as a real RFC 4180 reader with
  exact-before-substring column matching and per-field exclusions, moved it
  to `public/js/shipper-core.js`, and pinned it with `test/csv-parser.test.js`.
- Forgot Password never let anyone set a new password. The reset link signs
  the user in with a recovery session (`PASSWORD_RECOVERY` event), which the
  app ignored. It now opens a "choose a new password" panel, and signed-in
  users get a Change Password button.
- "Manage Billing" was disabled for anyone with `free_until`, so a paying
  customer who also earned a free month or affiliate year couldn't reach the
  portal to cancel a subscription that was still billing them. It's always
  enabled now; the server explains when there's nothing to manage.
- Referral box didn't appear after logging in until a page reload
  (`onAuthStateChange` didn't refresh referral stats). Supabase calls in that
  callback are now deferred with `setTimeout`, per supabase-js guidance, to
  avoid its auth-lock deadlock.
- Long names/addresses ran off the edge of labels. Text now shrinks to fit.
  Characters outside jsPDF's built-in font set (e.g. "ễ", "ł", CJK) printed
  as garbage and now become their base letter or a visible "?".
- The CSV error message was injected into innerHTML unescaped.

**Hardening:** security headers in `netlify.toml` (nosniff, frame-ancestors
none, Referrer-Policy; the affiliate dashboard gets `no-referrer` + noindex
because its secret token is in the URL); the signup throttle now uses the
same client-IP parsing as the promo code; the promo-code check is rate
limited (20 per 10 min per IP) against brute-forcing.

**Legal:** new `terms.html` (auto-renewal, cancellation, refunds, disclaimers,
liability cap, not affiliated with TCGplayer). Rewrote `privacy.html` to
cover what's actually stored now (referral/affiliate attribution, hashed-IP
promo check, Netlify hosting, retention, deletion/access requests, contact
email). Stripe Checkout shows an auto-renewal/cancellation disclosure
(`custom_text.submit`, tested). The pricing page states the renewal terms,
signup has a Terms/Privacy consent line, and the footer has a trademark +
"this isn't postage" disclaimer. **Owner should review two
commitments made on their behalf in terms.html:** the 14-day "we'll make it
right" refund window (§5), and the governing-law clause, which says "the state
where the operator resides" because the state isn't known. Put the actual
state in if you want.

**New:** `support.html` (troubleshooting, billing and cancellation answers, a
live `/api/health` status line, and a prefilled support email with browser
details). New print formats on every plan: Avery 5160 (30 address labels per
sheet) and #10 envelopes, both aimed at plain-white-envelope orders. Also:
shipping method shown on preview cards and slips, item count on slips, "+N
more" instead of item lists printed off the page, and the chosen format is
remembered between visits.

Verified: `npm test` (7 suites) green, plus a headless-Chromium run of the
real page generating every format with a tricky CSV, with the PDFs rendered
and inspected. Not verified live: the password-recovery panel (needs a real
reset email) and the Checkout disclosure text in the actual Stripe UI.

Still open (owner-only dashboard actions, unchanged): leaked-password
protection, and custom SMTP for password-reset email reliability. The
recovery flow now works end-to-end, but only if the email arrives.

### 2026-09-26 (later) — Claude: shipping plan, blog, outreach review
**Numbers at this entry:** 7 active subscriptions (4 Premium, 3 Base), 5
signups in the last 7 days, 456 labels printed this month, about 70% of
them by a single Premium user.

**New feature: Shipping Plan** (`index.html` + `shippingTier`/`parseMoney`
in `public/js/shipper-core.js`, tested in `csv-parser.test.js`). It reads
"Value Of Products" from TCGplayer's shipping export and tags each order by
TCGplayer's published seller guidelines: over $20 tracking recommended,
$49.99+ tracking required, $250+ signature required. Buyers who paid for
expedited shipping always go to tracked. With no value column it falls back
to "unknown" (no guessing) unless the method is expedited. A "Print" filter
(all / envelopes only / tracked only / not yet marked shipped) decides which
orders go into the PDF. **Billing changed from per-batch to per-order**
(`paidOrderKeys`): printing envelopes then tracked labels from one CSV costs
the same as printing everything once, and a later re-download is free. The
thresholds are TCGplayer's rules, not ours. If TCGplayer changes them,
update `shippingTier` and the new guidelines blog post together.

**Blog:** four new posts targeting low-competition queries from keyword
research: tcgplayer-shipping-guidelines (~210/mo for "tcgplayer shipping
guidelines"), how-to-ship-trading-cards-in-a-plain-white-envelope,
tcgplayer-shipping-not-confirmed (~120/mo combined), and
tcgplayer-free-shipping-for-sellers (~140/mo for "tcgplayer free shipping").
Also added to the blog index, sitemap and Blog JSON-LD, with cross-links
from five older posts. The homepage meta description and WebApplication
schema now mention envelopes, Avery and the shipping plan. The site audit
scored 100/100 on on-page SEO, so there were no technical fixes to make.
Search Console is **not** connected to the SEO tooling here, so no real
ranking or click data is available. Connecting it is the next SEO unlock.

**Outreach, reviewed and paused:** about 200 sent threads in 30 days, nearly
all the same "30% revenue-share partnership" pitch to TCGplayer hobby shops.
The result was **zero human replies**: only auto-responders, plus 8 bounces
that hurt the Gmail account's sender reputation. Two problems:
(1) wrong audience. Large shops ship with bulk tools and have no audience of
small sellers to promote to. (2) **The emails aren't CAN-SPAM compliant**:
cold commercial email needs a physical postal address and an opt-out line,
and they had neither. Don't send more cold commercial email without both.
The owner needs to supply a mailing address (a P.O. box works).
What was done instead:
- Sent: a personal thank-you and feedback request to the top power user.
- Drafted in Gmail, not sent: a "what's new" email to the 7 paying
  customers (BCC). It's a product-update message to existing subscribers,
  but it announces features that only exist after this branch merges and
  deploys, so send it after that. Also drafted: a win-back email to the 4
  dormant August free accounts. It's commercial, so it has an opt-out line
  and a `[YOUR MAILING ADDRESS]` placeholder that must be filled before
  sending.
The 2 extra free accounts `onecard*` are the same person as the
`onecardpokemon` Base subscriber (from the old signup bug), so they're
excluded from the free-user emails.
