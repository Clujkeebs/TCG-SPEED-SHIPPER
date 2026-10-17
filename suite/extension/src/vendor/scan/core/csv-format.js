// THE ONE PLACE that says which columns the import files have (TCGplayer "add", TCGplayer "set", Mana Pool).
// UNVERIFIED against a real export until the owner supplies one (board task S4). When that arrives: change the
// `columns` below (header text, order, what goes in each cell), update RULES, run the tests. Nothing else in the
// app knows a header name. Each column carries `verified` = confirmed from a source (see RULES), not from a real file.
//   Help article: https://help.tcgplayer.com/hc/en-us/articles/115002358027
const CONDITION_NAMES = { NM: 'Near Mint', LP: 'Lightly Played', MP: 'Moderately Played', HP: 'Heavily Played', DMG: 'Damaged' };
const FOIL_LIKE = new Set(['foil', 'etched', 'holo', 'reverse-holo']);

export function conditionLabel(condition, finish) {
  const base = CONDITION_NAMES[condition] || condition;
  return FOIL_LIKE.has(finish) ? base + ' Foil' : base;
}

// ---- What we know and do not know about the files (kept here so it travels with the code) --------------------------
// VERIFIED FROM A SOURCE means: read in a help article or support page as quoted by a search result (our build sandbox
// cannot open tcgplayer.com or manapool.com). Nothing here has been checked against a REAL export file yet (board task S4).
export const RULES = {
  verifiedFromSource: [
    'TCGplayer\u2019s export has both "Total Quantity" (the seller\u2019s current count) and "Add to Quantity" (a whole number; a positive number adds to the stock). Source: TCGplayer help, "Importing and Exporting CSVs to Mass Update Prices and Quantities" (via search).',
    '"TCG Marketplace Price" is required on import. Same article.',
    'The Pricing tab imports into Staged inventory first, before anything goes live. Same article.',
    'Mana Pool reads the columns "TCGPlayer Id", "Total Quantity" and "TCG Marketplace Price", ignores "Add to Quantity", and has its own Add / Update choice. Source: Mana Pool support article (via search).',
  ],
  unverified: [
    'Exact header spelling and capital letters on TCGplayer\u2019s side ("TCGplayer Id" is what we write there; Mana Pool\u2019s article spells it "TCGPlayer Id").',
    'Whether TCGplayer accepts a file with "Add to Quantity" and NO "Total Quantity" column, and what an empty "Total Quantity" would do.',
    'The "Condition" column: its name, the words ("Near Mint", "Near Mint Foil") and whether extra columns are ignored.',
    'How TCGplayer picks the condition and finish for a product id.',
    'A conflicting older note in PLAN.md says imports never overwrite quantities; a later reading says "Total Quantity" may set them. Treat "Set my stock" as able to LOWER counts.',
  ],
  firstImportAdvice: 'The first time you import any new file, use just 3 cards, into Staged inventory, and check them before anything goes live.',
};

const CONDITION_COLUMN = { header: 'Condition', verified: false, value: (r) => conditionLabel(r.condition, r.finish) };
const priceColumn = { header: 'TCG Marketplace Price', verified: true, value: (r) => (r.priceCents / 100).toFixed(2) };
const idColumn = (header) => ({ header, verified: false, value: (r) => String(r.productId) });
const countColumn = (header, verified) => ({ header, verified, value: (r) => String(r.quantity) });

// row = { productId, condition, finish, quantity, priceCents }
export const FORMATS = {
  'tcgplayer-add': {
    key: 'tcgplayer-add', site: 'TCGplayer', verified: false,
    label: 'Add these cards to my stock (recommended)',
    explain: 'For TCGplayer. The count goes in "Add to Quantity", so your existing stock goes UP by these cards. There is no "Total Quantity" column, so nothing can be set lower.',
    warning: '',
    note: 'Writes "Add to Quantity" only. Whether TCGplayer takes a file without "Total Quantity" is unverified.',
    columns: [idColumn('TCGplayer Id'), CONDITION_COLUMN, countColumn('Add to Quantity', true), priceColumn],
  },
  'tcgplayer-set': {
    key: 'tcgplayer-set', site: 'TCGplayer', verified: false,
    label: 'Set my stock to exactly these counts',
    explain: 'For TCGplayer. The count goes in "Total Quantity", which is your stock for the card.',
    warning: 'Careful: this SETS your stock. If you own 20 of a card and the file says 1, TCGplayer may change 20 to 1. Only use it for a card you have counted completely.',
    note: 'Writes "Total Quantity" only. Its effect on existing stock is unverified; assume it can lower counts.',
    columns: [idColumn('TCGplayer Id'), CONDITION_COLUMN, countColumn('Total Quantity', true), priceColumn],
  },
  manapool: {
    key: 'manapool', site: 'Mana Pool', verified: false,
    label: 'Mana Pool file',
    explain: 'For Mana Pool\u2019s importer, which reads these columns from a TCGplayer-style file and has its own Add / Update choice when you import.',
    warning: '',
    note: 'Columns as Mana Pool\u2019s support article names them. Condition handling there is unverified.',
    columns: [idColumn('TCGPlayer Id'), CONDITION_COLUMN, countColumn('Total Quantity', true), priceColumn],
  },
};
export const DEFAULT_FORMAT_KEY = 'tcgplayer-add';
export const FORMAT = FORMATS[DEFAULT_FORMAT_KEY]; // the default; the Extension reads this
export const getFormat = (key) => (typeof key === 'object' && key && key.columns ? key : FORMATS[key] || FORMAT);

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
