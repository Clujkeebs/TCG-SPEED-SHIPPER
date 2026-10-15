# TCG Speed Suite extension: privacy policy (DRAFT)

Draft for the owner. It must match the site's Privacy Policy (https://tcgspeedshipper.com/privacy.html,
last updated October 6, 2026). If the site policy changes, change this too. Not published anywhere yet.

**Short version:** The extension keeps your data on your own device. It does not collect, sell or
share anything, and it has no analytics, ads or tracking.

## What it stores, and where
- **On your device only**, in your browser's own storage (IndexedDB and `chrome.storage.local`):
  your on/off settings, and the orders, listings, inventory and scan records that you send to it
  from tcgspeedshipper.com. Orders can include buyer names and addresses; they stay in your browser,
  the same promise as the website.
- You can erase everything by removing the extension or clearing its site data.

## What it sends
- **Nothing.** The extension makes no network requests of its own. It does not send data to us or to
  anyone else.
- The one thing the website itself does with an address is buying postage (the address goes through
  our server to Pitney Bowes to make the label). That is on the website, only when you choose to buy
  a label, and is described in the site's Privacy Policy. The extension does not do it.

## What it can see
- It runs a small script only on tcgspeedshipper.com (and localhost, for development) to pass your
  own messages between the site and the extension.
- It has **no access to TCGplayer** in this version. If a later version adds TCGplayer helpers, they
  will ask for permission first, act only when you click a button, never log in for you, never store
  your TCGplayer password, and never read other sellers' data. This policy will be updated before
  that ships.

## What it never does
No analytics or telemetry. No ads. No selling or renting data. No remote code. No background activity
against any other website.

## Contact
privacy@tcgspeedshipper.com
