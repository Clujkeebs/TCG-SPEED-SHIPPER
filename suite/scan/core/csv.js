// CSV for TCGplayer's Seller Portal import.
//
// UNVERIFIED FORMAT. The columns below come from a third-party importer's description, not from a
// real export. Until the owner supplies a real export file, treat the output as a draft. The
// "Condition" column is a guess on top of that. Edit FORMAT only; nothing else knows the headers.
//   Help article: https://help.tcgplayer.com/hc/en-us/articles/115002358027
import { formatUsd } from '../../shared/models.js';

const CONDITION_NAMES = {
  NM: 'Near Mint', LP: 'Lightly Played', MP: 'Moderately Played', HP: 'Heavily Played', DMG: 'Damaged',
};
const FOIL_LIKE = new Set(['foil', 'etched', 'holo', 'reverse-holo']);

export function conditionLabel(condition, finish) {
  const base = CONDITION_NAMES[condition] || condition;
  return FOIL_LIKE.has(finish) ? base + ' Foil' : base;
}

export const FORMAT = {
  verified: false,
  note: 'Column names are from a third-party importer, not from a real TCGplayer export.',
  columns: [
    { header: 'TCGPlayer Id', verified: false, value: (r) => String(r.productId) },
    { header: 'Condition', verified: false, value: (r) => conditionLabel(r.condition, r.finish) },
    { header: 'Total Quantity', verified: false, value: (r) => String(r.quantity) },
    { header: 'TCG Marketplace Price', verified: false, value: (r) => (r.priceCents / 100).toFixed(2) },
  ],
};

// Spreadsheets run text that starts with = + - @ (or a tab/return) as a formula. Neutralise it.
export function safeText(value) {
  const s = String(value ?? '');
  return /^[=+\-@\t\r]/.test(s) ? "'" + s : s;
}

export function escapeCell(value) {
  const s = safeText(value);
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

// drafts: ListingDraft[]. getPrinting(id) -> Printing | undefined.
// productIds: optional { printingId: number } typed in by the seller for printings we do not know.
// Returns { csv, listed, cards, missingId[], missingPrice[] }. Rows we cannot place are never guessed.
export function buildCsv(drafts, getPrinting, { productIds = {}, format = FORMAT } = {}) {
  const lines = [format.columns.map((c) => escapeCell(c.header)).join(',')];
  const missingId = [];
  const missingPrice = [];
  let listed = 0;
  let cards = 0;
  for (const d of drafts) {
    const printing = getPrinting(d.printingId);
    const productId = (printing && printing.tcgplayerProductId) || productIds[d.printingId];
    const label = printing ? printing.name + ' (' + printing.setCode + ' ' + printing.number + ')' : d.printingId;
    if (!Number.isInteger(productId) || productId <= 0) {
      missingId.push({ draftId: d.id, printingId: d.printingId, label, quantity: d.quantity });
      continue;
    }
    if (!Number.isInteger(d.priceCents) || d.priceCents < 1) {
      missingPrice.push({ draftId: d.id, printingId: d.printingId, label, quantity: d.quantity });
      continue;
    }
    const row = { productId, condition: d.condition, finish: d.finish, quantity: d.quantity, priceCents: d.priceCents };
    lines.push(format.columns.map((c) => escapeCell(c.value(row))).join(','));
    listed += 1;
    cards += d.quantity;
  }
  return { csv: lines.join('\r\n') + '\r\n', listed, cards, missingId, missingPrice, formatVerified: format.verified };
}

export { formatUsd };
