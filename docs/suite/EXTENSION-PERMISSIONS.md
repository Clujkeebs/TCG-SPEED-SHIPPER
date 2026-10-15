# Extension permissions: every one, and why

Rule: the extension asks for the least it can. A test (`suite/extension/test/permissions.test.js`) fails if the
manifest gains or loses a permission, host or page match without a matching row in this table. To add one: add
the row here first (say why it is needed and what the seller sees), then change the manifest.

| Item | Kind | Why we need it | What the seller sees |
|---|---|---|---|
| `storage` | permission | Save the on/off switches and settings on the seller's own computer. | Nothing (no warning). |
| `sidePanel` | permission | Show the Agent panel at the side of the browser. | Nothing (no warning). |
| `https://tcgspeedshipper.com/*` | page match (script) | A small script that passes the seller's own messages between our website and the extension. Does nothing else. | "Read and change data on tcgspeedshipper.com". |
| `http://localhost/*` | page match (script) | Same, for development. **Remove before the first Chrome Web Store submission.** | A warning about localhost. |
| `https://seller.tcgplayer.com/*` | optional host | Asked for at the moment the seller turns a TCGplayer helper on. Not available yet: locked until TCGplayer says it is okay. | A question, only when they switch a helper on. |

Not requested, on purpose: `tabs`, `activeTab`, `cookies`, `history`, `webRequest`, `scripting`, `downloads`,
`<all_urls>`, any other website. The extension makes no network requests of its own.
