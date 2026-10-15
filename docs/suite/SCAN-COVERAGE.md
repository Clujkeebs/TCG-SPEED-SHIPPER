# Speed Scan: card data and TCGplayer ID coverage, per game

A CSV row needs a `tcgplayerProductId`. We never guess one: rows without it go to a "fix by hand" list.
Status 2026-10-15. Nothing here was checked against a live service (the sandbox may not call them, and the
adapters are tested on hand-written fixtures). **Every "ID?" cell is a question to answer before relying on it.**

| Game | Source in code | Product ID from the source? | What the seller sees today |
|---|---|---|---|
| Magic | Scryfall (`data/providers/scryfall.js`) | Plan says Scryfall carries a TCGplayer id on most printings; the adapter keeps it when present. Coverage per set **unmeasured**. Etched ids are ignored for now. | Known id: row exports. Unknown: typed by hand. |
| Pokémon | Pokémon TCG API (`pokemontcg.js`, assumed shape) | The shape we assumed has prices but no product id. **Unconfirmed.** | Typed by hand. |
| Yu-Gi-Oh! | YGOPRODeck (`ygoprodeck.js`, assumed shape) | The shape we assumed has one price per card, no product id. **Unconfirmed.** | Typed by hand. |
| One Piece | Community API (`onepiece.js`, assumed shape) | Unknown which source; none chosen. | Typed by hand. |
| Sample data | `data/sample/` | None, on purpose. | Typed by hand. |

Other gaps: provider terms (attribution, commercial use, rate limits) are unread for all four; each adapter needs
its fixture replaced by a real saved response before launch; finishes differ by game (foil, holo, 1st edition) and
TCGplayer's condition names for them are unverified (see the CSV note in the Scan README).
To close the ID gap: owner supplies a real TCGplayer export (it lists product ids for the seller's own cards), and the
Builder decides whether any licensed id source is worth paying for ($0 for now).
