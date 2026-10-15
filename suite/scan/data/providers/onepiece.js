// One Piece community-API card row -> Printing. ASSUMED SHAPE (no official API): { card_set_id: "OP01-016",
// card_name, set_name, rarity, market_price }. Confirm against whichever source is chosen and read its terms.
// Fixtures only. No TCGplayer product id is set.
import { makePrintingId } from '../../../shared/models.js';

export function normalizeOnePieceCard(row, { asOf = new Date().toISOString() } = {}) {
  const m = row && String(row.card_set_id || '').match(/^([A-Z]{2,3}\d{2})-(\d{3})$/);
  if (!m || !row.card_name) throw new Error('not a One Piece card row');
  const p = {
    id: makePrintingId('onepiece', 'community', row.card_set_id + (row.variant ? '-' + row.variant : '')),
    game: 'onepiece', name: row.card_name, setCode: m[1], number: m[2], finishes: ['nonfoil', 'foil'], language: 'en',
  };
  if (row.set_name) p.setName = row.set_name;
  if (row.rarity) p.rarity = row.rarity;
  const mp = Number(row.market_price);
  if (Number.isFinite(mp) && mp > 0) p.prices = { asOf, source: 'community-api', byFinish: { nonfoil: { market: Math.round(mp * 100) } } };
  return p;
}
