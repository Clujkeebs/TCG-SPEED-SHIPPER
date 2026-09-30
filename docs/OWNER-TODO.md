# Owner to-do list (things only you can do)

Maintained by Claude and Devin. Refreshed **2026-09-30**. Every item here
needs **you**: your login, card, identity, DNS, a printer, or a business
decision. Anything either agent could do in about the same time isn't here;
we do it instead.

Check an item off by changing `[ ]` to `[x]`, or just tell either of us it's
done. **Legend:** ⏱ your time · 🔥 do first · 💵 costs money

---

## 🏠 When you get home: do these in order (~45 min total)

1. [x] ~~Mailing address~~: done 2026-09-28. It's used only in email
   footers (it lives in a Gmail draft, not on the site). Unblocked: 8
   creator partner emails sent, a welcome email to the newest free user,
   and the newsletter every Tuesday.
2. [ ] 🔥 **Finish `www` at Porkbun** (the CNAME is fixed; one record
   left). Porkbun → tcgspeedshipper.com → DNS → add a **TXT** record:
   host `_railway-verify.www`, answer
   `railway-verify=2f07e30030ad12a6fcee1329ee23f25808e97b6b21a9f09803683a6ba50dbf54`.
   Railway then issues the certificate by itself. ⏱ 2 min
3. [x] ~~Porkbun email forwarding~~: done 2026-09-30. The site now shows
   support@ (footers, support page, terms), privacy@ (privacy policy),
   billing@ (refunds), partners@ (partner applications) and hello@
   (Enterprise). All of them forward to your Gmail.
   - [ ] **Next, 2 min:** Stripe → Settings → Public details → support
     email `support@tcgspeedshipper.com`, so receipts show it.
   - [ ] **Next, 2 min:** add the DMARC record at Porkbun (in the Email
     deliverability section below).
4. [ ] **Delete the old Stripe secret key** (Stripe → Developers → API keys):
   the one *not* named "Railway". Railway has run clean all day on the new
   one. ⏱ 1 min
5. [ ] **Reply "drop the footer" (or "keep it")**. TCGplayer's seller
   agreement bans marketing on packing slips. Our free slips say "Powered by
   TCG Speed Shipper" (no link). Recommendation: drop it, since your users'
   seller accounts are at risk. ⏱ 10 sec
6. [ ] **Google Search Console:** add `tcgspeedshipper.com` (Domain property,
   verify with a TXT record at Porkbun), submit
   `https://tcgspeedshipper.com/sitemap.xml`, then **Bing Webmaster Tools →
   Import from Google**. Organic search is our biggest free channel, and
   Google can't rank what it hasn't been told about. ⏱ 15 min
7. [ ] **Claim `@tcgspeedshipper`** on TikTok, Instagram, YouTube and X.
   Put `tcgspeedshipper.com` in each bio. ⏱ 15 min
8. [ ] **Uptime alert:** free UptimeRobot account, monitor
   `https://tcgspeedshipper.com/api/health` every 5 min, alert to your phone.
   ⏱ 5 min

After that, the rest of this list can wait for a free evening.

---

## 🚀 Road to $10k/mo: postage (see `docs/research/road-to-10k.md`)

- [ ] **Pitney Bowes developer account** (free sandbox):
  developer.pitneybowes.com. Put the sandbox API key and secret into
  Railway → web → Variables as `PB_API_KEY` and `PB_API_SECRET`. Never
  paste them in chat. ⏱ 10 min
- [ ] **Send the Pitney Bowes partnership email.** It's already drafted in
  your Gmail ("Platform partnership: USPS letter + Ground Advantage…").
  Read it, edit, send. ⏱ 3 min
- [ ] **USPS Mailer ID** (free, slow; see Added by Devin below). Needed
  for envelope tracking. ⏱ 20 min
- [ ] **LLC** before we handle anyone's postage money. 💵

## 📣 Marketing that needs you (see `docs/MARKETING-PLAN.md`)

- [ ] **Record a 60-second screen demo:** export CSV → drop it in → print.
  Devin is writing the shot-by-shot script. Post to TikTok, YouTube Shorts,
  Reels and X. It's the best single asset for every channel. ⏱ 30 min
- [ ] **Bio links:** add `tcgspeedshipper.com/?utm_source=whatnot` to your
  Whatnot profile, and `?utm_source=ebay` / `?utm_source=tcgplayer` to your
  store pages. ⏱ 10 min
- [ ] **Send Rob's reply** (drafted in your Gmail, in his thread): the
  thermal label → slip → label feature he asked for is live. Read, edit, send.
  ⏱ 1 min
- [ ] **Ask Rob for a one-line testimonial** and permission to use his first
  name on the homepage. ⏱ 2 min
- [ ] **Apply to TCGplayer "Seller Stories"**
  (seller.tcgplayer.com/seller-stories). Free exposure to exactly our
  customers. ⏱ 20 min
- [ ] **Community posts from your own account** (one a week, rules first):
  the ranked list is `docs/community-channels.md`. Agents never post as you.
  ⏱ 20 min per post
- [ ] **Google Ads test ($150 cap):** everything is ready in
  `docs/google-ads/README.md`: settings, 3 ad groups, keywords, negatives,
  15 headlines, 4 descriptions, sitelinks, images and logos. You create
  the account and add the card (~20 min), then paste it all in. Do it
  after Search Console. 💵 ⏱ 45 min
- [ ] **Ask Mana Pool to list the tool** on their seller-tools page (email
  their support). ⏱ 5 min

## 🔌 Connectors that make the agents faster (claude.ai → Settings → Connectors)

Ranked by payoff. Each one is a 2-minute sign-in.
- [ ] **Resend** (free up to 3,000 emails/mo): sends the newsletter and
  outreach properly, with one-click unsubscribe headers and better inbox
  placement than Gmail one-by-one. It also fixes the unreliable
  password-reset emails (Supabase SMTP). It needs 3 DNS records at
  Porkbun, which Resend shows you. ⏱ 15 min
- [ ] **Context7** (free): current docs for Stripe, Supabase and Express,
  so Claude looks things up in one call instead of web searches. Fewer
  tokens, fewer mistakes. ⏱ 2 min
- [ ] **Sentry** (free tier): server errors with stack traces the moment
  they happen, so fixes land before customers notice. ⏱ 10 min
- [ ] **Link Search Console and Google Ads inside OpenRush** (already
  connected): once you set those accounts up, OpenRush can read your real
  rankings and ad results. ⏱ 5 min
- Skipped on purpose:
  - PostHog / Google tag: tracking cookies break the site's privacy
    promise.
  - Semrush / Ahrefs: paid, and OpenRush covers them.

## 🔐 Security

- [ ] **Rotate the Supabase service-role key** (it was readable by tools
  connected to Netlify). Supabase → Settings → API → roll the key, then
  paste the new one into Railway → web → Variables →
  `SUPABASE_SERVICE_ROLE_KEY`. Railway redeploys by itself. ⏱ 5 min
- [ ] **Leaked-password protection:** Supabase → Authentication → Attack
  Protection → on. ⏱ 1 min
- [ ] **2FA** on GitHub, Railway, Porkbun, Stripe, Supabase and Gmail. ⏱ 10 min

## 📧 Email deliverability (after the forwarding above)

- [ ] **DMARC record at Porkbun:** TXT, host `_dmarc`, value
  `v=DMARC1; p=none; rua=mailto:dmarc@tcgspeedshipper.com`. ⏱ 2 min
- [ ] **Custom SMTP for Supabase Auth** (Resend free tier, sending from
  `support@tcgspeedshipper.com`). Password-reset emails currently use
  Supabase's shared sender, which is unreliable. Resend shows the DNS
  records to add at Porkbun. ⏱ 20 min

## 💳 Stripe

- [ ] **Public details:** statement descriptor `TCGSPEEDSHIPPER`, support
  email (`support@` once it forwards), support URL. Stripe → Settings →
  Public details. ⏱ 5 min
- [ ] **Sales tax decision:** some states tax SaaS. Ask an accountant, or
  turn on Stripe Tax 💵. ⏱ varies
- [ ] **One live test with your own card:** buy Base yearly on a second
  account, check it upgrades, cancel from Manage billing, refund yourself.
  ⏱ 10 min

## 🤝 Partners & payouts

- [ ] **Pick the account you'll pay partners from** (PayPal, Venmo or Cash
  App; the partner page promises monthly payouts at $10+). ⏱ 5 min
- [ ] **W-9 from any partner you'll pay $600+ in a year**; you send them a
  1099-NEC. ⏱ per partner

## 🧪 Physical tests (printer + envelopes)

- [ ] **Print one sheet of each format:** 4×6 thermal, Avery 5160, #10
  envelope and the new **Label + packing slip**. Tell us if anything is off
  by even a millimeter. ⏱ 15 min
- [ ] **Pirate Ship export on your real account:** import, buy one label,
  paste the tracking back. ⏱ 10 min

## 🏢 Business & housekeeping

- [ ] **LLC** before revenue grows (talk to an accountant). 💵
- [ ] **Rename the Supabase project** "vischeck" → "TCG Speed Shipper"
  (Settings → General; display name only). ⏱ 1 min
- [ ] **Netlify:** leave it. It still redirects the old
  `tcg-speed-shipper.netlify.app` address. Delete it after a month if you
  like.
- [ ] **Install the Dual Agent System in both agents** (one time): paste the
  two blocks from `docs/agents/INSTALL.md` into Devin → Knowledge and
  claude.ai → Settings → Profile. ⏱ 5 min
- [ ] *(optional)* **Refill OpenRush credits** (Claude's SEO keyword tool). 💵
- [ ] *(optional)* **Devin Review credits** (the automatic PR reviewer). 💵

## ✅ Done recently

- ~~Hosting~~: moved to Railway 2026-09-28 (unlimited deploys, faster:
  Lighthouse mobile 98).
- ~~New Stripe prices + yearly plans~~: 2026-09-28. Base $2.99/mo · $29/yr,
  Premium $5.99/mo · $59/yr. Existing subscribers keep their price.
- ~~Stripe key for Railway~~, ~~webhook URL~~, ~~Netlify secrets marked
  secret~~, ~~Devin's PRs merged~~.

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
  the names and addresses with fake ones and send them to either of us.
  With those we can support sellers who aren't on TCGplayer. ⏱ 10 min
