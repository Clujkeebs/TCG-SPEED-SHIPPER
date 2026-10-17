# Extension permissions: every one, and why

Rule: the extension asks for the least it can. A test (`suite/extension/test/permissions.test.js`) fails if the
manifest gains or loses a permission, host or page match without a matching row in this table. To add one: add
the row here first (say why it is needed and what the seller sees), then change the manifest.

| Item | Kind | Why we need it | What the seller sees |
|---|---|---|---|
| `storage` | permission | Save the on/off switches and settings on the seller's own computer. | Nothing (no warning). |
| `alarms` | permission | Wake the extension once a minute so a saved background job can run on its schedule (practice data only). | Nothing (no warning). |
| `sidePanel` | permission | Show the Agent panel at the side of the browser. | Nothing (no warning). |
| `https://tcgspeedshipper.com/*` | page match (script) | A small script that lets our own website hand the extension a batch of tracking numbers and the signed-in user's access token (write only). A page can call exactly four things (`hello`, `tracking.put`, `account.link`, `account.unlink`); it can read nothing back from the extension. The same address is the one place the extension calls: `GET /api/agent/status`, with that access token, to say whether the online assistant is available. That call is an **optional** permission: Chrome asks only when you switch on "Online assistant" in Settings (a click), never at install, and you can switch it off again. There is no localhost in the production build (only in a test copy). | "Read and change data on tcgspeedshipper.com". |
| `https://seller.tcgplayer.com/*` | optional host | Asked for at the moment the seller turns a TCGplayer helper on. Not available yet: locked until TCGplayer says it is okay. | A question, only when they switch a helper on. |

Not requested, on purpose: `tabs`, `activeTab`, `cookies`, `history`, `webRequest`, `scripting`, `downloads`,
`notifications` (no pop-ups: the toolbar icon only shows a small number), `<all_urls>`, any other website. The extension makes no network requests of its own.
