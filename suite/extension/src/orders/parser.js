// Reads the TCGplayer order/shipping export (the same CSV the Shipper takes) ON THIS DEVICE and turns each
// row into an Order (docs/suite/DATA-MODEL.md). Nothing is sent anywhere. The column names below are what the
// Shipper's own sample file uses; real exports have not been checked (unverified), so headers are matched
// loosely and the first screen after import says what was found.
//
// This module is one implementation of a small interface (see index.js): any parser with
//   parse(text) -> { ok, orders, skipped: [{ row, reason }], rows, error? }
// can replace it (the Agent session is writing a faster one).
import { dollarsToCents, validateOrder } from '../vendor/shared/models.js';
import { buyerKeyFor } from '../adapters/index.js';

export const MAX_BYTES = 10 * 1024 * 1024;
export const MAX_ROWS = 20000;

// RFC 4180-ish: quotes, doubled quotes, CRLF or LF, a leading BOM. One pass, no regex per cell.
export function readCsvRows(text) {
  const rows = [];
  let row = [], cell = '', quoted = false, i = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  for (; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else quoted = false; } else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
      if (rows.length > MAX_ROWS + 1) break;
    } else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); if (row.length > 1 || row[0] !== '') rows.push(row); }
  return rows;
}

const norm = (h) => String(h).toLowerCase().replace(/[^a-z0-9#]/g, '');
const WANT = {
  orderNumber: ['order#', 'ordernumber', 'orderid', 'orderno'],
  firstName: ['firstname', 'first'],
  lastName: ['lastname', 'last'],
  fullName: ['name', 'shiptoname', 'recipient', 'buyername', 'buyer'],
  address1: ['address1', 'addressline1', 'address', 'street', 'shiptoaddress1'],
  address2: ['address2', 'addressline2', 'shiptoaddress2'],
  city: ['city', 'shiptocity'],
  state: ['state', 'province', 'shiptostate', 'stateprovince'],
  postalCode: ['postalcode', 'zip', 'zipcode', 'postcode', 'shiptozip'],
  country: ['country', 'shiptocountry'],
  orderDate: ['orderdate', 'date', 'orderedat', 'createdat'],
  itemCount: ['itemcount', 'items', 'quantity', 'qty', 'numberofitems'],
  value: ['valueofproducts', 'productvalue', 'ordervalue', 'subtotal', 'itemstotal', 'ordertotal', 'producttotal'],
  shippingPaid: ['shippingfeepaid', 'shippingpaid', 'shippingfee', 'shipping'],
  tracking: ['tracking#', 'trackingnumber', 'tracking'],
  carrier: ['carrier']
};

export function mapColumns(headers) {
  const n = headers.map(norm);
  const cols = {};
  for (const [key, names] of Object.entries(WANT)) {
    cols[key] = -1;
    for (const want of names) { const at = n.indexOf(want); if (at !== -1) { cols[key] = at; break; } }
  }
  return cols;
}

export function parseDate(s) {
  const t = String(s ?? '').trim();
  let m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+\d{1,2}:\d{2}(?::\d{2})?(?:\s*[AaPp][Mm])?)?$/.exec(t);
  let y, mo, d;
  if (m) { mo = +m[1]; d = +m[2]; y = +m[3]; }
  else if ((m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/.exec(t))) { y = +m[1]; mo = +m[2]; d = +m[3]; }
  else return null;
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || y < 2000 || y > 2100) return null;
  const date = new Date(Date.UTC(y, mo - 1, d, 12));
  return date.getUTCMonth() === mo - 1 && date.getUTCDate() === d ? date.toISOString().replace(/\.\d+Z$/, 'Z') : null;
}

const money = (s) => {
  const t = String(s ?? '').trim();
  if (t === '') return 0;
  const c = dollarsToCents(t);
  return Number.isFinite(c) && c >= 0 && c < 1e9 ? c : NaN;
};

export function parseOrderExport(text) {
  if (typeof text !== 'string' || text.trim() === '') return { ok: false, error: 'That file is empty.', orders: [], skipped: [], rows: 0 };
  if (text.length > MAX_BYTES) return { ok: false, error: 'That file is too big (over 10 MB). Is it the order export?', orders: [], skipped: [], rows: 0 };
  const rows = readCsvRows(text);
  if (rows.length < 2) return { ok: false, error: 'The file needs a header row and at least one order.', orders: [], skipped: [], rows: 0 };
  if (rows.length - 1 > MAX_ROWS) return { ok: false, error: `That file has more than ${MAX_ROWS.toLocaleString('en-US')} orders. Split it and import the newest part.`, orders: [], skipped: [], rows: rows.length - 1 };
  const cols = mapColumns(rows[0]);
  const hasName = cols.fullName !== -1 || (cols.firstName !== -1 && cols.lastName !== -1);
  if (!hasName || cols.address1 === -1 || cols.orderDate === -1) {
    return { ok: false, error: 'I could not find the buyer name, address and order date columns. Is this the TCGplayer order (shipping) export, not the pull sheet? Columns I found: ' + rows[0].filter(Boolean).slice(0, 12).join(', '), orders: [], skipped: [], rows: rows.length - 1 };
  }
  const orders = [];
  const skipped = [];
  const seen = new Set();
  for (let r = 1; r < rows.length; r++) {
    const cells = rows[r];
    const get = (k) => (cols[k] === -1 || cols[k] >= cells.length ? '' : (cells[cols[k]] || '').trim());
    const rowNo = r + 1;
    const name = cols.firstName !== -1 && cols.lastName !== -1 ? `${get('firstName')} ${get('lastName')}`.trim() : get('fullName');
    const id = get('orderNumber') || `row-${rowNo}`;
    if (seen.has(id)) { skipped.push({ row: rowNo, reason: 'order number appears twice' }); continue; }
    const orderedAt = parseDate(get('orderDate'));
    if (!orderedAt) { skipped.push({ row: rowNo, reason: 'unreadable order date' }); continue; }
    const valueCents = money(get('value'));
    const shippingPaidCents = money(get('shippingPaid'));
    if (Number.isNaN(valueCents) || Number.isNaN(shippingPaidCents)) { skipped.push({ row: rowNo, reason: 'unreadable amount' }); continue; }
    const count = Math.max(1, Number.parseInt(get('itemCount'), 10) || 1);
    const tracking = get('tracking');
    const order = {
      id, source: 'tcgplayer', orderedAt, status: tracking ? 'shipped' : 'paid',
      buyerKey: buyerKeyFor(name, get('postalCode')),
      shipTo: { name, address1: get('address1'), ...(get('address2') ? { address2: get('address2') } : {}), city: get('city'), state: get('state').toUpperCase(), postalCode: get('postalCode'), country: get('country') || 'US' },
      items: [{ name: 'Items in this order (not listed in the file)', quantity: count, priceCents: Math.floor(valueCents / count) }],
      itemsTotalCents: valueCents, shippingPaidCents
    };
    if (tracking) { order.trackingNumber = tracking; if (get('carrier')) order.carrier = get('carrier'); }
    const check = validateOrder(order);
    if (!check.ok) { skipped.push({ row: rowNo, reason: 'missing ' + check.errors[0].split(' ')[0] }); continue; }
    seen.add(id);
    orders.push(order);
  }
  if (!orders.length) return { ok: false, error: 'I could not read any order in that file. First problem: ' + (skipped[0] ? `row ${skipped[0].row}, ${skipped[0].reason}` : 'none found') + '.', orders: [], skipped, rows: rows.length - 1 };
  return { ok: true, orders, skipped, rows: rows.length - 1, columns: Object.entries(cols).filter(([, v]) => v !== -1).map(([k]) => k) };
}
