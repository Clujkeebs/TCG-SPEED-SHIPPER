# Speed Scan: card data, index design and TCGplayer ID coverage

Status 2026-10-15. Terms below are written **from memory of each provider's public pages; none was re-read today and the
sandbox cannot reach them (a test fetch of Scryfall was refused by the network). Read each page before shipping.**
No real catalog is loaded yet: the app ships only the 96-card sample list, so it cannot list real inventory until the
importers below are run by someone with open internet (a laptop).

## The offline index (designed and built)
One file per game, `data/index/<game>.json`, loaded on first use and cached for offline use. Format (`data/compact.js`,
tested): a small header (`version`, `game`, `asOf`, `source`, `count`) and one array per printing:
`[id, name, setCode, setName, number, finishes, tcgplayerProductId (0 = unknown), rarity, language, prices]`.
Prices are cents per finish (market, low, mid). No images are stored. Rough size (estimate, not measured): about 100 bytes a
row, so Magic (tens of thousands of printings) a few MB, the other games smaller; each game loads only when chosen.
Search is in memory (`data/index.js`): name, set code, set name, collector number, plus exact set+number lookup for the camera.
Unknown means absent: a missing product id stays missing and the CSV lists that row for the seller to fix.

Build a game file from data you downloaded yourself (never run by tests, which use tiny fixtures only):
`node data/import/build-index.js <scryfall|pokemontcg|ygoprodeck|onepiece> <input.json> <outDir> [asOf]`
The report prints how many printings were read, how many bad rows were skipped, and how many have a product id.

## Sources, what they give, and terms to confirm
| Game | Source | Gives us | Product id? | Terms to confirm before use |
|---|---|---|---|---|
| Magic | Scryfall bulk data (`/bulk-data`, "Default Cards" or "All Cards") | name, set, number, finishes, USD prices, TCGplayer ids | **Yes** (`tcgplayer_id`; etched has its own, not used yet) | Free, but their rules ask for a User-Agent and Accept header, polite rate limits, no paywalling the data, credit; images belong to Wizards. Prices are a day old. Read scryfall.com/docs/api. |
| Pokémon | Pokémon TCG API (pokemontcg.io) | name, set, number, rarity, TCGplayer-sourced prices per variant | Not in the shape we assumed. Confirm. | Free; a key raises the rate limit but needs a sign-up, so we use none. Confirm attribution and commercial use. |
| Yu-Gi-Oh! | YGOPRODeck API v7 | name, every set listing with code and rarity, one price per card | Not in the shape we assumed. Confirm. | Free with rate limits; they ask users to cache data and host images themselves rather than hotlink. Confirm. |
| One Piece | No official API. Community APIs exist; none chosen. | name, set, number, rarity, some prices | Unknown | Unread. Needs a choice and a terms check before any use. |
Never use tcgcsv.com or any unofficial TCGplayer mirror (plan, section 2).

## Closing the product-id gap (not built yet)
Only Magic has ids from its source. For the other games the seller's own TCGplayer inventory export lists each of their
cards with its TCGplayer Id, product name, set name and number. A later step can match those rows to our printings and keep a
private id map on the seller's device. Needs one real export from the owner first.

## Coverage today
| Game | Source in code | IDs | State |
|---|---|---|---|
| Magic | `providers/scryfall.js` (documented shape, fixtures only) | from the source when present | Not run on real data |
| Pokémon | `providers/pokemontcg.js` (assumed shape) | none | Not run on real data |
| Yu-Gi-Oh! | `providers/ygoprodeck.js` (assumed shape) | none | Not run on real data |
| One Piece | `providers/onepiece.js` (assumed shape, source unchosen) | none | Not run on real data |
| Sample list | `data/sample/` | none, on purpose | Collector numbers unchecked, prices invented |
