# Speed Scan: card data, index design and TCGplayer ID coverage

Status 2026-10-15. Terms below are written **from memory of each provider's public pages; none was re-read today and the
sandbox cannot reach them (a test fetch of Scryfall was refused by the network). Read each page before shipping.**
No real catalog is loaded yet: the app ships only the 96-card sample list, so it cannot list real inventory until the
importers below are run by someone with open internet (a laptop).

## Live lookup from the seller's browser (built 2026-10-16, UNVERIFIED against the real services)
Because no real catalog is loaded, any card not in the sample list is looked up online by the seller's own browser
(`data/live.js`; prices are the services' own market fields and carry the time they were fetched; see Price freshness below): Magic through Scryfall (exact set + number, or name), Pokémon through the Pokémon TCG API, Yu-Gi-Oh!
through YGOPRODeck. One Piece has no source yet. Found cards are added to the search list and saved on the device, so
they work offline next time. Requests are spaced 120 ms apart and run one at a time. What the seller types is sent to
those services (the app says so beside a checkbox that turns it off). The build sandbox cannot reach any of them, so this
is tested only with fixtures and a simulated Scryfall in a browser; the Pokémon and YGOPRODeck request shapes are from
memory and may need fixing against the real services. Whether their sites allow browser calls (CORS) is also unconfirmed
for the last two.

## One Piece: best free source, checked 2026-10-16
Looked at two public sources (by web search and one page fetch; optcgapi.com could not be opened from the sandbox, so its
details are from search summaries only):
- **optcgapi.com** ("OPTCG API"): says it is free, needs **no key**, GET requests only, open to anyone, asks for modest
  volume, mentions daily limits without a number, covers OP-01 to OP-15 plus starter decks (its pages disagree on the
  range). Terms of use, attribution, commercial use, the exact JSON fields and whether browsers may call it (CORS) are
  **unconfirmed**. This is the best candidate.
- **arjunkai/optcg-api** (GitHub): needs a key sent on request, "non-commercial dev access", and the live service only
  answers two named websites. **Not usable.** Its card data has TCGplayer product ids (`tcg_ids`) and USD prices, which is
  what we would want, but the data rights are with upstream sources.
- Scrydex One Piece endpoint needs a key. **Not usable.** Bandai's own card list and TCGplayer are not data sources we may use.
Decision: the importer (`providers/onepiece.js`, `build-index.js onepiece`) is written on a tiny fixture with an **assumed**
shape (`card_set_id`, `card_name`, `market_price`...). One Piece is **not** in live lookup, because endpoints, terms and
browser access are unconfirmed. Until someone with open internet reads optcgapi.com's terms and saves a sample response,
One Piece means the 22 sample cards, with product id and price typed or pasted by hand.

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

## Price freshness (built 2026-10-16)
Prices come from each service's market field: Scryfall `prices.usd` / `usd_foil`, Pokémon TCG API `tcgplayer.prices[variant].market`,
YGOPRODeck `card_prices[0].tcgplayer_price`. Each printing stores when it was fetched. Scryfall asks that its prices are not kept
older than 24 hours. A price older than 24 hours is fetched again when the device is online; if that fails the card is still added
but the row shows "price from <date>, older than a day" in red until the seller types a price. Sample (demo) prices are marked demo.
## TCGplayer product id from a pasted link (built 2026-10-16)
When a card has no product id the seller pastes the card's TCGplayer page address; the number after `/product/` is read out of
the text (`core/tcgurl.js`). The page is never fetched or opened by the app. Only tcgplayer.com addresses are accepted.
