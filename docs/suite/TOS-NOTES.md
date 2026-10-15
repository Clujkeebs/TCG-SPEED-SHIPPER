# TCGplayer rules: what we think they say (NOT yet read in full)

For the owner. Written 2026-10-15 by the extension session. **The sandbox cannot open tcgplayer.com,
so every line below comes from search summaries in `PLAN.md` section 2, not from the original pages.
Nothing here is verified. Do not rely on it until the real pages are read.**

## The three documents
| Document | Link | Status |
|---|---|---|
| Terms of Service | https://help.tcgplayer.com/hc/en-us/articles/205004918-Terms-of-ServiceTCGplayer | **Not read in full** |
| Marketplace Seller Agreement | https://help.tcgplayer.com/hc/en-us/articles/201307587-Marketplace-Seller-Agreement | **Not read in full** |
| API Terms & Conditions | https://help.tcgplayer.com/hc/en-us/articles/360061115874-TCGplayer-API-Terms-Conditions | **Not read in full** |

## What they seem to say (second-hand)
- **Terms of Service:** reportedly forbid crawling or scraping the site without permission.
- **Seller Agreement:** reportedly says nothing about automation either way. (Silence is not permission.)
- **API Terms:** reportedly forbid bots outside the API. TCGplayer says it is **not granting new API
  access**, so the API is not a path for us.
- **Sanctioned route we know of:** the Seller Portal CSV import and export, done by the seller.

## Where our extension sits
| What | Risk | Our stance |
|---|---|---|
| Paste tracking (fills the seller's own open form after the seller clicks) | Medium: it automates a page | Built, **off**, fixtures only |
| Print shipping (reads orders on screen) | Medium to high: reading the page may count as scraping | Built, **off**, fixtures only |
| Upload to TCGplayer (attaches the seller's own CSV on Import CSV) | Lower: same as the seller picking the file | Built, **off**, fixtures only |
| Anything in the background, scraping, other sellers' data, logging in for the seller | Not allowed by our own rules | **Never built** |

The extension has no TCGplayer content script at all in this version, and a code gate (`TOS_OK` in
`suite/extension/src/flags.js`) keeps TCGplayer modules inert even if someone flips a flag.

## Questions to ask TCGplayer (draft; Claude can turn this into an email for the owner to approve)
1. Is a browser extension that the **seller installs and clicks** (to fill tracking numbers into the
   seller's own mark-as-shipped form) allowed under the Terms and the Seller Agreement?
2. Is it allowed for such an extension to **read the order list the seller already has on screen**
   and pass it to the seller's own tool in the same browser? Is that "scraping"?
3. Is it allowed to **attach the seller's own CSV** on the Import CSV page for them?
4. Do you have an approved or recommended way for third-party tools to do these things (a partner
   program, or an API for sellers' own orders)? Is API access for existing sellers' tools possible?
5. Would you give us **written permission**, or a contact we can ask when a page changes?
6. Does anything change if the extension is free, or paid?

## Ready-to-send email (not sent; no recipient chosen)
Sam: this is ready to send as is. Add the address yourself, from TCGplayer's own help or seller-support page
(we have not guessed one). Send one email, from your own address. A "no reply" is not permission.

**Subject:** Is a seller-run Chrome helper for Seller Portal okay?

Hello,

I run TCG Speed Shipper (tcgspeedshipper.com), a small tool that helps TCGplayer sellers print shipping labels
and packing slips. I am planning a free Chrome extension that a seller installs themselves. It would only act
when the seller clicks a button, on pages they already have open while logged in as themselves. It would never
log in for them, store their password, run in the background, or touch anyone else's data.

Before I release anything, I have three questions:

1. Is it okay for such an extension to fill tracking numbers into a seller's own "mark as shipped" page, with
   the seller clicking Save themselves?
2. Is it okay for it to read the order list the seller already has open, and pass it to the seller's own
   shipping tool in the same browser, so they can skip exporting a CSV?
3. Is it okay for it to put the seller's own CSV into the Import CSV page's file box, with the seller clicking
   Upload themselves?

If any of these is not okay, or if there is an approved route or a contact for tools like this, I would be glad
to know. Nothing has been released and the helper is switched off in the code until I hear from you.

Thank you for your time.

Sam
TCG Speed Shipper · tcgspeedshipper.com

(If TCGplayer says yes to some and no to others, we ship only the ones they allow.)

## What the owner needs to do
1. Read the three pages above (Claude can help line by line). 2. Approve the email in "Questions".
3. Only after that, the Builder writes "TOS OK" in the log, if the answer allows it.
