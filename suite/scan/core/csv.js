// CSV for TCGplayer's Seller Portal import. The column map lives in csv-format.js (unverified until a real export arrives).
import { formatUsd } from '../../shared/models.js';
import { FORMAT, FORMATS, RULES, DEFAULT_FORMAT_KEY, getFormat, conditionLabel, checkHeader, splitHeader } from './csv-format.js';

export { FORMAT, FORMATS, RULES, DEFAULT_FORMAT_KEY, getFormat, conditionLabel, checkHeader, splitHeader };

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
// The product id comes from the printing (known source) or from the draft (typed by the seller).
// Returns { csv, listed, cards, missingId[], missingPrice[] }. Rows we cannot place are never guessed.
// options.format: a format key ('tcgplayer-add' (default), 'tcgplayer-set', 'manapool') or a format object.
export function buildCsv(drafts, getPrinting, { format: wanted = FORMAT } = {}) {
  const format = getFormat(wanted);
  const lines = [format.columns.map((c) => escapeCell(c.header)).join(',')];
  const missingId = [];
  const missingPrice = [];
  let listed = 0;
  let cards = 0;
  for (const d of drafts) {
    const printing = getPrinting(d.printingId);
    const productId = d.tcgplayerProductId || (printing && printing.tcgplayerProductId);
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
  return { csv: lines.join('\r\n') + '\r\n', listed, cards, missingId, missingPrice, formatVerified: format.verified, formatKey: format.key };
}

export { formatUsd };
