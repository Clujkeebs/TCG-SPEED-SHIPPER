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

Plans: Free (5 labels/mo, no account) · Base $1.99/mo (500/mo) · Premium
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
