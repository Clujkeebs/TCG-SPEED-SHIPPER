# Weekly seller newsletter

**Goal:** one short, useful email every **Tuesday** to people who opted in.
It builds trust and brings sellers back to the tool. The owner asked for it
on 2026-09-27.

## Who does what (DAS)

- **Devin (Scout)** writes each issue as `docs/newsletter/YYYY-MM-DD.md` (the
  Tuesday date) by **Monday**. Every factual claim gets a source link.
- **Claude (Builder)** reviews it, adds the product note if it's missing, and
  sends it Tuesday morning (Pacific) from the owner's Gmail. Then Claude logs
  the send in `DEVIN_AI.md`.

## Issue format

```
Subject: <under 60 chars, specific: "USPS holiday cutoffs + a faster way to mark orders shipped">
Preview: <one line, under 90 chars>

<Hi,>
1. Shipping tip (practical, sourced)
2. What changed this week (TCGplayer / USPS / big releases; sources)
3. Product note (one feature of ours that fits the tip, with a link)
<sign-off: Sam (Clujkeebs), TCG Speed Shipper>
```

250–400 words. Plain text reads fine. No tracking pixels. Links to our site
carry `?utm_source=email&utm_campaign=newsletter-YYYY-MM-DD`.

## The list

- The table is `tcgss_newsletter_subscribers`. Send to rows with
  `status = 'subscribed'`. It's server-only and read through the Supabase
  connector. Never commit emails.
- **Opt-in only:** the footer form on every page, the `/newsletter.html`
  page, the "labels ready" popup after a download, plus people who ask. Having
  an account does **not** add anyone (the privacy policy promises this).
- **Unsubscribe link** for each recipient:
  `https://tcgspeedshipper.com/api/newsletter/unsubscribe?t=<unsub_token>`.
  The page asks for a confirm click, so mail-scanner bots can't unsubscribe
  people.
- A reply of "unsubscribe" or "stop": set that row's `status = 'unsubscribed'`
  and `unsubscribed_at = now()` right away.

## Sending rules (PERMISSIONS.md, email row)

- One email per recipient: never CC/BCC a list.
- Footer: *why they're getting it*, the unsubscribe link, and **the owner's
  mailing address** (the law, CAN-SPAM). **No address on file → don't send.**
  Save the issue as a Gmail draft and flag it in `OWNER-TODO.md`.
- After a send, set `last_sent_at = now()` for the recipients.

## Footer template

```
You're getting this because you signed up for the TCG Speed Shipper weekly
newsletter at tcgspeedshipper.com.
Unsubscribe in one click: https://tcgspeedshipper.com/api/newsletter/unsubscribe?t=<token>
Questions or ideas: newsletter@tcgspeedshipper.com (or just reply)
TCG Speed Shipper · <OWNER MAILING ADDRESS>
```

## Web archive

After each send, run `node scripts/newsletter-pages.js`. It publishes
every issue dated today or earlier as `/newsletter/YYYY-MM-DD.html`, lists
it on `/newsletter.html`, and adds it to the sitemap. Future-dated drafts
stay private. Links in the web copy carry `utm_source=newsletter_web`
instead of `email`.
