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

Refer a friend who becomes a paying customer, earn a free month. Details
that matter if you touch this:

- Every profile gets an 8-character `referral_code` (random, URL-safe
  alphabet — no `0/O/1/I/L`, no `+`/`/`) the moment it's created, via the
  `tcgss_handle_new_user` trigger. Share link is `<site>/?ref=<code>`.
- `?ref=` is captured client-side into `localStorage` and applied via
  `tcgss_apply_referral_code` right after a signup completes (not login).
  That RPC is the only real gate and enforces, independently of the client:
  no self-referral, one referral per account ever, and only within ~2 hours
  of the account being created — so an old account can't retroactively
  "become referred" by clicking a link.
- The reward is a **Stripe customer balance credit**, not a coupon — sized
  to whatever the referrer's current plan costs AT THE MOMENT it's applied,
  not when it was earned. This is deliberate: it's the only way "one free
  month" means the same thing whether the referrer is on Base or Premium,
  and it lets multiple earned rewards just stack (each credit knocks a
  month off, in order, until it's used up).
- `tcgss_referral_credits` has one row per referred user, ever (unique
  constraint) — resubscribing after a cancellation cannot earn a second
  reward for the same referral. `tcgss_record_referral_conversion` is the
  only thing that inserts a row, called from the `checkout.session.completed`
  webhook handler, and only returns the referrer's id the first time (null
  on every later call for that same referred user).
- Credit is applied via a claim/apply/release cycle designed to survive a
  webhook firing twice or two webhooks racing:
  `tcgss_claim_pending_referral_credits` atomically flips `pending` rows to
  `processing` (row-level lock — only one caller ever wins a given row).
  server.js then calls Stripe for each claimed row; success marks it
  `applied` via `tcgss_mark_referral_credit_applied`, failure calls
  `tcgss_release_referral_credit` to hand it back to `pending` rather than
  lose it. **Never apply a credit without going through claim first** — that
  atomicity is the only thing preventing a double-credit on a redelivered
  webhook.
- If the referrer isn't a paying customer yet when their referral converts,
  the credit sits `pending` — no error, nothing lost. It gets applied the
  next time that referrer's own subscription goes active, whether that's
  their first purchase or a later renewal (both `checkout.session.completed`
  and `applySubscriptionToProfile` call `applyPendingReferralCredits` on
  every active-status transition).
- All of this is exercised in `test/referral.test.js` against a stubbed
  Stripe/Supabase — including the resubscription-can't-double-earn case and
  the Stripe-call-fails-so-release-not-lose case. It was also verified
  directly against the live database (self-referral, invalid code, the
  2-hour window, idempotent conversion, claim/apply/release) before any
  application code was written, the same way RLS was verified elsewhere in
  this file.
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

## Tests

`npm test` runs five suites (`test/`) with stubbed Stripe and Supabase
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

Run it before pushing anything that touches billing or auth.

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
