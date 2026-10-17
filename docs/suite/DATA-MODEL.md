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

## Agent messages and records (added 2026-10-15, code in `suite/agent/`)
Side panel <-> Agent messages use the bridge shape: request `{ source: 'tcgss-panel', v: 1, id, type, payload }`, response
`{ source: 'tcgss-agent', v: 1, id, ok, result | error }`, events `{ source: 'tcgss-agent', v: 1, event, ... }`.
`hello` returns `types` (every request type and event this service supports), plus `requests` and `events` separately. The new
types appear only when the service has an agent, so an older panel sees no change. Checked by `validateEvent` in `protocol.js`.

| Message | Shape |
|---|---|
| request `agent.memory.list` | no payload. Response `{ items: [{ id, text }] }` |
| request `agent.memory.forget` | `{ id }`. Response `{ forgotten: true }` |
| request `agent.undo` | `{ approvalId }`. Response `{ undone: true, status }` |
| request `agent.inbox.list` | no payload. Response `{ cards: [{ approvalId, tool, description, why, undo, expected, args }] }` |
| request `agent.export` | `{ csv }` (a pasted or dropped Seller Portal export, at most 400,000 characters). Response `{ rows, units, columns, fixes: [{ rank, title, why, approvalId? }] }` (at most 5 fixes); each fix that changes something also arrives as an `agent.approval-needed` event |
| request `agent.orders` | `{ csv }` (a pasted or dropped TCGplayer order/shipping export, at most 6,000,000 characters). Response `{ summary, draft, charts }`; the draft has buyer names filled in as first name + initial, on the device only |
| request `agent.briefing` | no payload. Response `{ text, words, parts }` (plain text, at most 150 words) |
| request `agent.voice` | `{ samples: [3 to 5 past replies] }`. Response `{ card, text }`; the card is saved in memory |
| request `agent.voice.set` | `{ card: { ...fields to change } }`. Response `{ card, text }` |
| request `agent.suggestions` | no payload. Response `{ weekEnding, suggestions: [{ rank, id, title, why, goal }] }` (at most 5) |
| event `agent.plan` | `{ planId, steps: [{ text, state: todo\|doing\|done\|skipped }] }` (1 to 8 steps) |
| event `agent.memory` | `{ items: [{ id, text }] }` |
| event `agent.progress` | `{ tool, ok, denied, summary }`; `summary` is a short plain-words line, never arguments |
| event `agent.approval-needed` | `{ approvalId, tool, description, why, undo, expected?, warning?, args }`; `warning` is present when the request came after the assistant read text written by someone else |

Other records (all local to the device):
- **Fact** (shop memory): `{ id, text, category: setting\|preference\|decision\|fact, source: user\|agent, key?, value?, createdAt, updatedAt }`. No emails, phone numbers or street addresses.
- **Plan**: `{ id, goal, createdAt, source: rules\|model, steps: [{ id: 's1', tool, args, why, check? }] }`. An argument may be `"$s1.path"` or `{ $map: { from, pick } }` to use an earlier result.
- **Card** (approval inbox): `{ id, status: pending\|approved\|done\|failed\|declined\|expired\|undone, tool, args, what, why, expected, undoText, actor, planId?, stepId?, createdAt, result?, undo? }`. Pending cards expire after 7 days.
- **Report** (background job): `{ id, jobId, title, text, steps, cardIds, drafts?, event?, ranAt }`.
- **Automation** is unchanged; `trigger` may now be `{ type: 'event', value: 'low-stock' | 'new-order' | 'unanswered-message' }`. Jobs the agent saves are always `approvalMode: 'always'`.
- Buyer drafts carry `{{first_name}}`; the name is filled in on the device only.

**Untrusted text (2026-10-16).** Buyer messages, files, order notes and shop feeds are data, never instructions. Tools that return such text are flagged `untrusted` (the run becomes "tainted", the result reaches the model wrapped with a notice, and text is cleaned and capped); once tainted, a run cannot read or save memory or schedules (`blockedAfterUntrusted`). A Card made in a tainted run has `warning`. See `docs/suite/AGENT-EVAL.md`, "Prompt-injection red team".
- **Policy entry** (`policies.js`): `{ id: 'LOST-1', topic, title, summary, asOf, source: { blog, blogUrl, official? }, check }`. Our own words, cited to our blog post (and the TCGplayer help article it links). Drafts cite entry ids in a seller-only block that says to check TCGplayer's current article.

**Order file, voice, saved state (2026-10-16).**
- **Order-file summary** (`orderfile.js`, `orders.fileInsights`): `{ ok, rows, orders, skipped, revenueCents, averageOrderCents, thresholds: { over20, atLeast4999, atLeast250 }, states[], zipAreas[] (first 3 digits), weekday{}, hours[24] | null, thisWeek, lastWeek, weekChangePct, weeks[], repeat: { buyers, repeatBuyers, top: [{ buyer: 'b-..', orders, spendCents }] } }`. Buyers are keys; a separate on-device table maps key to "Ada L." (first name + initial). Drafts hold `{{buyer:KEY}}` until the device fills them in.
- **Voice card** (memory fact with key `voice.card`, value is JSON): `{ version: 1, greeting, signOff, length: short|medium|long, formality: casual|neutral|formal, exclamation, emoji }`. Only whitelisted words and settings; nothing from the sample replies is kept.
- **Saved state** (`persist.js`): one IndexedDB object store `kv` in database `tcgss-agent-state`, one record per store (`memory`, `automations`, `inbox`, `reports`, `plans`), each `{ v: 1, data }`. A record with another `v` is left untouched. The audit trail has its own store (`tcgss-agent-audit`). The buyer-names table is never saved.
