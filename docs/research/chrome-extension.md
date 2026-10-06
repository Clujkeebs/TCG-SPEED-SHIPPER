# Chrome extension: draft for discussion (not being built)

Claude, 2026-10-06. Status: **idea draft.** Nothing is built. For the owner
and Claude to talk through before any work starts.

## What it is, in one sentence
A free browser add-on that turns the seller's shipping day on TCGplayer
into two clicks: **"Print shipping"** on the TCGplayer Orders page, and
**"Paste tracking"** back into TCGplayer after printing.

## Today's workflow vs. with the extension

| Today (about 8 steps) | With the extension (2 clicks) |
|---|---|
| 1. Seller Portal → Orders → tick orders | 1. On the Orders page, click **Print shipping** (a button the extension adds) |
| 2. Export Shipping → a CSV downloads | (the orders go straight into TCG Speed Shipper; no file) |
| 3. Click Packing Slip → a PDF downloads | (slips are fetched the same way) |
| 4. Open tcgspeedshipper.com, upload the CSV | |
| 5. Add the slip PDF | |
| 6. Print; buy postage | Print and buy postage as today |
| 7. Make the tracking file | 2. Click **Paste tracking**: the extension fills each order's tracking number into TCGplayer |
| 8. Upload the tracking file to TCGplayer | |

For a seller doing 30 orders a day, that saves about 10–15 minutes a day,
every day. That's the thing they'd tell other sellers about.

## How it works (plain version)
- It only reads pages the seller already has open, while logged in as
  themselves. It never logs in for them, never stores their TCGplayer
  password, and never touches other sellers' data.
- "Print shipping" reads the same order list TCGplayer shows on screen (or
  clicks the same Export button for them) and hands it to our app in the
  browser. Addresses stay on the seller's computer, the same promise as
  today.
- "Paste tracking" fills the tracking numbers into TCGplayer's own
  mark-shipped form, or builds the import file and uploads it the way the
  seller would.

## Why it matters for the business
- Nobody else offers it. Every competitor stops at "upload a CSV".
- It works with postage: Print → buy postage → Paste tracking is the whole
  shipping day, all in our tools. That drives the per-label fees.
- Positioning: free install, with the Pro "one-click mark shipped" as the
  upsell.

## Risks to talk through
1. **TCGplayer's rules.** Their seller agreement may limit automation on
   the Seller Portal. Read it first. Keep it to "the seller's own data,
   clicks the seller asked for". Never scrape the marketplace or other
   sellers.
2. **TCGplayer changes its page:** the extension breaks until we update
   it. We'd need a quick-fix process (Chrome Web Store review takes 1–3
   days).
3. **Chrome Web Store:** a one-time $5 developer fee, a privacy policy
   (ours works), and a review for each update.
4. **Support:** some sellers use Safari or iPad. The extension is
   desktop Chrome/Edge (and Firefox later), so the CSV upload stays for
   everyone else.

## Smallest useful first version (about 1–2 weeks)
1. Only the **"Paste tracking"** half. It's lower risk because it fills a
   form the seller is already on, and it's the bigger time-saver after
   postage.
2. Then "Print shipping".

## Questions for the owner
1. Do you use Chrome on a computer for TCGplayer, or mostly the iPad?
   This matters a lot for Rob and similar sellers.
2. OK to read TCGplayer's seller agreement together before any build?
3. Free for everyone, or "Paste tracking" as a Pro feature?
