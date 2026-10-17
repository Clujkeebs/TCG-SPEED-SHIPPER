// An invented TCGplayer-style inventory export (column names are the best guess; the real export is unverified).
export const STOCK_HEADER = 'TCGplayer Id,Product Line,Set Name,Product Name,Title,Number,Rarity,Condition,TCG Market Price,TCG Direct Low,TCG Low Price With Shipping,TCG Low Price,Total Quantity,Add to Quantity,TCG Marketplace Price';
const NAMES = ['Ember Drake', 'Quiet Grove', 'Tide Warden', 'Iron Sparrow', 'Moss Golem', 'Dusk Herald', 'Glass Fox', 'Stone Pilgrim', 'Salt Wraith', 'Pale Lantern'];
const SETS = ['Practice Set', 'Second Practice Set', 'Invented Sets Of Old'];
function rng(seed) { let s = seed >>> 0; return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

export function makeStockCsv(products = 300, { seed = 5 } = {}) {
  const r = rng(seed);
  const lines = [STOCK_HEADER];
  for (let i = 0; i < products; i++) {
    const id = 500000 + i;
    const name = `${NAMES[i % NAMES.length]} ${Math.floor(i / NAMES.length) + 1}`;
    const set = SETS[i % SETS.length];
    const market = (50 + Math.floor(r() * 4000)) / 100;
    for (const cond of ['Near Mint', 'Lightly Played', ...(r() < 0.3 ? ['Near Mint Foil'] : [])]) {
      const qty = r() < 0.2 ? 0 : Math.floor(r() * r() * 12);
      lines.push([id, 'Magic', `"${set}"`, `"${name}"`, `"${name}"`, String(i + 1), 'Rare', cond, market.toFixed(2), '', '', (market * 0.9).toFixed(2), qty, '', (market * 0.95).toFixed(2)].join(','));
    }
  }
  return lines.join('\r\n') + '\r\n';
}
