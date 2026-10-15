# TCG Speed Suite: shared data model (schema version 1)

The code is `suite/shared/models.js` (constants, helpers and validators, with tests). This page
says what the fields mean. **Change a shape only after a note in `LOG.md`**, then update the code,
the tests and this page together.

Rules for every shape:
- Money is **whole cents** (integers). Never floats, never dollars.
- Dates are ISO 8601 in UTC (`2026-10-15T12:00:00Z`, or a plain date where noted).
- Ids are strings. Cards use `game:provider:providerId` (`makePrintingId`).
- Unknown means **absent**, never guessed. In particular `tcgplayerProductId` is left out when we do
  not know it.
- Buyer details (`Order.shipTo`, names) stay on the seller's device. Never write them to logs,
  fixtures, commit messages or analytics. Tests use made-up people.

## Constants
- Games: `mtg`, `pokemon`, `yugioh`, `onepiece`, `lorcana`, `fab`, `other`
- Conditions: `NM`, `LP`, `MP`, `HP`, `DMG` (map to TCGplayer's names in the CSV writer, not here)
- Finishes: `nonfoil`, `foil`, `etched`, `holo`, `reverse-holo`, `first-edition`, `unlimited`
- Scan methods: `ocr`, `embedding`, `llm`, `barcode`, `manual`
- Price bases: `market`, `low`, `mid`, `fixed`
- Roundings: `cent`, `nickel`, `dime`, `ends-99`, `ends-95`, `dollar`

## Shapes

### Printing (a card as printed in one set)
| Field | Type | Notes |
|---|---|---|
| `id` | string | `game:provider:providerId` |
| `game` | game | |
| `name` | string | as printed |
| `setCode`, `setName?` | string | `setCode` is the short code on the card or from the provider |
| `number` | string | collector number **as printed** (can contain letters, slashes) |
| `finishes` | finish[] | finishes that exist for this printing |
| `language` | string | `en`, `ja`, ... |
| `rarity?`, `imageUrl?` | string | informational |
| `tcgplayerProductId?` | integer | only when known from a licensed source; never guessed |
| `prices?` | `{ asOf, source, byFinish: { finish: { market?, low?, mid? } } }` | cents; `source` says where the number came from |

### PriceRule
`id`, `name`, `basis`, `percent` (`-5` = 5% below), `fixedCents?` (required when `basis` is
`fixed`), `floorCents?`, `ceilingCents?`, `minListCents?` (skip cards below this), `rounding`,
`conditionMultipliers?` (`{ NM: 1, LP: 0.9, ... }`).

### ListingDraft (one row about to be listed)
`id`, `printingId`, `condition`, `finish`, `language`, `quantity` (1 or more), `priceCents`,
`priceRuleId?`, `tcgplayerProductId?` (a product id the seller typed or the provider supplied; never
guessed), `source` (`scan`, `manual`, `import`), `createdAt`.

### ScanRecord (one card seen by the camera)
`id`, `sessionId`, `at`, `printingId` (or `null` when unresolved), `confidence` (0 to 1), `method`,
`candidates` (`[{ printingId, score }]`), `accepted`, `imageRef?` (a local reference, never a
public URL).

### InventoryItem
`printingId`, `condition`, `finish`, `language`, `quantity` (0 or more), `priceCents?`,
`location?` (bin or box), `source`.

### Order (Shipper side; contains buyer details)
`id`, `source` (`tcgplayer`, `ebay`, `whatnot`, `manapool`, `cardmarket`, `other`), `orderedAt`,
`status`, `buyerKey` (a local pseudonymous key, used to spot repeat buyers without keeping the name
in analytics), `shipTo { name?, address1, address2?, city, state, postalCode, country }`,
`items [{ name, quantity, priceCents, setName?, number?, condition?, finish? }]`,
`itemsTotalCents`, `shippingPaidCents`, `trackingNumber?`, `carrier?`, `shippedAt?`.

### Automation (Agent)
`id`, `name`, `trigger { type: cron|event, value }`, `steps [{ tool, args? }]`,
`approvalMode` (`always`, `first-run`, `never`), `enabled`, `lastRunAt?`.

### AuditEntry (Agent)
`at`, `actor` (`user`, `agent`, `automation`), `tool`, `tier` (`read`, `draft`, `act`,
`autopilot`), `argsHash` (a hash, never raw arguments), `outcome` (`ok`, `error`, `denied`),
`approvedBy?`.

## Storage (decided now, revisit if it hurts)
- Web apps and the extension keep working data in IndexedDB on the device.
- Cloud sync, if we add it, is opt-in and encrypted on the client. Not in v0.
- Nothing in this model is sent to our server unless a feature needs it and says so on screen.
