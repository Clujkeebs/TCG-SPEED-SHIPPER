// Reads the seller's STOCK from a file, on this device: TCGplayer's inventory export, or Speed Scan's own CSV.
// In TCGplayer's export "Total Quantity" is the seller's current count, so that is the stock. Column names are
// matched loosely (the real export is unverified); a wrong file is explained in plain words, bad rows are skipped
// and counted, and nothing is guessed: no price is made up, no card is matched to a database.
//
// Each product becomes a "printing" (name, set, number, TCGplayer id) and each condition/finish a stock row.
// parse(text) -> { ok, items, printings, skipped: [{row, reason}], rows, columns, format, error? }
import { readCsvRows, MAX_BYTES, MAX_ROWS } from '../orders/parser.js';
import { validatePrinting, validateInventoryItem, dollarsToCents } from '../vendor/shared/models.js';

const norm = (h) => String(h).toLowerCase().replace(/[^a-z0-9]/g, '');
const WANT = {
  productId: ['tcgplayerid', 'tcgplayerproductid', 'productid', 'tcgproductid'],
  line: ['productline', 'game', 'category'],
  set: ['setname', 'set', 'expansion'],
  name: ['productname', 'name', 'cardname'],
  number: ['number', 'cardnumber', 'collectornumber'],
  condition: ['condition'],
  quantity: ['totalquantity', 'quantity', 'qty', 'stock'],
  price: ['tcgmarketplaceprice', 'yourprice', 'listprice', 'price'],
  market: ['tcgmarketprice', 'marketprice']
};
const CONDITIONS = { nearmint: 'NM', nm: 'NM', lightlyplayed: 'LP', lp: 'LP', moderatelyplayed: 'MP', mp: 'MP', heavilyplayed: 'HP', hp: 'HP', damaged: 'DMG', dmg: 'DMG' };
const GAME_WORDS = [['magic', 'mtg'], ['pokemon', 'pokemon'], ['yugioh', 'yugioh'], ['onepiece', 'onepiece'], ['lorcana', 'lorcana'], ['fleshandblood', 'fab']];

export function mapStockColumns(headers) {
  const n = headers.map(norm);
  const cols = {};
  for (const [key, names] of Object.entries(WANT)) {
    cols[key] = -1;
    for (const want of names) { const at = n.indexOf(want); if (at !== -1) { cols[key] = at; break; } }
  }
  return cols;
}

const gameOf = (line) => { const k = norm(line); const hit = GAME_WORDS.find(([w]) => k.includes(w)); return hit ? hit[1] : 'other'; };
const setCodeOf = (name) => (String(name ?? '').split(/[^A-Za-z0-9]+/).filter(Boolean).map((w) => w[0]).join('').toUpperCase().slice(0, 5) || 'TCG');

// "Near Mint Foil" -> { condition: 'NM', finish: 'foil' }; "Unopened" and the like -> null
export function readCondition(text) {
  const t = String(text ?? '').trim();
  if (t === '') return { condition: 'NM', finish: 'nonfoil' };
  const foil = /\bfoil\b/i.test(t);
  const condition = CONDITIONS[norm(t.replace(/\bfoil\b/i, ''))];
  return condition ? { condition, finish: foil ? 'foil' : 'nonfoil' } : null;
}

export function parseStockExport(text, { now = new Date() } = {}) {
  const fail = (error, extra = {}) => ({ ok: false, error, items: [], printings: [], skipped: [], rows: 0, ...extra });
  if (typeof text !== 'string' || text.trim() === '') return fail('That file is empty.');
  if (text.length > MAX_BYTES) return fail('That file is too big (over 10 MB). Is it the inventory export?');
  const rows = readCsvRows(text);
  if (rows.length < 2) return fail('The file needs a header row and at least one card.');
  if (rows.length - 1 > MAX_ROWS) return fail(`That file has more than ${MAX_ROWS.toLocaleString('en-US')} rows. Split it and import the biggest part.`, { rows: rows.length - 1 });
  const cols = mapStockColumns(rows[0]);
  if (cols.productId === -1 || cols.quantity === -1) {
    return fail('I could not find the product id and quantity columns. Is this the TCGplayer inventory export (or the file Speed Scan makes), not the order export? Columns I found: ' + rows[0].filter(Boolean).slice(0, 12).join(', '), { rows: rows.length - 1 });
  }
  const asOf = now.toISOString().slice(0, 10);
  const printings = new Map();
  const items = [];
  const skipped = [];
  const seen = new Set();
  for (let r = 1; r < rows.length; r++) {
    const cells = rows[r];
    const get = (k) => (cols[k] === -1 || cols[k] >= cells.length ? '' : (cells[cols[k]] || '').trim());
    const rowNo = r + 1;
    const productId = get('productId');
    if (!/^\d{1,12}$/.test(productId) || Number(productId) <= 0) { skipped.push({ row: rowNo, reason: 'no product id' }); continue; }
    const q = get('quantity');
    if (!/^\d{1,6}$/.test(q)) { skipped.push({ row: rowNo, reason: 'unreadable quantity' }); continue; }
    const cond = readCondition(cols.condition === -1 ? '' : get('condition'));
    if (!cond) { skipped.push({ row: rowNo, reason: 'condition not understood (sealed product?)' }); continue; }
    const priceText = get('price');
    const price = priceText === '' ? undefined : dollarsToCents(priceText);
    if (price !== undefined && (!Number.isFinite(price) || price < 0 || price > 1e8)) { skipped.push({ row: rowNo, reason: 'unreadable price' }); continue; }
    const marketText = get('market');
    const market = marketText === '' ? undefined : dollarsToCents(marketText);
    const game = gameOf(get('line'));
    const printingId = `${game}:tcgplayer:${productId}`;
    const key = `${printingId}|${cond.condition}|${cond.finish}`;
    if (seen.has(key)) { skipped.push({ row: rowNo, reason: 'listed twice' }); continue; }
    const item = { printingId, condition: cond.condition, finish: cond.finish, language: 'en', quantity: Number(q), source: 'import' };
    if (price !== undefined && price > 0) item.priceCents = price;
    if (!validateInventoryItem(item).ok) { skipped.push({ row: rowNo, reason: 'row not valid' }); continue; }
    let p = printings.get(printingId);
    if (!p) {
      p = { id: printingId, game, name: get('name') || `TCGplayer product ${productId}`, setCode: setCodeOf(get('set')), number: get('number') || '-', finishes: [], language: 'en', tcgplayerProductId: Number(productId), prices: { asOf, source: 'your inventory export', byFinish: {} } };
      if (get('set')) p.setName = get('set');
      printings.set(printingId, p);
    }
    if (!p.finishes.includes(cond.finish)) p.finishes.push(cond.finish);
    p.prices.byFinish[cond.finish] ??= {};
    if (Number.isFinite(market) && market > 0 && market < 1e8) p.prices.byFinish[cond.finish].market = market;
    seen.add(key);
    items.push(item);
  }
  const list = [...printings.values()];
  const bad = list.find((p) => !validatePrinting(p).ok);
  if (bad) return fail('Something in the file did not look right for ' + bad.name + '. Nothing was imported.', { rows: rows.length - 1 });
  if (!items.length) return fail('I could not read any card in that file. First problem: ' + (skipped[0] ? `row ${skipped[0].row}, ${skipped[0].reason}` : 'none found') + '.', { skipped, rows: rows.length - 1 });
  const format = cols.name === -1 && cols.set === -1 ? 'scan' : 'tcgplayer';
  return { ok: true, items, printings: list, skipped, rows: rows.length - 1, format, columns: Object.entries(cols).filter(([, v]) => v !== -1).map(([k]) => k) };
}
