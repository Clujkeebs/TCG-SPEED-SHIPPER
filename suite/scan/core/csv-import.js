// Read back a CSV written by this app so a list can be continued later. Columns are found by the names in csv-format.js
// (not by position), so a changed format keeps working. A text cell that was protected with a leading ' is restored.
import { FORMAT } from './csv-format.js';

// Plain CSV reader: quotes, doubled quotes, commas and line breaks inside quotes, CRLF or LF, a leading BOM.
export function parseCsv(text) {
  const rows = []; let row = []; let cur = ''; let q = false;
  const s = String(text ?? '').replace(/^﻿/, '');
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i];
    if (q) { if (ch === '"' && s[i + 1] === '"') { cur += '"'; i += 1; } else if (ch === '"') q = false; else cur += ch; }
    else if (ch === '"') q = true;
    else if (ch === ',') { row.push(cur); cur = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && s[i + 1] === '\n') i += 1; row.push(cur); cur = ''; if (row.some((c) => c !== '')) rows.push(row); row = []; }
    else cur += ch;
  }
  row.push(cur); if (row.some((c) => c !== '')) rows.push(row);
  return rows;
}

const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '');
const NAMES = { 'near mint': 'NM', 'lightly played': 'LP', 'moderately played': 'MP', 'heavily played': 'HP', damaged: 'DMG' };

// "Near Mint Foil" -> { condition: 'NM', foil: true }
export function conditionFromLabel(label) {
  const t = String(label || '').replace(/^'/, '').trim().toLowerCase();
  const foil = /\bfoil$/.test(t);
  const base = t.replace(/\s*foil$/, '');
  return NAMES[base] ? { condition: NAMES[base], foil } : null;
}

// Returns { rows: [{ productId, condition, foil, quantity, priceCents }], problems: [plain sentences] }.
export function readOurCsv(text, format = FORMAT) {
  const table = parseCsv(text);
  const out = { rows: [], problems: [] };
  if (!table.length) { out.problems.push('The file is empty.'); return out; }
  const head = table[0].map(norm);
  const col = (header) => head.indexOf(norm(header));
  const idCol = col('TCGPlayer Id'); const qtyCol = col('Total Quantity'); const priceCol = col('TCG Marketplace Price'); const condCol = col('Condition');
  const need = [['TCGPlayer Id', idCol], ['Total Quantity', qtyCol], ['TCG Marketplace Price', priceCol]].filter(([, i]) => i < 0).map(([n]) => n);
  if (need.length) { out.problems.push('This does not look like a file from Speed Scan. Missing column: ' + need.join(', ') + '.'); return out; }
  table.slice(1).forEach((cells, i) => {
    const n = i + 2; // spreadsheet line number
    const productId = Number(String(cells[idCol] ?? '').replace(/^'/, '').trim());
    const quantity = Number(String(cells[qtyCol] ?? '').trim());
    const price = Number(String(cells[priceCol] ?? '').replace(/[$,\s]/g, ''));
    const cond = condCol >= 0 ? conditionFromLabel(cells[condCol]) : { condition: 'NM', foil: false };
    if (!Number.isInteger(productId) || productId < 1) return out.problems.push('Line ' + n + ': no TCGplayer product id, skipped.');
    if (!Number.isInteger(quantity) || quantity < 1) return out.problems.push('Line ' + n + ': quantity is not a whole number of 1 or more, skipped.');
    if (!Number.isFinite(price) || price < 0) return out.problems.push('Line ' + n + ': price is not a number, skipped.');
    if (!cond) return out.problems.push('Line ' + n + ': condition "' + cells[condCol] + '" is not one we know, skipped.');
    out.rows.push({ productId, condition: cond.condition, foil: cond.foil, quantity, priceCents: Math.round(price * 100) });
  });
  return out;
}
