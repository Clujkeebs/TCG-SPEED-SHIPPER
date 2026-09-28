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

- [x] ~~Netlify stuck (free credits ran out)~~: **moved to Railway 2026-09-28.**
  The site runs on Railway (your $5 Hobby plan) with unlimited deploys, and
  every merge goes live. DNS is at Porkbun.
- [ ] **Delete the old Stripe secret key** (Stripe → Developers → API keys):
  the one that *isn't* named "Railway". Do it after a day of Railway running
  clean. Nothing uses the old key anymore. ⏱ 1 min
- [ ] *(later)* **Netlify:** leave the site alone for now. It still redirects
  the old tcg-speed-shipper.netlify.app address. After a month you can
  delete it, or keep it as a free backup.
- [ ] 🔥 **Reply with a mailing address for email footers** (a PO box or a
  virtual mailbox is fine). The law (CAN-SPAM) requires a physical address in
  every marketing email. It's the one thing holding back all of these:
  - the win-back email to free users
  - partner/referral outreach (Devin is finding 30 new people now)
  - the weekly newsletter (first issue Tue Sep 29)

  Just paste it in chat; it only goes in email footers, never in the repo.
  ⏱ 1 min (+ errand if you need a PO box)
- [x] ~~Merge Devin's finished PRs~~: done 2026-09-27 (Devin merged them with
  your OK). Everything except #21 is in.
- [ ] **Decide: slip branding vs TCGplayer's seller agreement.** Devin found
  that the Marketplace Seller Agreement bans marketing material, custom
  packing slips and links to outside sites in shipped orders.
  - **#21** (URL + QR on free slips) is on HOLD. Recommend closing it.
  - The current free-slip footer "Powered by TCG Speed Shipper" has no link,
    but could still count. Recommend removing it from slips; reply "drop the
    footer" and Claude does it.

  It's your users' seller accounts at risk. ⏱ 2 min
- [x] ~~New Stripe prices~~: done 2026-09-28. Base $2.99/mo · $29/yr,
  Premium $5.99/mo · $59/yr. Existing subscribers keep their price. Customers
  can switch plans and billing period in the Manage billing portal.
- [x] ~~Webhook URL updated to the new domain~~: done by you 2026-09-27. The
  admin dashboard's **Setup checks** card shows whether
  `invoice.payment_succeeded` is arriving; Claude confirms it in the Stripe
  session.
- [x] ~~Mark Netlify secrets as secret~~: done by you 2026-09-26.
- [ ] **Rename the Supabase project** "vischeck" → "TCG Player": Project
  Settings → General → Project name. It's the display name only, so nothing
  breaks. ⏱ 1 min

- [ ] **Install the Dual Agent System in both agents** (one time): paste
  the two blocks from `docs/agents/INSTALL.md` into Devin → Knowledge and
  claude.ai → Settings → Profile. After that, "we're rocking the dual agent
  system" works in any repo. ⏱ 5 min
- [ ] **Look over `docs/agents/PERMISSIONS.md`**: it's the fence for what
  the agents may do without asking (send email, spend money, Stripe changes,
  trades). Edit it to taste. ⏱ 5 min

## 🔐 Security (accounts only you control)

- [ ] **Rotate the Stripe secret key and the Supabase service-role key.**
  Both have been readable in plain text by every tool connected to Netlify,
  including AI agents. Make a new Stripe key (or better, a *restricted* key
  with only the permissions the app uses), put it in Netlify (it takes effect with the next merge), and
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
  The prospect list is `docs/partner-prospects.md` (lands with #11). Sending
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
  #18 is merged: import the file, buy one label, paste the tracking back.
  ⏱ 10 min

## 🏢 Business

- [ ] **Business structure:** consider an LLC before revenue grows (liability
  and taxes). Talk to an accountant. ⏱ varies 💵
- [ ] **Chrome Web Store developer account** ($5 💵), only when we start the
  Chrome extension (parked for now). ⏱ 10 min
- [ ] *(optional)* **Refill OpenRush credits,** the SEO data tool Claude uses
  for keyword research. It ran out mid-research. 💵
- [ ] *(optional)* **Devin Review** (the automatic PR reviewer) still reported
  "trial expired". Devin itself is back as of 2026-09-27. 💵

---

### Added by Devin
<!-- Devin: add owner-only items here (what, why, time). -->
- [ ] **Get a USPS Mailer ID** (free): create a USPS Business Customer
  Gateway account at gateway.usps.com, then request a Mailer ID and
  Informed Visibility access. It's the prerequisite for tracking stamped
  envelopes (Intelligent Mail barcodes), which three competitors already
  sell. See `docs/competitors.md`, "IMb path". Approval is slow, so start
  early. ⏱ 20 min + waiting
- [ ] **Export one real eBay and one real Whatnot order CSV,** then replace
  the names and addresses with fake ones and drop them in the repo (or send
  them to either of us). With those we can make the app read them, so it
  works for sellers who aren't on TCGplayer. ⏱ 10 min
- [ ] **Ask Mana Pool to list the tool** on their seller-tools / integrations
  page (email their support from your account). ⏱ 5 min
- [ ] **Sanity-check the holiday dates** in the refreshed holiday post before
  it's merged. They're sourced and dated "as of Sept 26", but you know the
  release calendar best. ⏱ 3 min
