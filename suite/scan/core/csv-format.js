// THE ONE PLACE that says which columns the TCGplayer import file has. UNVERIFIED until the owner supplies a real
// export (board task S4). When that arrives: change `columns` below (header text, order, what goes in each cell),
// set `verified: true`, run the tests. Nothing else in the app knows a header name.
//   Help article: https://help.tcgplayer.com/hc/en-us/articles/115002358027
const CONDITION_NAMES = { NM: 'Near Mint', LP: 'Lightly Played', MP: 'Moderately Played', HP: 'Heavily Played', DMG: 'Damaged' };
const FOIL_LIKE = new Set(['foil', 'etched', 'holo', 'reverse-holo']);

export function conditionLabel(condition, finish) {
  const base = CONDITION_NAMES[condition] || condition;
  return FOIL_LIKE.has(finish) ? base + ' Foil' : base;
}

export const FORMAT = {
  verified: false,
  note: 'Column names are from a third-party importer, not from a real TCGplayer export.',
  // row = { productId, condition, finish, quantity, priceCents }
  columns: [
    { header: 'TCGPlayer Id', verified: false, value: (r) => String(r.productId) },
    { header: 'Condition', verified: false, value: (r) => conditionLabel(r.condition, r.finish) },
    { header: 'Total Quantity', verified: false, value: (r) => String(r.quantity) },
    { header: 'TCG Marketplace Price', verified: false, value: (r) => (r.priceCents / 100).toFixed(2) },
  ],
};

// Split one CSV line into cells (handles quotes).
export function splitHeader(line) {
  const out = []; let cur = ''; let q = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (q) { if (ch === '"' && line[i + 1] === '"') { cur += '"'; i += 1; } else if (ch === '"') q = false; else cur += ch; }
    else if (ch === '"') q = true;
    else if (ch === ',') { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}
const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');

// Compare the header line from a real TCGplayer export with the columns we write. Plain-language result.
export function checkHeader(headerLine, format = FORMAT) {
  const theirs = splitHeader(String(headerLine || '').replace(/^﻿/, '').split(/\r?\n/)[0]).filter(Boolean);
  if (!theirs.length) return { ok: false, notes: ['Paste the first line of a real TCGplayer export (the column names).'], missing: [], unused: [], spelling: [] };
  const byNorm = new Map(theirs.map((h) => [norm(h), h]));
  const ours = format.columns.map((c) => c.header);
  const missing = []; const spelling = [];
  for (const h of ours) {
    const hit = byNorm.get(norm(h));
    if (!hit) missing.push(h);
    else if (hit !== h) spelling.push({ ours: h, theirs: hit });
  }
  const ourNorm = new Set(ours.map(norm));
  const unused = theirs.filter((h) => !ourNorm.has(norm(h)));
  const notes = [];
  if (!missing.length && !spelling.length) notes.push('Every column we write exists in your export, with the same spelling.');
  for (const m of missing) notes.push('We write a column called "' + m + '" but your export has no column with that name. Change its header in core/csv-format.js (or drop it).');
  for (const s of spelling) notes.push('Spelling differs: we write "' + s.ours + '", your export says "' + s.theirs + '".');
  if (unused.length) notes.push('Your export also has: ' + unused.join(', ') + '. We do not write these.');
  return { ok: !missing.length && !spelling.length, missing, spelling, unused, notes };
}
