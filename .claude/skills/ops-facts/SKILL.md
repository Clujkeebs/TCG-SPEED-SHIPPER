---
name: ops-facts
description: IDs and facts for TCG Speed Shipper's production stack (Railway, Supabase, Stripe, DNS, Gmail, routines). Load instead of re-discovering them with list/search calls. Use whenever a task touches deploys, the database, billing, email or DNS.
---

# TCG Speed Shipper: ops facts (no secrets here, ever)

## Hosting: Railway
- Project `21eb3344-88af-4a90-a884-da7682ad7b13`, service `web`
  `d74a1a39-c951-4e5e-9fc9-e885d86cfe83`, env production
  `3b7975f0-aeb1-40ed-91d1-d2436c5eb6f6`.
- Every merge to `main` auto-deploys (~1 min). **Never ask the owner to
  deploy.**
- Health check: `/api/health`. Boot log line: `self-check stripe_key=…
  supabase_key=… webhook_secret=…`.
- **Never call `list-variables`** (it returns plaintext secrets). Set
  non-secret variables with `set-variables` only.
- Netlify is the fallback only: its Free credits ran out, and it still
  301s the old netlify.app domain.

## DNS: Porkbun (the owner's; agents can't edit it)
- Apex ALIAS → `oeiwafy8.up.railway.app`.
- `www` CNAME must be `zpcjr8pk.up.railway.app`, plus a Railway TXT
  record.
- Once `www`'s certificate is valid, add `includeSubDomains` to HSTS in
  `server.js` `HEADER_RULES`.

## Supabase: project `lwqnsvlfffugyvwblqaz`
- `tcgss_profiles` (plan: free/base/premium), `tcgss_daily_events` (day,
  event, source, count), `tcgss_newsletter_subscribers` (status,
  unsub_token, last_sent_at), `tcgss_affiliates`,
  `tcgss_affiliate_earnings`, `tcgss_referral_credits`,
  `tcgss_label_usage`, `tcgss_event_log`.
- Server-only SECURITY DEFINER functions need `revoke execute`.
- Read counts, never dump emails into the chat or commits.

## Stripe: live account `acct_1TUsEBPpFiI6sg2W`
| Plan | Price ID |
|---|---|
| Base $2.99/mo | `price_1UKez8PpFiI6sg2WWvMW35e3` |
| Base $29/yr | `price_1UKezHPpFiI6sg2Wvjo4Dffd` |
| Premium $5.99/mo | `price_1U00srPpFiI6sg2W7Ps9Z7qK` |
| Premium $59/yr | `price_1UKezLPpFiI6sg2Wzr5ANRaG` |

- Legacy Base $1.99: `price_1U00soPpFiI6sg2WQvzev0Rm`. Existing subscribers
  keep it.
- Webhook `we_1U00t9PpFiI6sg2Wv3qJr9gd` → `/api/stripe-webhook`. Portal
  `bpc_1UEXTjPpFiI6sg2WgLgQfJh3`.
- Money moves and price changes need the owner (PERMISSIONS.md).

## Email
- **Domain addresses** (Porkbun forwarding, all to the owner's Gmail):
  - support@ (site default), privacy@, billing@, partners@, hello@
    (Enterprise), newsletter@, samuel@ (owner outreach), abuse@,
    postmaster@, dmarc@
  - `npm test` fails if the personal Gmail appears on a public page.
- Sends go from the owner's Gmail (clujkeebs@gmail.com). Sign off "Sam"
  or "Sam (Clujkeebs)".
- **Marketing email needs the owner's physical mailing address in the
  footer.** It's on file in the Gmail draft "TCGSS mailing address (email
  footer)". Never commit it.
- Customer mmuszak34 (label + slip request) has been answered twice. The
  owner says don't reply again.

## Routines (claude-code-remote triggers)
- `trig_01SGNpeD3mDQKvZHvLWHX7vd`: 5am PT daily DAS morning start.
- `trig_01DggDU118SsmiK6yzmFuYv8`: Tuesday 7:52am PT newsletter send.
- The owner wants no hourly check-ins; one-off `send_later` is fine.

## Repo conventions
- Work on branch `claude/app-audit-improvements-svd7q7`. Merge your own
  green PRs. Never push to `devin/*`.
- `npm test` runs 14 suites. `test/site.test.js` checks every page: SEO
  meta, one `<main>`, one `<h1>`, sitemap entry, internal links, no
  third-party scripts, no duplicate top-level functions, no conflict
  markers.
- `public/index.html`'s main script is one IIFE, so its functions aren't
  on `window`. Drive the UI in Playwright instead: upload a CSV to
  `#csv-input`, then click `#dl-btn`.
- The Pricing tab opens via `/#pricing`; `/#enterprise` scrolls to the
  Enterprise card.
