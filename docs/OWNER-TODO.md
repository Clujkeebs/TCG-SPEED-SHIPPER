# Owner to-do list (things only you can do)

Maintained by Claude and Devin. Every item here needs **you**: your login, your
card, your identity, a new account, DNS, a physical printer, or a legal or
business decision. If one of us could do it in about the same time, it isn't
on this list. We do it instead.

Check an item off by changing `[ ]` to `[x]`, or just tell either of us it's
done. We add new items at the bottom of the matching section, with who added
them.

**Legend:** ⏱ rough time for you · 🔥 do first · 💵 costs money

---

## 🔥 Blocking right now

- [x] ~~Deploy on Netlify / turn on auto-publishing~~: not needed. Merges
  to `main` already deploy on their own (Claude misread this earlier).
  Checked 2026-09-27.
- [ ] 🔥 **Reconnect the Stripe connector** at claude.ai/customize/connectors
  (it shows "connect incomplete"), then start a new Claude session. Once it's
  connected, Claude creates the new prices, checks the webhook, and sets up
  the customer portal, so those tasks aren't on this list. ⏱ 3 min
- [ ] 🔥 **Until Stripe is reconnected, check one thing by hand:** Stripe →
  Developers → Webhooks → your endpoint → the event list must include
  **`invoice.payment_succeeded`**. Referral rewards and affiliate commission
  now fire only from that event. If it's missing, add it. The other events
  should be `checkout.session.completed` and
  `customer.subscription.created/updated/deleted`. ⏱ 3 min
- [ ] **Rename the Supabase project** "vischeck" → "TCG Player": Project
  Settings → General → Project name. It's the display name only, so nothing
  breaks. ⏱ 1 min

## 🔐 Security (accounts only you control)

- [ ] **Mark secrets as secret in Netlify:** `STRIPE_SECRET_KEY`,
  `SUPABASE_SERVICE_ROLE_KEY`, `STRIPE_WEBHOOK_SECRET` are stored as plain,
  readable values. Netlify → Environment variables → each one → *Contains
  secret values*. ⏱ 3 min
- [ ] **Rotate the Stripe secret key and the Supabase service-role key.**
  Both have been readable in plain text by every tool connected to Netlify,
  including AI agents. Make a new Stripe key (or better, a *restricted* key
  with only the permissions the app uses), put it in Netlify, redeploy, and
  delete the old one. Do the same for Supabase's service-role key. ⏱ 15 min
- [ ] **Turn on leaked-password protection** in Supabase → Authentication →
  Attack Protection. ⏱ 1 min
- [ ] **Turn on 2FA** for GitHub, Netlify, Stripe, Supabase and the Gmail
  account if it isn't already. ⏱ 10 min
- [ ] **Set up uptime alerts:** a free UptimeRobot (or Better Stack) account,
  monitoring `https://tcgspeedshipper.com/api/health` every 5 min, alerting
  your phone. You'd know about an outage before a customer emails. ⏱ 10 min

## 📧 Email & domain (DNS / new accounts)

- [ ] **A support address on your domain,** e.g. `support@tcgspeedshipper.com`
  forwarding to your Gmail (free with Cloudflare Email Routing or ImprovMX,
  or Google Workspace 💵). It looks more trustworthy than a @gmail address on
  checkout and in outreach. Tell us when it works and we'll switch the site
  over. ⏱ 20 min
- [ ] **SPF / DKIM / DMARC records** for that domain, so your mail doesn't land
  in spam. Your email provider shows the exact records. ⏱ 15 min
- [ ] **Custom SMTP for Supabase Auth** (Resend or Postmark free tier, sending
  from the domain above). Password-reset emails currently go through
  Supabase's shared sender, which has been unreliable. Put the SMTP details
  in Supabase → Authentication → SMTP Settings. ⏱ 20 min
- [ ] **A real mailing address** (PO box or virtual mailbox 💵) for the footer
  of any marketing or partner email. The law requires it (CAN-SPAM), and the
  win-back and partner drafts in Gmail are waiting on it. ⏱ 15 min + errand

## 🔎 Google & search (your Google account)

- [ ] **Search Console:** add `tcgspeedshipper.com` (Domain property via DNS
  is best), submit `https://tcgspeedshipper.com/sitemap.xml`, and use *URL
  Inspection → Request indexing* on the homepage, `/partners.html` and the
  three new posts. ⏱ 15 min
- [ ] **Search Console → Change of Address:** verify the *old*
  `tcg-speed-shipper.netlify.app` property too, then run the Change of
  Address tool from it to the new domain. This moves the old URLs' Google
  ranking over faster. ⏱ 10 min
- [ ] **Bing Webmaster Tools:** sign in and *Import from Google Search
  Console* (it covers Bing, DuckDuckGo and Yahoo). ⏱ 5 min
- [ ] **Google Ads (later):** create the account and the $150 exact-match
  test from the growth plan, only after a week of funnel numbers. Needs your
  card 💵. ⏱ 30 min

## 💳 Stripe settings only a human should decide

- [ ] **Business details in Stripe:** statement descriptor (e.g.
  `TCGSPEEDSHIPPER`, so card statements aren't confusing), support email and
  URL, and a public business address. Stripe → Settings → Public details.
  ⏱ 5 min
- [ ] **Sales tax decision:** some US states tax SaaS subscriptions. Ask an
  accountant, or turn on Stripe Tax 💵 and register where it tells you to. A
  legal and tax decision, so it's yours. ⏱ varies
- [ ] **End-to-end live test with your own card:** once the new prices are
  live, buy Base on a second account, check it upgrades, cancel from Manage
  Billing, then refund yourself in Stripe. Neither agent can use a card.
  ⏱ 10 min

## 🤝 Partners & payouts

- [ ] **How you'll pay partners:** the partner page promises PayPal, Venmo or
  Cash App monthly once someone is owed $10+. Pick the account you'll pay
  from. ⏱ 5 min
- [ ] **Tax forms for partners:** anyone you pay $600+ in a year needs a W-9
  from them and a 1099-NEC from you. Collect the W-9 when you activate a
  partner. ⏱ per partner
- [ ] **Send the partner outreach emails.** The template is in Gmail drafts.
  Devin is building a prospect list in `docs/partner-prospects.md`. Sending
  should come from you: it's your name and reputation, and it needs the
  mailing address above. ⏱ 5 min per email

## 📣 Marketing that needs *you* (your face, accounts or audience)

- [ ] **Bio links:** add "I built the tool I ship with →
  tcgspeedshipper.com/?utm_source=whatnot" (use `utm_source=ebay` on eBay)
  to your Whatnot profile and stream overlay, and to your eBay and TCGplayer
  store pages. ⏱ 10 min
- [ ] **Claim the handle `@tcgspeedshipper`** on TikTok, Instagram, YouTube
  and X, before someone else does. ⏱ 15 min
- [ ] **Record a 60-second screen demo:** export CSV → drop it in → print.
  Post it to TikTok, YouTube Shorts and Instagram Reels. It's the single
  best asset for Reddit, the partner pitch and ads. ⏱ 30 min
- [ ] **Ask Rob for a one-line testimonial,** and permission to use his first
  name on the homepage. ⏱ 2 min
- [ ] **Apply to TCGplayer's "Seller Stories"** (seller.tcgplayer.com/seller-stories).
  You're a real TCGplayer seller who built a tool. That's free exposure to
  exactly our customers. ⏱ 20 min
- [ ] **Reddit / Discord posts from your own account:** r/TCGplayer,
  r/PokemonTCG seller threads, card-shop Discords. Read each community's
  self-promo rules first. Agents shouldn't post as you. ⏱ 20 min per post

## 🧪 Physical tests (need a printer and envelopes)

- [ ] **Print a real sheet of each format:** 4×6 thermal, Avery 5160 and a #10
  envelope. Check alignment, then tell us if anything is off by even a
  millimeter. ⏱ 15 min
- [ ] **Try the Pirate Ship export on your real Pirate Ship account** once
  Devin ships it: import the file, buy one label, paste the tracking back.
  ⏱ 10 min

## 🏢 Business

- [ ] **Business structure:** consider an LLC before revenue grows (liability
  and taxes). Talk to an accountant. ⏱ varies 💵
- [ ] **Chrome Web Store developer account** ($5 💵), only when we start the
  Chrome extension (parked for now). ⏱ 10 min
- [ ] *(optional)* **Refill OpenRush credits,** the SEO data tool Claude uses
  for keyword research. It ran out mid-research. 💵

---

### Added by Devin
<!-- Devin: add owner-only items here (what, why, time). -->
