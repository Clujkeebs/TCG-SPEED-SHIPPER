# TCG Speed Shipper

A fast tool that converts TCGplayer CSV order exports (or pasted addresses) into ready-to-print shipping labels and packing slips.

## How it works
1. Upload your TCGplayer CSV file (or paste addresses, on Premium)
2. Instantly generate printable labels
3. Print and ship

## Plans
- **Free** — 5 labels/month, no account required
- **Base ($1.99/mo)** — 500 labels/month
- **Premium ($5.99/mo)** — unlimited labels, paste-address labels, Design Studio (custom colors/fonts/message/QR code), multiple saved return-address profiles, no "Powered by" branding on packing slips

All label/PDF generation still happens entirely in the browser — CSV contents, buyer names, and shipping addresses are never uploaded, whether or not you're signed in. See [`public/privacy.html`](public/privacy.html) for details.

## Architecture
- **Static site**: `public/` — served directly by Netlify's CDN.
- **API**: `server.js` (Express) — wrapped as a single Netlify Function (`netlify/functions/api.js`, via `serverless-http`) exposing `/api/create-checkout-session`, `/api/create-portal-session`, and `/api/stripe-webhook`. `netlify.toml` redirects `/api/*` to it.
- **Database/Auth**: Supabase (`tcgss_*` tables, RLS policies, and RPCs — see the `tcgss_profiles` / `tcgss_label_usage` tables and the `tcgss_get_status` / `tcgss_consume_label_credits` functions).
- **Billing**: Stripe subscriptions (Checkout + Billing Portal + webhooks).

### Local development
```
npm install
STRIPE_SECRET_KEY=... SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... PUBLIC_SITE_URL=http://localhost:3000 node server.js
```
This runs just the API routes on port 3000 (or `$PORT`) for testing; the static site itself is served by Netlify in production and can be opened directly from `public/index.html` locally.

### Required environment variables (set in the Netlify site's dashboard)
| Variable | Purpose |
|---|---|
| `STRIPE_SECRET_KEY` | Stripe secret API key |
| `STRIPE_WEBHOOK_SECRET` | Signing secret for the `/api/stripe-webhook` endpoint |
| `STRIPE_PRICE_BASE` | Stripe Price ID for the $1.99/mo Base plan |
| `STRIPE_PRICE_PREMIUM` | Stripe Price ID for the $5.99/mo Premium plan |
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key (server-side only, never exposed to the browser) |
| `PUBLIC_SITE_URL` | The site's public URL, used for Stripe redirect/return URLs |

## Author
Built by Clujkeebs
