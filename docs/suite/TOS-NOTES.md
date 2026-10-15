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

## Ready-to-send email draft (NOT sent; no recipient chosen)
The owner picks where to send it. Find a seller-support or partnerships contact on TCGplayer's own help
site; do not guess an address. Replace the bracketed parts. Send it from the owner's own address.

> **Subject:** Question about a seller-installed browser helper for Seller Portal
>
> Hello,
>
> I run TCG Speed Shipper (tcgspeedshipper.com), a free-to-start tool that helps TCGplayer sellers print
> shipping labels and packing slips. I am building a small Chrome extension that the seller installs
> themselves. It would only act when the seller clicks a button, while the seller is logged in to their own
> Seller Portal. It would never log in for them, never store their password, never run in the background,
> and never touch any other seller's data. I would like to check that this is allowed before I release it.
>
> The three things it would do:
> 1. **Fill in tracking numbers** on the seller's own "mark as shipped" page, after the seller clicks. The
>    seller then clicks Save themselves.
> 2. **Read the order list the seller already has open** and pass it to their own Speed Shipper tab in the
>    same browser, so they do not have to export and re-upload a CSV. Nothing is sent to a server for this.
> 3. **Put the seller's own CSV into the Import CSV page's file box.** The seller then clicks Upload.
>
> My questions:
> 1. Is this kind of seller-run helper allowed under the Terms of Service and the Marketplace Seller Agreement?
> 2. Is reading the order list on screen (item 2) acceptable, or would you prefer an approved route for it?
> 3. Is there a partner program, an approved way, or a contact for tools like this?
> 4. Can you confirm in writing, and tell me who to contact if a page changes and the helper needs an update?
>
> Nothing has been released and the helper is switched off in the code until I hear from you. Thank you for
> your time.
>
> [Owner name]
> [Business name] · [owner's email] · tcgspeedshipper.com

Notes: keep it short; send one email, not several; do not attach code. If they say no to item 2 but yes to
items 1 and 3, we ship only those. "No reply" is not permission.

## What the owner needs to do
1. Read the three pages above (Claude can help line by line). 2. Approve the email in "Questions".
3. Only after that, the Builder writes "TOS OK" in the log, if the answer allows it.
