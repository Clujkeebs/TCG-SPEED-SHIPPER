// Pokémon TCG API card object -> Printing. The shape is written from memory of the public docs
// (id like "base1-4", set {id,name,ptcgoCode}, number, rarity, tcgplayer.prices[variant].{low,mid,market}).
// ASSUMED SHAPE: confirm against a real response before trusting it. Fixtures only; no network here.
import { makePrintingId } from '../../../shared/models.js';

const VARIANTS = {
  normal: 'nonfoil', holofoil: 'holo', reverseHolofoil: 'reverse-holo',
  '1stEditionHolofoil': 'first-edition', '1stEditionNormal': 'first-edition', unlimitedHolofoil: 'unlimited', unlimited: 'unlimited',
};
const cents = (v) => (typeof v === 'number' && v > 0 ? Math.round(v * 100) : undefined);

export function normalizePokemonCard(card, { asOf = new Date().toISOString() } = {}) {
  if (!card || !card.id || !card.name || !card.number || !card.set || !card.set.id) throw new Error('not a Pokémon TCG card object');
  const prices = (card.tcgplayer && card.tcgplayer.prices) || {};
  const byFinish = {};
  const finishes = [];
  for (const [variant, row] of Object.entries(prices)) {
    const finish = VARIANTS[variant];
    if (!finish) continue;
    if (!finishes.includes(finish)) finishes.push(finish);
    const r = { market: cents(row.market), low: cents(row.low), mid: cents(row.mid) };
    const clean = Object.fromEntries(Object.entries(r).filter(([, v]) => v !== undefined));
    if (Object.keys(clean).length && !byFinish[finish]) byFinish[finish] = clean;
  }
  const p = {
    id: makePrintingId('pokemon', 'pokemontcg', card.id), game: 'pokemon', name: card.name,
    setCode: String(card.set.id).toUpperCase(), setName: card.set.name, number: String(card.number),
    finishes: finishes.length ? finishes : ['nonfoil'], language: 'en',
  };
  if (card.rarity) p.rarity = card.rarity;
  if (Object.keys(byFinish).length) p.prices = { asOf, source: 'pokemontcg', byFinish };
  return p; // the API carries no TCGplayer product id, so none is set
}
