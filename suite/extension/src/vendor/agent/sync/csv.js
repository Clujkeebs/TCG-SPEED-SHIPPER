// A2: read an inventory CSV into InventoryItems, compare two inventories, write export CSVs.
// COLUMN NAMES ARE UNVERIFIED. They come from common spreadsheet conventions, not from a real file
// from TCGplayer, eBay, Whatnot or Mana Pool. Header matching is forgiving on purpose. When the owner
// supplies real exports, change HEADER_ALIASES and TARGETS below, nothing else.
import { CONDITIONS, FINISHES } from '../../shared/models.js';

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
