# Chrome Web Store checklist

Nothing here is done by us yet: **the owner decides** when to pay the one-time developer fee ($5 per
PLAN.md; confirm on the Web Store page). Builders do not sign up for anything.

## Before the first submission
- [ ] Owner: create the developer account (one-time fee) and verify the email.
- [ ] Owner: read `PRIVACY.md`, approve it, and have it published on a public page (the site's
      privacy page is the natural home). The store form needs a link.
- [ ] `npm run build` makes `dist/tcg-speed-suite-<version>.zip`. Version in `manifest.json` and
      `package.json` must match (the build checks).
- [ ] Icons: 16, 48, 128 px PNG (not made yet; add `icons` to the manifest).
- [ ] Screenshots (1280x800) and a short description. Plain words.
- [ ] Do not submit any TCGplayer module until "TOS OK" is in `docs/suite/LOG.md`.

## Single-purpose statement (draft)
"Helps trading-card sellers get through their shipping and listing day faster by passing their own
order and listing data between their TCG Speed Shipper tools and their seller pages, one click at a
time."

## Permission justifications (draft)
| Permission | Why |
|---|---|
| `storage` | Save the seller's on/off settings on their device. |
| `sidePanel` | Show the Agent panel (placeholder in this version). |
| `https://tcgspeedshipper.com/*` (script and one request) | Pass the seller's own tracking numbers and login token from our website to the extension (write only), and ask the site once whether the online assistant is available. Optional: Chrome asks on the Settings click, not at install. | 
| optional host `https://seller.tcgplayer.com/*` | Asked at runtime, only when the seller turns on a TCGplayer helper (not available yet). No install-time warning. |

## Data-use disclosures (store form)
- Collects: "Website content" and "Personally identifiable information" only in the sense that the
  seller's own order data is stored **locally**; not transmitted. Certify: not sold, not used for
  unrelated purposes, not used for creditworthiness.
- No remote code. No analytics.

## Each update
Review takes 1 to 3 days. Keep a quick-fix path for when TCGplayer changes a page.
