// Scryfall (Magic) -> Printing. Pure function over the documented card object shape
// (https://scryfall.com/docs/api/cards). No network here; see dev/fetch-scryfall.js for real data.
import { makePrintingId } from '../../../shared/models.js';

const FINISH_MAP = { nonfoil: 'nonfoil', foil: 'foil', etched: 'etched' };

function toCents(v) {
  if (v === null || v === undefined || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : undefined;
}

export function normalizeScryfallCard(card, { asOf = new Date().toISOString() } = {}) {
  if (!card || typeof card !== 'object' || !card.id || !card.name || !card.set || !card.collector_number) {
    throw new Error('not a Scryfall card object');
  }
  const finishes = (card.finishes || []).map((f) => FINISH_MAP[f]).filter(Boolean);
  const printing = {
    id: makePrintingId('mtg', 'scryfall', card.id),
    game: 'mtg',
    name: card.name,
    setCode: String(card.set).toUpperCase(),
    number: String(card.collector_number),
    finishes: finishes.length ? finishes : ['nonfoil'],
    language: card.lang || 'en',
  };
  if (card.set_name) printing.setName = card.set_name;
  if (card.rarity) printing.rarity = card.rarity;
  const img = card.image_uris || (card.card_faces && card.card_faces[0] && card.card_faces[0].image_uris);
  if (img && img.small) printing.imageUrl = img.small;
  if (Number.isInteger(card.tcgplayer_id) && card.tcgplayer_id > 0) printing.tcgplayerProductId = card.tcgplayer_id;

  const p = card.prices || {};
  const byFinish = {};
  const nonfoil = toCents(p.usd);
  const foil = toCents(p.usd_foil);
  const etched = toCents(p.usd_etched);
  if (nonfoil !== undefined) byFinish.nonfoil = { market: nonfoil };
  if (foil !== undefined) byFinish.foil = { market: foil };
  if (etched !== undefined) byFinish.etched = { market: etched };
  if (Object.keys(byFinish).length) printing.prices = { asOf, source: 'scryfall', byFinish };
  return printing;
}
