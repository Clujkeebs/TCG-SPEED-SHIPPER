# TCG Speed Suite extension: privacy policy (DRAFT)

Draft for the owner. It must match the site's Privacy Policy (https://tcgspeedshipper.com/privacy.html,
last updated October 6, 2026). If the site policy changes, change this too. Not published anywhere yet.

**Short version:** The extension keeps your data on your own device. It does not collect, sell or
share anything, and it has no analytics, ads or tracking.

## What it stores, and where
Everything is kept **on your own device**, in your browser's own storage (IndexedDB and `chrome.storage.local`). Nothing is
stored on our servers.
- **Your switches and settings** (which helpers are on, and the optional server address, which is off by default).
- **Records you send it from tcgspeedshipper.com**: orders, listings, inventory, scan records, and **tracking batches**
  (order numbers and tracking numbers the Shipper site hands over). Orders can include buyer names and addresses; they stay in
  your browser, the same promise as the website.
- **Your order file, if you import one**: the orders in the TCGplayer export you choose (including buyer names and addresses, as in the file) are read in your browser and kept in your browser's storage so the Insights tab and the assistant can use them. The file is never uploaded. **Remove it** with "Go back to the practice shop" in the Insights tab, or with Clear everything. The Insights tab shows buyers as first name and last initial only.
- **The side-panel assistant (practice mode)**: its current plan, the facts you ask it to remember about your shop (you can see
  and remove each one), the approval cards waiting for your answer (and recently finished ones, so you can undo them), saved
  background jobs and the reports they leave, whether you pressed Stop, and the prices in its made-up practice shop. Background
  jobs run on this computer only, on made-up data, and anything that would change something waits for your approval.
- **The toolbar number**: a small badge on the extension icon counts the approvals waiting. There are no pop-up notifications. It also keeps a **history of what it did**: which tool, when, whether it was approved, and a one-way fingerprint of the
  details (never the details themselves). This is stored so the assistant picks up where it left off if your browser puts it to sleep.
- **A flag that you have seen the first-run tour.**
- **One button erases all of it.** Settings has **Clear everything**, which asks first, then erases all of the above from this
  computer, including the history of what the assistant did. Removing the extension does the same.

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
