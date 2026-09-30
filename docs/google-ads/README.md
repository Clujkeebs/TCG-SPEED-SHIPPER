# Google Ads kit

> **Start with `START-HERE.html`** (open it in a browser). It has every
> step, 4 ad groups with 15 headlines and 4 descriptions each, the
> keywords, negatives, sitelinks, callouts, snippets, price assets, the
> Performance Max and Demand Gen text, and all the images, with Copy
> buttons.
>
> **Also in this folder:**
> - `ALL-AD-COPY.txt`: the same text, plain.
> - `google-ads-editor-import/`: CSVs for Google Ads Editor.
> - `images/`: ads in 3 shapes × 4 messages, product-only images and
>   logos.
> - `15-SECOND-VIDEO-SCRIPT.txt`
>
> **To rebuild after a price or feature change:** edit `kit/copy.py` (it
> refuses anything over Google's character limits), then run
> `python3 kit/copy.py <out>` and `python3 kit/build_page.py <kit dir> <out>`.
> The images come from `kit/ads2.html` rendered by `kit/render3.js`
> (Playwright; set the paths at the top first).
>
> The notes below are the original 3-ad-group plan (2026-09-28). The kit
> supersedes their copy: it adds a **Packing slips with card lists** ad
> group and drops the pull-sheet claims, because the pull sheet needs a
> per-card CSV, which TCGplayer's standard export isn't.


Prepared by Claude on 2026-09-28. The owner creates the account and pays
(PERMISSIONS.md: money moves are the owner's). Everything else is here,
ready to paste. All copy is checked against Google's character limits.

## 0. Before you spend a dollar

- **Search Console first** (OWNER-TODO #6). Free organic traffic comes
  before paid.
- **Tracking without Google's tag.** The site promises "no ads and no
  tracking cookies" and loads no third-party scripts, so we **don't add the
  Google tag**. Every ad click carries a `gclid`, and the site already
  counts those visitors as source **`google_ads`** in the admin funnel
  (visits → CSV loads → PDFs → signups → upgrades). That's how we judge
  the test.
- **Budget for the test:** $5/day, capped at **$150 total** (~30 days).
  - Keep going if it brings **3+ paying customers**.
  - Otherwise stop, and put the money into the partner program.
- **What a customer is worth:**
  - A paying seller averages ~$4.50/mo, or ~$36 over about 8 months.
  - So the break-even is ~**$15 per paying customer**, or ~$5 per
    account signup.

## 1. Account setup (owner, ~20 min)

1. Go to ads.google.com and sign in with the business Gmail. When it
   offers a "Smart campaign", click **Switch to Expert Mode**, then
   **Create an account without a campaign**. Set the country to United
   States, the time zone to Pacific, and the currency to USD. You can't
   change these later.
2. Billing: add your card. Put in a promo code if Google offers one (new
   accounts often get "spend $X, get $X").
3. Tools → Shared library → **Negative keyword lists**: create one called
   "Not our customer" and paste the list from section 4.
4. Assets: upload the business name **TCG Speed Shipper**, the logos, and
   the images in `images/` (section 6).

## 2. Campaign settings

| Setting | Value |
|---|---|
| Goal | Website traffic (no conversion goal needed, since there's no tag) |
| Type | **Search** |
| Networks | **Uncheck** Search Partners and Display Network |
| Locations | United States, "Presence: people in or regularly in" |
| Language | English |
| Bidding | Maximize clicks, **max CPC $1.50** |
| Budget | $5.00/day |
| Final URL suffix | `utm_source=google_ads&utm_medium=cpc&utm_campaign={campaignid}&utm_content={adgroupid}` |
| Ad rotation | Optimize |
| AI Max / auto-apply recommendations | **Off** (they raise budgets and add broad keywords) |

## 3. Ad groups and keywords

Use exact `[ ]` and phrase `" "` match only, never broad.

**AG1 · TCGplayer labels** → final URL `https://tcgspeedshipper.com/`
```
[tcgplayer shipping labels]
[tcgplayer shipping label]
"print tcgplayer shipping labels"
[tcgplayer label printer]
[tcgplayer packing slip]
"tcgplayer packing slips"
[tcgplayer shipping label template]
```

**AG2 · Envelopes / PWE** → final URL `https://tcgspeedshipper.com/`
```
"pwe shipping labels"
[print addresses on envelopes from csv]
"trading card envelope labels"
[avery 5160 from csv]
"plain white envelope trading cards"
```

**AG3 · Card shipping tools** → final URL `https://tcgspeedshipper.com/`
```
[tcgplayer shipping tool]
[tcgplayer shipping software]
"card seller shipping software"
[trading card shipping software]
"shipping labels for card sellers"
```

Check volumes and suggested bids in **Keyword Planner** before launch. The
SEO data tool is out of credits, so none of these volumes are verified yet.
Drop any keyword Google marks "low search volume".

## 4. Negative keyword list ("Not our customer")

```
login
log in
sign in
customer service
phone number
careers
jobs
salary
refund
where is my order
track my order
buyer protection
buylist
sell my cards
price guide
coupon
promo code
app store
download app
reddit
```

## 5. Responsive search ad (one per ad group, same copy)

**Headlines** (≤30 chars; pin #1 to position 1 in AG1 only):
1. TCGplayer Orders to Labels
2. Print TCGplayer Labels Fast
3. CSV to Shipping Labels
4. Free: 10 Labels a Month
5. No Signup Needed to Start
6. 4x6, Envelope & Avery 5160
7. Label + Packing Slip in One
8. Stop Typing Buyer Addresses
9. Built by a TCGplayer Seller
10. Plans From $2.99/mo
11. Batch-Print All Your Orders
12. PWE Envelopes Printed For You
13. Your Data Stays in Browser
14. Try a Sample Order Free
15. Unlimited Labels $5.99/mo

**If Google disapproves "TCGplayer" in ad text** (it's their trademark,
and they can restrict it), swap headlines 1, 2 and 9 for these:
- Card Orders to Labels
- Print Card Shipping Labels
- Trading Card Shipping Tool

Keeping "TCGplayer" as a *keyword* is fine.

**Descriptions** (≤90 chars):
1. Upload your order CSV and get print-ready labels, envelopes and packing slips in seconds.
2. Flags which orders need tracking ($49.99+) or signature ($250+). Free for 10 labels/month.
3. Thermal 4x6, #10 envelopes, Avery 5160 or label + slip on one page. Try free, no signup.
4. Made by a card seller for card sellers. Addresses never leave your computer. Start free.

**Display path:** `tcgspeedshipper.com/labels/free`

## 6. Assets

**Sitelinks** (text ≤25, lines ≤35):

| Text | Line 1 | Line 2 | URL |
|---|---|---|---|
| Pricing & Plans | Free, $2.99/mo or $5.99/mo | Save 2 months with yearly | `/#pricing` |
| Label + Packing Slip | One page per order | Print, cut and pack | `/guide/how-to-print-tcgplayer-shipping-labels.html` |
| Envelopes & Avery | Print #10 envelopes for PWE | Or 30 labels per Avery sheet | `/blog/how-to-ship-trading-cards-in-a-plain-white-envelope.html` |
| Enterprise | Automation for card shops | Custom tools and team seats | `/#enterprise` |

**Callouts** (≤25): Free: 10 labels/month · No signup needed · Data stays
in browser · Thermal, Avery, #10 · Cancel anytime · Made by a card seller

**Structured snippet**: header *Types*: 4x6 Thermal, #10 Envelope,
Avery 5160, Label + Slip, Pull Sheet

**Price assets** (optional): Free $0/mo · Base $2.99/mo · Premium $5.99/mo

**Images** (`images/`, for image assets and any later Demand Gen or
Performance Max campaign):

| File | Size | Use |
|---|---|---|
| `ad-landscape-1200x628.png` | 1.91:1 | Landscape image |
| `ad-square-1200x1200.png` | 1:1 | Square image |
| `ad-portrait-960x1200.png` | 4:5 | Portrait image |
| `logo-square-1200x1200.png` | 1:1 | Business logo |
| `logo-landscape-1200x300.png` | 4:1 | Landscape logo |

The social preview card is `public/og-card.png` (1200×630). The favicon
files are in `public/`: `favicon.svg`, `favicon.ico`,
`apple-touch-icon.png`, `icon-192.png`, `icon-512.png` and
`icon-maskable-512.png`.

## 7. Weekly routine (10 min, Mondays)

1. **Search terms report:** add anything irrelevant to the negative list.
2. **Keywords:** pause any keyword with **$15+ spent and 0 CSV loads**.
3. **Admin funnel, source `google_ads`:** compare CSV loads, signups and
   upgrades against the spend.
4. Log the numbers in the Scoreboard in `docs/MARKETING-PLAN.md`.
5. **Day 30:** 3+ paying customers means keep going and raise the budget
   to $10/day. Otherwise pause.

## Not now

- **Performance Max / Demand Gen:** these need a conversion tag to
  optimize, which we don't run. Revisit only if Search works.
- **Brand campaign** ("tcg speed shipper"): nobody searches it yet.
- **Competitor keywords:** wait for data.
