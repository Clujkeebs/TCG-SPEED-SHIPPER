// A2: read an inventory CSV into InventoryItems, compare two inventories, write export CSVs.
// COLUMN NAMES ARE UNVERIFIED. They come from common spreadsheet conventions, not from a real file
// from TCGplayer, eBay, Whatnot or Mana Pool. Header matching is forgiving on purpose. When the owner
// supplies real exports, change HEADER_ALIASES and TARGETS below, nothing else.
import { CONDITIONS, FINISHES } from '../../shared/models.js';
import { applyPriceRule } from '../../scan/core/pricing.js';

export function parseCsv(text) {
  const rows = [];
  let row = [], cell = '', quoted = false;
  const s = String(text).replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"' && s[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some((x) => x !== '')) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x !== '')) rows.push(row);
  return rows;
}

// Text cells that start with = + - @ can run as formulas in a spreadsheet; prefix a quote.
const guard = (v) => (/^[=+\-@\t\r]/.test(v) ? "'" + v : v);
export function toCsv(rows) {
  return rows.map((r) => r.map((v) => {
    const s = guard(String(v ?? ''));
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }).join(',')).join('\r\n') + '\r\n';
}

const HEADER_ALIASES = {
  name: ['product name', 'name', 'title', 'card name', 'card'],
  set: ['set name', 'set', 'expansion'],
  condition: ['condition'],
  finish: ['printing', 'finish', 'foil'],
  quantity: ['total quantity', 'quantity', 'qty', 'add to quantity'],
  price: ['tcg marketplace price', 'price', 'list price', 'your price'],
  location: ['location', 'bin', 'box'],
  market: ['tcg market price', 'market price', 'tcg market', 'market'],
  productId: ['tcgplayer id', 'tcg player id', 'tcgplayerid', 'product id', 'productid'],
};
const CONDITION_NAMES = { 'near mint': 'NM', nm: 'NM', 'lightly played': 'LP', lp: 'LP', 'moderately played': 'MP', mp: 'MP', 'heavily played': 'HP', hp: 'HP', damaged: 'DMG', dmg: 'DMG' };
const fold = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

function finishFrom(v) {
  const f = fold(v);
  if (!f || f === 'normal' || f === 'nonfoil' || f === 'non foil' || f === 'no') return 'nonfoil';
  if (f === 'foil' || f === 'yes') return 'foil';
  const dashed = f.replace(/ /g, '-');
  return FINISHES.includes(dashed) ? dashed : null;
}
const toCents = (v) => {
  const m = String(v ?? '').replace(/[$,\s]/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(m)) return undefined;
  return Math.round(parseFloat(m) * 100);
};

// printings: Printing[]. Rows that cannot be matched are returned in `unmatched`, never guessed.
export function importInventoryCsv(text, printings) {
  const rows = parseCsv(text);
  if (!rows.length) return { items: [], unmatched: [], problems: ['the file is empty'] };
  const header = rows[0].map(fold);
  const col = {};
  for (const [field, names] of Object.entries(HEADER_ALIASES)) {
    const i = header.findIndex((h) => names.includes(h));
    if (i >= 0) col[field] = i;
  }
  const problems = [];
  if (col.name === undefined) problems.push('no card name column found');
  if (col.quantity === undefined) problems.push('no quantity column found');
  if (problems.length) return { items: [], unmatched: [], problems };

  const byKey = new Map();
  for (const p of printings) {
    const k = fold(p.name) + '|' + fold(p.setName || p.setCode);
    if (!byKey.has(k)) byKey.set(k, p);
  }
  const items = [], unmatched = [];
  rows.slice(1).forEach((r, idx) => {
    const line = idx + 2;
    const name = r[col.name];
    const setText = col.set !== undefined ? r[col.set] : '';
    const p = byKey.get(fold(name) + '|' + fold(setText));
    const qty = Number(r[col.quantity]);
    const condition = col.condition !== undefined ? CONDITION_NAMES[fold(r[col.condition])] || (r[col.condition] === '' ? 'NM' : null) : 'NM';
    const finish = finishFrom(col.finish !== undefined ? r[col.finish] : '');
    if (!p || !Number.isInteger(qty) || qty < 0 || !CONDITIONS.includes(condition) || !finish || !p.finishes.includes(finish)) {
      unmatched.push({ line, name, reason: !p ? 'card not found in the card list' : 'quantity, condition or finish not understood' });
      return;
    }
    const item = { printingId: p.id, condition, finish, language: p.language, quantity: qty, source: 'import' };
    const price = col.price !== undefined ? toCents(r[col.price]) : undefined;
    if (price !== undefined) item.priceCents = price;
    if (col.location !== undefined && r[col.location]) item.location = r[col.location];
    items.push(item);
  });
  return { items, unmatched, problems };
}

const key = (i) => [i.printingId, i.condition, i.finish].join('|');
// Compare what the marketplace shows (`theirs`) with what we think we hold (`ours`).
export function diffInventory(ours, theirs) {
  const a = new Map(ours.filter((i) => i.quantity > 0).map((i) => [key(i), i]));
  const b = new Map(theirs.filter((i) => i.quantity > 0).map((i) => [key(i), i]));
  const onlyOurs = [], onlyTheirs = [], quantityDiffers = [], priceDiffers = [];
  for (const [k, i] of a) {
    const j = b.get(k);
    if (!j) { onlyOurs.push({ printingId: i.printingId, condition: i.condition, finish: i.finish, quantity: i.quantity }); continue; }
    if (i.quantity !== j.quantity) quantityDiffers.push({ printingId: i.printingId, condition: i.condition, finish: i.finish, ours: i.quantity, theirs: j.quantity });
    if (i.priceCents !== undefined && j.priceCents !== undefined && i.priceCents !== j.priceCents) priceDiffers.push({ printingId: i.printingId, condition: i.condition, finish: i.finish, ours: i.priceCents, theirs: j.priceCents });
  }
  for (const [k, j] of b) if (!a.has(k)) onlyTheirs.push({ printingId: j.printingId, condition: j.condition, finish: j.finish, quantity: j.quantity });
  return { onlyOurs, onlyTheirs, quantityDiffers, priceDiffers, inSync: !(onlyOurs.length || onlyTheirs.length || quantityDiffers.length || priceDiffers.length) };
}

const COND_LONG = { NM: 'Near Mint', LP: 'Lightly Played', MP: 'Moderately Played', HP: 'Heavily Played', DMG: 'Damaged' };
const usd = (c) => (c === undefined ? '' : (c / 100).toFixed(2));
// Draft CSV for another marketplace. UNVERIFIED column lists (see top of file).
export const TARGETS = {
  ebay: { columns: ['Title', 'Condition', 'Quantity', 'Price'], row: (p, i) => [`${p.name} ${p.setName || p.setCode} ${p.number}`.trim(), COND_LONG[i.condition], i.quantity, usd(i.priceCents)] },
  whatnot: { columns: ['Title', 'Quantity', 'Price', 'Condition'], row: (p, i) => [`${p.name} (${p.setName || p.setCode})`, i.quantity, usd(i.priceCents), COND_LONG[i.condition]] },
  manapool: { columns: ['Name', 'Set', 'Number', 'Condition', 'Finish', 'Quantity', 'Price'], row: (p, i) => [p.name, p.setCode, p.number, i.condition, i.finish, i.quantity, usd(i.priceCents)] },
};

// Items without a price are left out and listed, never given a made-up price.
export function exportInventoryCsv(target, inventory, printings) {
  const spec = TARGETS[target];
  if (!spec) throw new Error('unknown target ' + target);
  const byId = new Map(printings.map((p) => [p.id, p]));
  const rows = [spec.columns], skipped = [];
  for (const i of inventory) {
    const p = byId.get(i.printingId);
    if (i.quantity <= 0) continue;
    if (!p || i.priceCents === undefined) { skipped.push({ printingId: i.printingId, reason: p ? 'no price set' : 'unknown card' }); continue; }
    rows.push(spec.row(p, i));
  }
  return { csv: toCsv(rows), rows: rows.length - 1, skipped, columnsVerified: false };
}

// ---- Seller Portal export: column map, then "five things to fix" -------------------------------------------------
// Same idea as Scan's CSV check: say which header went to which field, what was not found, and what was ignored.
const FIELD_LABELS = { name: 'card name', set: 'set', condition: 'condition', finish: 'printing/finish', quantity: 'quantity', price: 'your price', market: 'market price', productId: 'product id', location: 'location' };
const REQUIRED = ['name', 'quantity'];

export function columnMap(headerCells) {
  const norm = headerCells.map(fold);
  const map = {}, used = new Set();
  for (const [field, names] of Object.entries(HEADER_ALIASES)) {
    const i = norm.findIndex((h) => names.includes(h));
    if (i >= 0) { map[field] = { index: i, header: String(headerCells[i]).slice(0, 60) }; used.add(i); }
  }
  const missing = Object.keys(FIELD_LABELS).filter((f) => !map[f]);
  const unused = headerCells.map((h, i) => (used.has(i) ? null : String(h).slice(0, 60))).filter(Boolean);
  const notes = [];
  for (const f of REQUIRED) if (!map[f]) notes.push(`No ${FIELD_LABELS[f]} column found, so I cannot read this file.`);
  if (!map.market) notes.push('There is no market price column, so I cannot check price drift. Add "TCG Market Price" to the export.');
  if (!map.price) notes.push('There is no price column, so I cannot check your prices.');
  if (unused.length) notes.push('Ignored columns: ' + unused.join(', ') + '.');
  return { map, missing, unused, notes, ok: REQUIRED.every((f) => map[f]) };
}

const money = (c) => '$' + (c / 100).toFixed(2);

// text: the pasted or dropped export. printings: Printing[]. Everything returned is a SUGGESTION; nothing is applied.
//   opts.rule         price rule used for new prices (default: 5% under market, ends in .99)
//   opts.threshold    "low" means this many or fewer
//   opts.soldByName   Map(card name -> units sold recently), makes the low-stock list sold-first
//   opts.overPct / underPct   how far from market counts as drift (default 15% over, 20% under)
export function analyzeExport(text, printings, { rule, threshold = 2, soldByName = new Map(), overPct = 15, underPct = 20, maxRows = 20000 } = {}) {
  const rows = parseCsv(text);
  if (!rows.length) return { ok: false, problems: ['the file is empty'], fixes: [] };
  const cm = columnMap(rows[0]);
  if (!cm.ok) return { ok: false, problems: cm.notes, columns: cm, fixes: [] };
  if (rows.length - 1 > maxRows) return { ok: false, problems: ['too many rows (limit ' + maxRows + ')'], columns: cm, fixes: [] };

  const byKey = new Map();
  for (const p of printings) { const k = fold(p.name) + '|' + fold(p.setName || p.setCode); if (!byKey.has(k)) byKey.set(k, p); }
  const col = (r, f) => (cm.map[f] ? r[cm.map[f].index] : undefined);
  const parsed = [], unmatched = [], seen = new Map(), duplicates = [];
  let blankPrice = 0;
  rows.slice(1).forEach((r, idx) => {
    const line = idx + 2;
    const p = byKey.get(fold(col(r, 'name')) + '|' + fold(col(r, 'set') ?? ''));
    const qty = Number(col(r, 'quantity'));
    // TCGplayer-style labels can end in "Foil" ("Near Mint Foil"): read that as the condition plus a foil finish
    const condText = cm.map.condition ? fold(col(r, 'condition')) : 'near mint';
    const foilInCondition = / foil$/.test(condText);
    const cond = condText === '' ? 'NM' : CONDITION_NAMES[condText.replace(/ foil$/, '')] || null;
    const finish = foilInCondition ? 'foil' : finishFrom(cm.map.finish ? col(r, 'finish') : '');
    if (!p || !Number.isInteger(qty) || qty < 0 || !CONDITIONS.includes(cond) || !finish || !p.finishes.includes(finish)) { unmatched.push({ line, name: col(r, 'name'), reason: !p ? 'card not found in the card list' : 'quantity, condition or finish not understood' }); return; }
    const price = cm.map.price ? toCents(col(r, 'price')) : undefined;
    const market = cm.map.market ? toCents(col(r, 'market')) : undefined;
    if (cm.map.price && (price === undefined || price === 0)) blankPrice += 1;
    const key = [p.id, cond, finish].join('|');
    if (seen.has(key)) { duplicates.push({ line, firstLine: seen.get(key), name: p.name }); return; }
    seen.set(key, line);
    parsed.push({ line, printing: p, condition: cond, finish, quantity: qty, priceCents: price, marketCents: market });
  });

  const useRule = rule || { id: 'sync-default', name: '5% under market', basis: 'market', percent: -5, floorCents: 25, minListCents: 25, rounding: 'ends-99' };
  const over = [], under = [];
  for (const r of parsed) {
    if (!r.priceCents || !r.marketCents || r.quantity === 0) continue;
    const pct = ((r.priceCents - r.marketCents) / r.marketCents) * 100;
    if (pct < overPct && pct > -underPct) continue;
    const synthetic = { prices: { byFinish: { [r.finish]: { market: r.marketCents } } } };
    const out = applyPriceRule(useRule, synthetic, { condition: r.condition, finish: r.finish });
    if (out.status !== 'priced' || out.priceCents === r.priceCents) continue;
    const row = { printingId: r.printing.id, name: r.printing.name, condition: r.condition, finish: r.finish, quantity: r.quantity, priceCents: r.priceCents, marketCents: r.marketCents, driftPct: Math.round(pct * 10) / 10, newPriceCents: out.priceCents };
    (pct > 0 ? over : under).push(row);
  }
  const atStake = (list) => list.reduce((s, x) => s + Math.abs(x.priceCents - x.newPriceCents) * x.quantity, 0);
  const worst = (list) => [...list].sort((a, b) => Math.abs(b.priceCents - b.newPriceCents) * b.quantity - Math.abs(a.priceCents - a.newPriceCents) * a.quantity);
  const low = parsed.filter((r) => r.quantity <= threshold).map((r) => ({ name: r.printing.name, finish: r.finish, quantity: r.quantity, soldRecently: soldByName.get(r.printing.name) || 0 }))
    .sort((a, b) => b.soldRecently - a.soldRecently || a.quantity - b.quantity || a.name.localeCompare(b.name));
  const lowSelling = low.filter((x) => x.soldRecently > 0);

  const fixes = [];
  const change = (x) => ({ printingId: x.printingId, condition: x.condition, finish: x.finish, priceCents: x.newPriceCents });
  if (over.length) fixes.push({ id: 'overpriced', kind: 'price-drift', score: atStake(over), title: `Lower ${over.length} cards priced well above market`, why: `${over.length} cards are listed 15% or more over market; the biggest is ${worst(over)[0].name} at ${money(worst(over)[0].priceCents)} against ${money(worst(over)[0].marketCents)} market. Overpriced cards sit unsold.`, action: { tool: 'inventory.setPrices', args: { changes: worst(over).slice(0, 100).map(change) } } });
  if (under.length) fixes.push({ id: 'underpriced', kind: 'price-drift', score: atStake(under), title: `Raise ${under.length} cards priced well below market`, why: `${under.length} cards are listed 20% or more under market; the biggest gap is ${worst(under)[0].name} at ${money(worst(under)[0].priceCents)} against ${money(worst(under)[0].marketCents)} market. That is money left on the table.`, action: { tool: 'inventory.setPrices', args: { changes: worst(under).slice(0, 100).map(change) } } });
  if (low.length) fixes.push({ id: 'low-stock', kind: 'low-stock', score: lowSelling.length ? lowSelling.reduce((s, x) => s + x.soldRecently * 100, 0) : low.length * 50, title: `Restock ${lowSelling.length || low.length} cards that are low`, why: lowSelling.length ? `${lowSelling.length} cards with ${threshold} or fewer left sold recently; ${lowSelling[0].name} sold ${lowSelling[0].soldRecently}.` : `${low.length} cards have ${threshold} or fewer left (no recent sales data given).`, action: null });
  if (duplicates.length) fixes.push({ id: 'duplicates', kind: 'tidy', score: 0, title: `Merge ${duplicates.length} duplicate rows`, why: `${duplicates.length} rows repeat a card, condition and finish already listed (first at line ${duplicates[0].firstLine}). Only the first row of each was counted.`, action: null });
  if (unmatched.length) fixes.push({ id: 'unmatched', kind: 'tidy', score: 0, title: `Check ${unmatched.length} rows I could not read`, why: `${unmatched.length} rows did not match a known card or had an unreadable quantity, condition or finish.`, action: null });
  if (blankPrice) fixes.push({ id: 'blank-price', kind: 'tidy', score: 0, title: `Fill in ${blankPrice} missing prices`, why: `${blankPrice} rows have no price or a price of zero.`, action: null });
  if (!cm.map.market) fixes.push({ id: 'no-market', kind: 'tidy', score: 0, title: 'Add the market price column', why: 'Without it I cannot check whether your prices have drifted.', action: null });
  const kindOrder = { 'price-drift': 0, 'low-stock': 1, tidy: 2 };
  fixes.sort((a, b) => b.score - a.score || kindOrder[a.kind] - kindOrder[b.kind] || a.id.localeCompare(b.id));

  return {
    ok: true,
    columns: cm,
    rows: parsed.length,
    units: parsed.reduce((s, r) => s + r.quantity, 0),
    lowStock: low.slice(0, 20),
    drift: { over: worst(over).slice(0, 10), under: worst(under).slice(0, 10), overCount: over.length, underCount: under.length },
    unmatched: unmatched.slice(0, 20),
    duplicates: duplicates.slice(0, 20),
    fixes: fixes.slice(0, 5).map((f, i) => ({ rank: i + 1, ...f })),
    applied: false,
  };
}
