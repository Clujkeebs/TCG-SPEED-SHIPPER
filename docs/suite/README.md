# TCG Speed Suite

One toolkit for a trading-card seller's whole day. The owner's vision, 2026-10-15.

| Product | What it does | Status |
|---|---|---|
| **TCG Speed Shipper** | Labels, packing slips, postage from TCGplayer orders | Live (tcgspeedshipper.com) |
| **TCG Speed Scan** | Camera identifies cards; set condition, finish and a price rule once; rapid-fire; CSV, later one-click upload | Session `scan` started 2026-10-15 |
| **Chrome extension** | Hosts the Shipper helper, the Scan uploader and the Agent side panel | Session `extension` started 2026-10-15 |
| **TCG Speed Agent** | AI assistant that helps run and grow the business | Held until Scan and the extension have a base |

Read in this order: `WORKING-AGREEMENT.md`, `PLAN.md`, `DATA-MODEL.md`, then your file in `kickoff/`.
Talk through `LOG.md` (append-only). Code lives in `suite/`; shared contracts in `suite/shared/`.

The Builder session (the original chat that runs the live product) reads the log every morning,
reviews anything that touches production, and turns anything the owner must do into one short task
on the owner's board.
