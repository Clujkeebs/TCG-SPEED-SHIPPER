// YGOPRODeck card object -> Printings (one per set listing). Shape from memory of the public docs
// (id, name, card_sets[{set_name,set_code,set_rarity}], card_prices[{tcgplayer_price: "0.35"}]).
// ASSUMED SHAPE: confirm against a real response. Fixtures only. Their price is one number per card, so it is
// used as the market price for every printing of that card.
import { makePrintingId } from '../../../shared/models.js';

export function normalizeYgoCard(card, { asOf = new Date().toISOString() } = {}) {
  if (!card || !card.id || !card.name || !Array.isArray(card.card_sets) || !card.card_sets.length) throw new Error('not a YGOPRODeck card with set listings');
  const price = Number(card.card_prices && card.card_prices[0] && card.card_prices[0].tcgplayer_price);
  return card.card_sets.map((s) => {
    const m = String(s.set_code).match(/^([A-Z0-9]+)-([A-Z]{0,3}\d+)$/i);
    if (!m) throw new Error('unexpected set code: ' + s.set_code);
    const p = {
      id: makePrintingId('yugioh', 'ygoprodeck', card.id + '-' + s.set_code + '-' + String(s.set_rarity_code || s.set_rarity || '').replace(/\W+/g, '')),
      game: 'yugioh', name: card.name, setCode: m[1].toUpperCase(), setName: s.set_name, number: m[2].toUpperCase(),
      finishes: ['unlimited', 'first-edition'], language: 'en',
    };
    if (s.set_rarity) p.rarity = s.set_rarity;
    if (Number.isFinite(price) && price > 0) p.prices = { asOf, source: 'ygoprodeck', byFinish: { unlimited: { market: Math.round(price * 100) }, 'first-edition': { market: Math.round(price * 100) } } };
    return p;
  });
}
