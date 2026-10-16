// Compact on-disk form of the offline card index: one file per game, rows as arrays so a whole game stays small.
// Row: [id, name, setCode, setName, number, finishes "a|b", tcgplayerProductId (0 = unknown), rarity, language, prices]
// prices: "finish:market:low:mid;..." in whole cents (empty parts = unknown). File header carries asOf and source.
import { validatePrinting } from '../../shared/models.js';

export const INDEX_VERSION = 1;

const packPrices = (p) => (p.prices ? Object.entries(p.prices.byFinish).map(([f, r]) => [f, r.market ?? '', r.low ?? '', r.mid ?? ''].join(':')).join(';') : '');
function unpackPrices(s, meta) {
  if (!s) return undefined;
  const byFinish = {};
  for (const part of s.split(';')) {
    const [f, market, low, mid] = part.split(':');
    const row = {};
    if (market !== '') row.market = Number(market);
    if (low !== '') row.low = Number(low);
    if (mid !== '') row.mid = Number(mid);
    byFinish[f] = row;
  }
  return { asOf: meta.asOf, source: meta.source, byFinish };
}

export function packIndex(printings, { game, asOf, source }) {
  const rows = printings.filter((p) => p.game === game).map((p) => [
    p.id, p.name, p.setCode, p.setName || '', p.number, p.finishes.join('|'), p.tcgplayerProductId || 0, p.rarity || '', p.language, packPrices(p),
  ]);
  return { version: INDEX_VERSION, game, asOf, source, count: rows.length, rows };
}

export function unpackIndex(file) {
  if (!file || file.version !== INDEX_VERSION || !Array.isArray(file.rows)) throw new Error('not a Speed Scan index file (version ' + (file && file.version) + ')');
  return file.rows.map(([id, name, setCode, setName, number, finishes, productId, rarity, language, prices]) => {
    const p = { id, game: file.game, name, setCode, number, finishes: finishes.split('|'), language };
    if (setName) p.setName = setName;
    if (rarity) p.rarity = rarity;
    if (productId > 0) p.tcgplayerProductId = productId;
    const pr = unpackPrices(prices, file);
    if (pr) p.prices = pr;
    return p;
  });
}

// How many printings per game carry a TCGplayer product id (the CSV needs one). Never fills gaps.
export function coverageReport(printings) {
  const out = {};
  for (const p of printings) {
    const g = (out[p.game] ||= { printings: 0, withProductId: 0, withPrice: 0 });
    g.printings += 1;
    if (p.tcgplayerProductId) g.withProductId += 1;
    if (p.prices) g.withPrice += 1;
  }
  for (const g of Object.values(out)) g.productIdPct = Math.round((g.withProductId / g.printings) * 1000) / 10;
  return out;
}

export function validateAll(printings) {
  const bad = [];
  for (const p of printings) { const v = validatePrinting(p); if (!v.ok) bad.push([p.id, v.errors[0]]); }
  return bad;
}
