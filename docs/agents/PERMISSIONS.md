# PERMISSIONS: what the agents may do without asking (TCG Speed Shipper)

The fence from DAS §9. **Anything not listed as allowed means: ask the owner
first.** Only the owner edits this file, or an agent does it at the owner's
explicit request (then quote the request in the commit message).

Last set: 2026-09-27, from the owner's instructions in Claude's session (email row updated the same day at the owner's request).

| Area | Allowed without asking | Needs the owner |
|---|---|---|
| **Code / git** | Branch, commit, open PRs. Claude merges its **own** PRs to `main` once CI is green. **Merging deploys to production automatically.** | Merging the *other* agent's PRs (the owner merges Devin's PRs) · force-push to `main` · deleting branches that aren't yours |
| **Database (Supabase)** | Read queries · additive migrations (new tables/columns/functions; `tcgss_` prefix; RLS on; `revoke execute` on server-only SECURITY DEFINER functions) | Dropping tables/columns/data · editing user rows · auth settings |
| **Billing (Stripe, live mode)** | Read everything · create the plan prices the owner approved (Base $2.99/mo, Base $29/yr, Premium $59/yr) and wire them into env vars · configure the customer portal · add webhook event types the code depends on | Changing existing subscribers' prices · refunds · coupons over 50% off · deleting products/prices |
| **Hosting (Netlify)** | Read deploys/config · set **non-secret** env vars · trigger deploys | Creating/rotating/reading secret values · domain/DNS changes |
| **Email (owner's Gmail)** | Read · write drafts · **send** (owner, 2026-09-27: "You have permission to send all emails"): customer/relationship notes, the weekly newsletter to opted-in subscribers, and partner/referral outreach to public business contacts. Rules that still apply because they're the law or protect the sender reputation: every marketing email carries the owner's mailing address and a working opt-out (CAN-SPAM) · honor every "stop"/"unsubscribe" at once and never email that address again · no bought/scraped lists, no personal emails, no guessed addresses · one email per recipient (no big CC/BCC blasts) · at most ~30 outreach emails a day, one follow-up max · log every batch in `DEVIN_AI.md` | Sending with a changed from-name, or anything that impersonates someone · emailing people who said stop · marketing email while no mailing address is on file |
| **Public posting** | none | Posting anywhere as the owner (Reddit, Discord, social, reviews) |
| **Money** | none. $0 spend. | Any purchase, subscription, ad spend, payout |
| **Trading / crypto** | none. Not configured for this project. | Everything. To enable it, the owner adds venue, assets, max position, max daily loss and a kill-switch here. |
| **Research** | Any public web research. Public business contacts only. | Anything behind a login, or anything that needs the owner's accounts |
