---
name: health-check
description: Check that tcgspeedshipper.com is healthy for customers - deploy status, 5xx rate, real 404s, domain/cert, boot self-check. Use for "is everything working", morning start, after deploys, or when a customer reports a problem.
---

# Health check (about 5 calls; IDs in `ops-facts`)

Run these in parallel:
1. `mcp__Railway__list-deployments` (limit 3): the latest should be SUCCESS
   and match `main`'s head.
2. `mcp__Railway__http-error-rate` (hoursBack 24): the 5xx count should
   be 0.
3. `mcp__Railway__get-logs` with types `["http"]` and filter
   `@httpStatus:>=400`, limit 60. Ignore scanner noise (`.env`, `wp-*`,
   `.git`, `/open/`, php). Real 404s are paths that look like our URLs:
   a cut-off blog slug, an icon, an old page name. Fix those with a
   redirect in `server.js` (look for the `BLOG_SLUGS` example).
4. `mcp__Railway__domain-status` for `www.tcgspeedshipper.com`. If it's
   VALIDATING_OWNERSHIP, the owner still needs the Porkbun CNAME and TXT
   records.
5. If a deploy restarted: `get-logs` deploy stream with filter
   `self-check`. Expect `stripe_key=OK supabase_key=OK`.

Report in 3–5 plain lines: working or not, what you fixed, and what the
owner must do. Don't paste raw logs.
