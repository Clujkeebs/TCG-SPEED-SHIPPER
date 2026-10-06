# TCG Speed Shipper: the owner's playbook

Maintained by Claude and Devin. Rewritten **2026-10-06**.

**Interactive version (tick tasks, notes, talk to Claude):** https://claude.ai/artifact/Rkn4p1xzK8PVpV7pJaAMTh

This file has three parts:

1. **Your to-do list.** Only you can do these, because they need your
   login, card, identity, DNS or a decision. Each task says why it matters,
   exactly what to click, how long it takes and what it unlocks.
2. **What Claude and Devin are building,** in order, so you can see the
   plan and what each piece is worth in dollars.
3. **The money ladder:** how we get from about $30/mo to hundreds a month,
   then to $10k.

Mark a task done by telling either of us, or change `[ ]` to `[x]`.
⏱ = your time · 💵 = costs money · 🔥 = do first

---

## Quick answers (Oct 6)

**Which Pitney Bowes key is which?** On the Sandbox keys screen (columns
NAME / CLIENT ID / SECRET / GENERATED ON / STATUS / ACTION):

| On the PB screen | Railway variable name |
|---|---|
| **Client ID** | `PB_API_KEY` |
| **Secret** (click the eye or Show icon to reveal it) | `PB_API_SECRET` |

**"Invite Merchant" button:** don't use it now. It emails a seller an
invite to create *their own* PB postage account with their own card (the
production "Individual accounts" model). Sandbox needs no payment setup:
test labels are free.

**What's the Shipper ID?** It's the ID of the "merchant", meaning the
postage account that labels get charged to. In the sandbox, PB gives you a
free test merchant automatically. In the PB developer site, open the left
menu and click **Onboarding Merchants** (it may just say **Merchants**).
Copy the **Shipper ID** shown there. It goes into Railway as
`PB_SHIPPER_ID`. In production, the Shipper ID is your real account (or
each seller's), and PB gives it to you when they approve production.

**What's `PB_PILOT_EMAILS`?** The postage panel is hidden from everyone
except you while we test. This optional variable lets other people see it.
Type the email addresses those sellers use to **log into
tcgspeedshipper.com**, separated by commas, e.g. `rob@example.com`
(use Rob's real login email). Leave it out and only you see postage.
Nobody else is affected.

**About the website:** sorry about the wrong link. You found the right
developer site already, since you have the keys page. PB's docs are at
docs.shippingapi.pitneybowes.com.

---

# Part 1: Your to-do list

## Stage A: switch on postage (this is the money)

Why this comes first: today we earn $2.99–5.99 once a month per seller.
With postage, we earn on **every label** a seller prints. Rob alone ships
500+ orders a month. At our fee that's about $100/mo from one seller,
more than all subscriptions combined today.

- [ ] 🔥 **A1. Put the sandbox keys into Railway** ⏱ 10 min
  1. Go to railway.app and log in. Open the **tcg-speed-shipper**
     project, then click the **web** service box.
  2. Open the **Variables** tab and click **+ New Variable**. Add these
     one at a time (name on the left, value on the right):
     - `PB_API_KEY` = the **Client ID**
     - `PB_API_SECRET` = the **Secret**
     - `PB_SHIPPER_ID` = the Shipper ID (see Quick answers above)
  3. Railway shows a purple **Deploy** button at the top. Click it. The
     site restarts in about 2 minutes, with no downtime.
  4. Never paste these values in chat or email. Railway is the only place
     they go.
  - **Check it worked:** open tcgspeedshipper.com while logged in and
    load any CSV (or click **Try a sample**). A **Buy postage** panel
    appears with a yellow **TEST MODE** badge. Buy one label. You get a
    PDF with a fake-but-real-looking label and tracking number. Test
    labels are free.
  - **Unlocks:** Claude can test everything end to end with real PB
    responses and fix anything PB rejects, before any real money moves.

- [ ] 🔥 **A2. Decide the Ground Advantage fee** ⏱ 10 sec
  - This is what we charge on top of postage for a $49.99+ order label.
    The current default is $0.30, which only keeps about $0.08–0.21 after
    payment fees.
  - **My recommendation is $0.50.** The seller still pays about $5.00
    total (Pirate Ship charges postage only, but has no slips and no
    TCGplayer integration), and we keep $0.28–0.41.
  - Letters stay at $0.21 (seller pays $0.99, under the $0.82 stamp plus
    the tracking they can't get from a stamp).
  - Just tell Claude "ground 50 cents" and it gets changed.

- [ ] **A3. Add Rob as a pilot and send his invite** ⏱ 3 min
  - In Railway Variables, add `PB_PILOT_EMAILS` = Rob's login email.
  - In Gmail, open Rob's thread. There's a draft reply from you
    inviting him to test postage. Read it, edit anything, send it.
  - Why Rob: he pays $30/mo to rent a postage meter and told us he'd drop
    it for this. He's the proof that sellers will pay for this, and his
    feedback shapes the product for the next 100 sellers.

- [ ] **A4. Production access from Pitney Bowes** (you emailed them ✅)
  - When they reply, they'll ask how postage gets paid. There are two
    models. **Reply that we want to start with Individual Postage
    Accounts if possible.**
    - **Individual accounts:** each seller connects their own card in a
      PB sign-up page, and PB charges them directly for postage. We
      never hold anyone's postage money, so there's no risk of you owing
      money for someone's stolen card. We still charge our fee through
      our prepaid balance.
    - **Bulk account:** all postage is charged to *your* PB account, and
      we bill sellers through our prepaid balance (already built). More
      control and margin, but you front the postage.
  - Also ask them: "Do you offer a platform revenue share or volume
    pricing for letters (First-Class with IMb)?" That's how eBay gets
    $0.63 envelopes.
  - Forward their reply to yourself and tell Claude. Claude updates the
    code for whichever model they approve.

- [ ] **A5. Two Stripe settings for the prepaid balance** ⏱ 5 min
  1. dashboard.stripe.com → **Settings** (gear icon) → **Payment
     methods** → find **ACH Direct Debit** (may say "US bank account")
     → **Turn on**.
     - Why: card payments cost ~3% (about $1.75 on a $50 top-up), bank
       payments cost 0.8% (max $5). On thin per-label fees, that's the
       difference between profit and break-even.
  2. **Developers** → **Webhooks** → click the endpoint ending in
     `/api/stripe-webhook` → **Add events** (or "Select events") →
     search `checkout.session.async_payment_succeeded` → tick it → save.
     - Why: bank payments take 3–5 days to clear. This event tells our
       server when the money arrives, so the seller's balance is
       credited automatically.

- [ ] **A6. Form an LLC before real postage goes live** 💵 ⏱ an hour + filing
  - Why: once sellers prepay balances, you're holding their money. An
    LLC keeps your personal savings separate if something goes wrong
    (chargebacks, a dispute, a PB bill).
  - How: in California, file **Articles of Organization (Form LLC-1)**
    online at bizfileonline.sos.ca.gov. The state fee is $70. California
    also charges an **$800/yr franchise tax** (first-year exemptions
    sometimes apply, so ask an accountant). Then get a free **EIN** at
    irs.gov (10 min online) and open a **business bank account**.
  - Then update Stripe (Settings → Business details) and PB to the LLC.

- [ ] **A7. USPS Mailer ID (for tracking stamped envelopes)** ⏱ 20 min + a few weeks of waiting
  - Why: this lets us print USPS's Intelligent Mail barcode on the free
    envelope format, so even sellers who use stamps get "Accepted / In
    transit / Delivered" scans. Three competitors charge for this.
  - How: gateway.usps.com → **Register** a Business Customer Gateway
    account → after login, **Mailing Services** → request a
    **Mailer ID (MID)** and **Informed Visibility** access. Tell Claude
    when approved.

## Stage B: fix and secure (one evening, about 40 min total)

- [ ] 🔥 **B1. Finish `www.tcgspeedshipper.com`** ⏱ 2 min
  - Why: anyone who types "www." gets a scary security warning right now
    and leaves.
  - porkbun.com → **Account** → **Domain Management** → next to
    tcgspeedshipper.com click **DNS** → add a record:
    - Type: **TXT**
    - Host: `_railway-verify.www`
    - Answer: `railway-verify=2f07e30030ad12a6fcee1329ee23f25808e97b6b21a9f09803683a6ba50dbf54`
    - Save. Railway sees it within an hour and issues the security
      certificate by itself.

- [ ] **B2. Delete the Steel API key** ⏱ 1 min
  - It was pasted in chat, so treat it as exposed. app.steel.dev →
    **Settings** → **API Keys** → trash icon. We don't use Steel anymore.

- [ ] **B3. Delete the old Stripe secret key** ⏱ 1 min
  - Stripe → **Developers** → **API keys** → under "Secret keys" you'll
    see two. Keep the one named **Railway**. On the other one click
    **⋯** → **Delete** (or Roll/Expire).
  - Why: an old key that still works is a skeleton key to your Stripe
    account.

- [ ] **B4. Rotate the Supabase service-role key** ⏱ 5 min
  - Why: it was readable by tools connected to the old Netlify setup.
    This key can read every user's data.
  - supabase.com → your project (named "vischeck") → **Project
    Settings** → **API Keys** → **service_role** → **Roll** (or
    "Generate new"). Copy the new key. In Railway → web → Variables,
    edit `SUPABASE_SERVICE_ROLE_KEY`, paste it and deploy.
  - The site may show errors for the ~2 minutes in between, so do it at
    night.

- [ ] **B5. Leaked-password protection** ⏱ 1 min
  - Supabase → **Authentication** → **Attack Protection** (or
    "Policies") → turn on **Leaked password protection**. It blocks
    passwords that showed up in data breaches.

- [ ] **B6. Two-factor login everywhere** ⏱ 15 min
  - On GitHub, Railway, Porkbun, Stripe, Supabase, Gmail and Pitney
    Bowes, go to account security and turn on 2FA with an authenticator
    app (Google Authenticator or Authy).
  - Why: if someone gets into your Gmail they can reset everything else.
    This is the business.

- [ ] **B7. Uptime alert** ⏱ 5 min
  - uptimerobot.com → free account → **New monitor** → type
    **HTTP(s)** → URL `https://tcgspeedshipper.com/api/health` →
    interval 5 min → alert contact: your phone (install the UptimeRobot
    app for push alerts).
  - Why: if the site goes down at 2 a.m., you know before customers do.

## Stage C: decisions only you can make (just reply in chat)

- [ ] **C1. The "Powered by TCG Speed Shipper" footer on free slips:
  drop it or keep it?**
  - TCGplayer's seller agreement bans marketing on packing slips. If a
    buyer reports it, the *seller's* account could be flagged, not ours.
    **Recommendation: drop it.** The free-to-paid upgrade happens in the
    app, not on slips. Reply "drop the footer".
- [ ] **C2. How you'll pay partners** (PayPal, Venmo or Cash App)
  - The partner page promises monthly payouts at $10+. Tell us which.
    Any partner you pay $600+ in a year needs a W-9 from them, and you
    send them a 1099-NEC in January.
- [ ] **C3. Sales tax**
  - Some states tax software subscriptions (e.g. Texas, New York,
    Washington). At our size the risk is small, but it grows.
    Options: ask an accountant when you form the LLC (recommended), or
    turn on **Stripe Tax** (0.5% per transaction, automatic) 💵.
- [ ] **C4. Approve the new "Pro" plan** (see Part 2, B2)
  - $14.99/mo for high-volume sellers: everything in Premium plus
    cheaper label fees. Reply "yes Pro" or tell us your price.

## Stage D: get found (free traffic, about 1 hour)

- [ ] 🔥 **D1. Google Search Console** ⏱ 15 min
  - Why: Google gave us 58 visits last week without knowing we exist.
    Search Console tells Google every page we have and shows which
    searches find us.
  - search.google.com/search-console → **Add property** → pick
    **Domain** (left box) → type `tcgspeedshipper.com` → Google shows a
    TXT record (starts with `google-site-verification=`). Copy it.
  - At Porkbun → DNS → add a **TXT** record with Host **blank** and
    Answer = what you copied → save → back in Google click **Verify**
    (it can take 10–60 min; try again if it fails).
  - Left menu → **Sitemaps** → enter `sitemap.xml` → **Submit**.
  - Then go to bing.com/webmasters → sign in → **Import from Google
    Search Console**. Two clicks covers Bing and DuckDuckGo too.
- [ ] **D2. Claim @tcgspeedshipper** on TikTok, Instagram, YouTube and X ⏱ 15 min
  - Even if you never post, it stops someone else taking the name. Put
    `tcgspeedshipper.com` in each bio.
- [ ] **D3. Bio links on your own seller profiles** ⏱ 10 min
  - Whatnot profile: `tcgspeedshipper.com/?utm_source=whatnot`
  - eBay store: `tcgspeedshipper.com/?utm_source=ebay`
  - TCGplayer store page: `tcgspeedshipper.com/?utm_source=tcgplayer`
  - The `?utm_source=` part tells our admin page where visitors came
    from.
- [ ] **D4. Apply to TCGplayer "Seller Stories"** ⏱ 20 min
  - TCGplayer features sellers on its blog and seller newsletter, which
    goes straight to every one of our potential customers. Search "TCGplayer
    seller stories" and fill in the form. Mention you built a free tool
    other sellers use. Devin can draft your answers. Ask.
- [ ] **D5. Ask Mana Pool to list us** ⏱ 5 min
  - Email Mana Pool support: "I built a free label/packing-slip tool for
    card sellers that reads your order export. Could it be listed in
    your seller resources?" Devin drafts this if you want.

## Stage E: content only you can make

- [ ] **E1. A 60-second screen recording** ⏱ 30 min
  - Why: one video works on TikTok, Shorts, Reels, X, the homepage and
    Google Ads. It's the best-converting asset we can have.
  - On your iPad or computer, screen record: TCGplayer → Orders → Export
    Shipping → open tcgspeedshipper.com → drop the CSV → Download →
    the labels print. Talk over it like you're telling a seller friend.
    Devin has a shot-by-shot script, just ask.
- [ ] **E2. Ask Rob for a one-line quote** ⏱ 2 min
  - "Would you mind if I put a line from you on the homepage, with just
    your first name?" Real quotes lift signups a lot.
- [ ] **E3. One community post a week, from your account** ⏱ 20 min each
  - Reddit (r/TCGplayer, r/mtgfinance), Discord seller servers and
    Facebook seller groups. The ranked list with each group's rules is
    in `docs/community-channels.md`; Devin drafts each post. Agents
    never post as you.

## Stage F: physical tests ⏱ 30 min

- [ ] **F1. Print one sheet of each format** (4×6 thermal, Avery 5160, #10
  envelope, Label + packing slip) and the new **postage test label**.
  Tell us if anything is off by even a millimeter. Photos help.
- [ ] **F2. Send one real eBay and one real Whatnot CSV,** with names and
  addresses changed to fake ones. That lets us add those marketplaces
  (Part 2, B6).

## Stage G: housekeeping (whenever)

- [ ] **G1. Stripe public details:** Settings → **Public details** →
  statement descriptor `TCGSPEEDSHIPPER`, support URL
  `https://tcgspeedshipper.com/support.html`. Customers then recognize
  the charge on their bank statement instead of disputing it.
- [ ] **G2. One live purchase test** with your own card on a second
  account: buy Base, check it upgrades, cancel in Manage billing, refund
  yourself in Stripe.
- [ ] **G3. Resend for email** (free): resend.com → add domain
  `tcgspeedshipper.com` → add the 3 DNS records it shows at Porkbun.
  Then connect Resend in claude.ai → Settings → Connectors. Password
  resets and the newsletter stop landing in spam.
- [ ] **G4. Re-connect the Stripe connector** in claude.ai → Settings →
  Connectors (it's signed out). Claude then reads revenue numbers
  directly.
- [ ] **G5. Rename the Supabase project** "vischeck" → "TCG Speed
  Shipper" (Settings → General). Cosmetic.
- [ ] **G6. Netlify:** leave it alone until November, then delete the site
  if you want.
- [ ] **G7. Google Ads:** you're running this yourself. Everything is in
  `docs/google-ads/README.md`. Do it after D1 so the ads land on a site
  Google already knows.

---

# Part 2: What Claude and Devin are building

In order. Claude builds the server, billing and security work; Devin does
research, content and SEO. You don't need to do anything here unless a
line says **needs you**.

## Phase 1: postage goes live (October)
| # | What | Why it makes money | Needs you |
|---|---|---|---|
| B1 | **Postage end to end in sandbox:** real PB responses, error messages a seller understands, label + slip in the same PDF | Every label = a fee | A1 keys |
| B2 | **"Pro" plan, $14.99/mo:** Premium + lower label fees ($0.15 letters, $0.35 ground) + priority support | High-volume sellers pay more for saving per label; 20 Pro sellers = $300/mo | C4 yes |
| B3 | **Tracking straight into TCGplayer:** after buying postage, one click downloads the TCGplayer "mark shipped + tracking" upload file | Saves sellers 20+ min a day; the reason they keep paying | none |
| B4 | **Production switch-on** with the PB account model they approve, balance auto-reload ("top up $50 when under $10") | Real revenue | A4, A5, A6 |
| B5 | **Tracking page for buyers** (optional link the seller can send) | Fewer "where's my order" messages | none |

## Phase 2: sellers stay and spend more (November)
| # | What | Why it makes money |
|---|---|---|
| B6 | **eBay + Whatnot CSV import** | 3× the market; most card sellers sell on more than one site |
| B7 | **Shipping insurance toggle** per order (Shipsurance / InsureShield API) | $0.03–0.10 commission per insured order, and sellers want it for $50+ cards |
| B8 | **Welcome emails** for new signups: day 0 how-to, day 2 "print your first batch", day 7 "try postage" | Most signups never come back; this turns more of them into payers |
| B9 | **Refer a seller, get a month free** (both sides) | Sellers know other sellers. Cheapest growth there is |
| B10 | **Supplies page**: envelopes, toploaders, thermal printers, with affiliate links | 3–8% of every purchase |

## Phase 3: become the default tool (December+)
| # | What | Why it makes money |
|---|---|---|
| B11 | **Chrome extension:** reads your TCGplayer orders page, no CSV export, and pastes tracking back | Two clicks for the whole shipping day; nobody else has it |
| B12 | **Shop / Enterprise plans** ($49–199/mo): multiple users, multiple stores | A few game stores = hundreds a month |
| B13 | **Negotiated envelope rate** with PB/USPS, once we have volume | Every 10¢ off the postage cost on 100k letters = $10k/mo |
| C8 | **IMb tracking on stamped envelopes** | Free tracking hook that pulls sellers in | 

Devin, ongoing: SEO articles that answer what sellers search ("how to
ship Pokémon cards", "TCGplayer label printer", comparison pages vs
Pirate Ship / TCGTracking), the weekly newsletter, partner prospects,
and drafts for your community posts.

---

# Part 3: The money ladder

Today: about **$30–40/mo** (9 paying: 5 Premium, 4 Base).

| Step | What gets us there | Monthly |
|---|---|---|
| **1. $300/mo** | Rob + 10 sellers on postage (≈3,500 labels/mo × ~$0.15 kept ≈ $500) **or** 20 Pro sellers ($300) | ≈ $300–500 |
| **2. $1,000/mo** | 30 active postage sellers, Search Console + Ads bringing ~1,000 visits/week, welcome emails converting 10% of signups | ≈ $1,000 |
| **3. $3,000/mo** | eBay + Whatnot import, insurance, referrals; 100 postage sellers | ≈ $3,000 |
| **4. $10,000/mo** | ~250 active shipping sellers, Chrome extension, a few shop plans, a negotiated envelope rate | ≈ $10,000+ |

The single biggest lever is **postage volume**: every label any seller
prints earns us something, forever. Everything in Part 1 Stage A exists
to switch that on.

---

## ✅ Done recently

- Creator outreach: 8 creators emailed Sep 28 and followed up Oct 5,
  0 replies. No more cold email to them.
- Postage built (sandbox): prepaid balance, custom top-ups, reprints,
  refunds, admin earnings page.
- Thermal printing: label → slip → label → slip, one slip per label (Rob).
- Bold return address + "no divider line" option (Rob).
- Paste addresses: forgiving parser (city/state/ZIP on separate lines,
  state names, no commas).
- "New version available" banner, so nobody runs stale code.
- Mailing address, email forwarding, Stripe support email, DMARC.
- Hosting on Railway (unlimited deploys); new Stripe prices + yearly plans.
