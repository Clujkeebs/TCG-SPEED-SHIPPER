// Order-file insights: read the TCGplayer shipping/order export the way the Shipper does (same column names, see
// public/js/shipper-core.js and test/csv-parser.test.js) and answer plain questions about the seller's business.
// No model, no network. Built to stay small and fast on big files:
//   - createCsvParser is a STREAMING parser: feed it chunks, it calls back one row at a time (quotes, "" and CRLF can
//     be split across chunks)
//   - createOrderAggregator keeps counters and one small record per buyer, never the rows
// Privacy: summaries never hold a buyer's name. Buyers are keys; names live in a separate on-device table
// (first name + initial only) and are put into text by fillBuyerNames().
const DAY = 86400000;
export const LIMITS = { maxFieldChars: 20000, maxCells: 200, maxRows: 500000, maxBuyers: 200000 };

// ---- streaming CSV parser ----------------------------------------------------------------------------------------
export function createCsvParser(onRow, { maxFieldChars = LIMITS.maxFieldChars, maxCells = LIMITS.maxCells } = {}) {
  let field = '', row = [], inQuote = false, quotePending = false, skipLF = false, first = true, lineNo = 1;
  const endField = () => { if (row.length >= maxCells) throw new Error(`line ${lineNo}: too many columns`); row.push(field); field = ''; };
  const endRow = () => {
    endField();
    if (row.length > 1 || row[0] !== '') onRow(row, lineNo);
    row = []; lineNo += 1;
  };
  function step(ch) {
    if (skipLF) { skipLF = false; if (ch === '\n') return; }
    if (inQuote) {
      if (quotePending) {
        quotePending = false;
        if (ch === '"') { field += '"'; return; }
        inQuote = false; // that quote closed the field; handle ch below
      } else if (ch === '"') { quotePending = true; return; }
      else { field += ch; if (field.length > maxFieldChars) throw new Error(`line ${lineNo}: a cell is too long`); return; }
    }
    if (ch === '"' && field === '') { inQuote = true; return; }
    if (ch === ',') { endField(); return; }
    if (ch === '\n') { endRow(); return; }
    if (ch === '\r') { endRow(); skipLF = true; return; }
    field += ch;
    if (field.length > maxFieldChars) throw new Error(`line ${lineNo}: a cell is too long`);
  }
  return {
    push(chunk) {
      let s = String(chunk);
      if (first && s.length) { first = false; if (s.charCodeAt(0) === 0xfeff) s = s.slice(1); }
      for (let i = 0; i < s.length; i += 1) step(s[i]);
    },
    end() {
      if (quotePending) { inQuote = false; quotePending = false; }
      if (field !== '' || row.length) endRow();
    },
  };
}

// ---- columns, money, dates ---------------------------------------------------------------------------------------
const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
const ALIASES = {
  order: ['order', 'ordernumber', 'orderid'],
  first: ['firstname'], last: ['lastname'], name: ['buyername', 'name', 'recipient', 'shipto', 'customername'],
  address1: ['address1', 'address'], state: ['state', 'province', 'region'],
  zip: ['postalcode', 'zip', 'zipcode', 'postcode'],
  date: ['orderdate', 'purchasedate', 'date'],
  value: ['valueofproducts', 'productvalue', 'ordervalue', 'subtotal', 'itemtotal'],
  shipFee: ['shippingfeepaid', 'shippingfee', 'shippingpaid'],
  items: ['itemcount', 'items'], quantity: ['quantity'], method: ['shippingmethod', 'method'],
  tracking: ['tracking', 'trackingnumber'],
};
export function mapColumns(header) {
  const h = header.map(norm), map = {};
  for (const [field, names] of Object.entries(ALIASES)) { const i = h.findIndex((x) => names.includes(x)); if (i >= 0) map[field] = i; }
  return map;
}
export function parseMoney(v) {
  const m = String(v ?? '').replace(/[$,\s]/g, '');
  return /^\d+(\.\d{1,2})?$/.test(m) ? Math.round(parseFloat(m) * 100) : undefined;
}
// Returns { ms, hasTime } in UTC (the export does not say a time zone), or undefined.
export function parseDate(v) {
  const s = String(v ?? '').trim();
  let y, mo, d, h = 0, mi = 0, hasTime = false, m;
  if ((m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ T]+(\d{1,2}):(\d{2})(?::\d{2})?\s*([AaPp][Mm])?)?$/.exec(s))) {
    mo = +m[1]; d = +m[2]; y = +m[3];
    if (m[4] !== undefined) { hasTime = true; h = +m[4]; mi = +m[5]; if (m[6]) { const pm = /p/i.test(m[6]); if (h === 12) h = pm ? 12 : 0; else if (pm) h += 12; } }
  } else if ((m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/.exec(s))) {
    y = +m[1]; mo = +m[2]; d = +m[3];
    if (m[4] !== undefined) { hasTime = true; h = +m[4]; mi = +m[5]; }
  } else return undefined;
  const ms = Date.UTC(y, mo - 1, d, h, mi);
  const t = new Date(ms);
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== mo - 1 || t.getUTCDate() !== d || h > 23 || mi > 59) return undefined;
  return { ms, hasTime };
}
const hash = (str) => { // 53-bit string hash: a local pseudonymous buyer key, not security
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i += 1) { const c = str.charCodeAt(i); h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677); }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
};

// ---- aggregation -------------------------------------------------------------------------------------------------
export function createOrderAggregator() {
  let map = null;
  const s = {
    rows: 0, orders: 0, skipped: 0, skipReasons: {}, unknownValue: 0, revenueCents: 0, valueKnown: 0,
    over20: 0, ge4999: 0, ge250: 0, ge4999Cents: 0, ge250Cents: 0, noTrackingAt4999: 0, hasTrackingCol: false,
    states: new Map(), zip3: new Map(), weekday: new Array(7).fill(0), hour: new Array(24).fill(0), withTime: 0,
    days: new Map(), buyers: new Map(), names: new Map(), buyersCapped: false, minDay: Infinity, maxDay: -Infinity,
  };
  let cur = null; // item-level exports: rows with the same order number are one order
  const skip = (why) => { s.skipped += 1; s.skipReasons[why] = (s.skipReasons[why] || 0) + 1; };
  const bump = (m, k, n = 1) => m.set(k, (m.get(k) || 0) + n);

  function finish(o) {
    if (!o) return;
    s.orders += 1;
    const cents = o.cents;
    if (cents === undefined) s.unknownValue += 1;
    else {
      s.revenueCents += cents; s.valueKnown += 1;
      if (cents > 2000) s.over20 += 1;
      if (cents >= 4999) { s.ge4999 += 1; s.ge4999Cents += cents; if (map.tracking !== undefined && !o.tracking) s.noTrackingAt4999 += 1; }
      if (cents >= 25000) { s.ge250 += 1; s.ge250Cents += cents; }
    }
    if (o.state) bump(s.states, o.state);
    if (o.zip3) bump(s.zip3, o.zip3);
    const day = Math.floor(o.ms / DAY);
    s.minDay = Math.min(s.minDay, day); s.maxDay = Math.max(s.maxDay, day);
    const dd = s.days.get(day) || { orders: 0, cents: 0 };
    dd.orders += 1; dd.cents += cents || 0; s.days.set(day, dd);
    s.weekday[new Date(o.ms).getUTCDay()] += 1;
    if (o.hasTime) { s.hour[new Date(o.ms).getUTCHours()] += 1; s.withTime += 1; }
    if (o.buyer) {
      let b = s.buyers.get(o.buyer);
      if (!b) {
        if (s.buyers.size >= LIMITS.maxBuyers) { s.buyersCapped = true; return; }
        b = { orders: 0, cents: 0, firstDay: day, lastDay: day };
        s.buyers.set(o.buyer, b);
        if (o.display) s.names.set(o.buyer, o.display);
      }
      b.orders += 1; b.cents += cents || 0; b.firstDay = Math.min(b.firstDay, day); b.lastDay = Math.max(b.lastDay, day);
    }
  }

  return {
    state: s,
    row(cells) {
      if (!map) { map = mapColumns(cells); s.columns = map; s.itemLevel = map.quantity !== undefined && map.items === undefined && map.value === undefined; return; }
      s.rows += 1;
      if (s.rows > LIMITS.maxRows) throw new Error('too many rows (limit ' + LIMITS.maxRows + ')');
      const get = (f) => (map[f] === undefined ? '' : (cells[map[f]] ?? ''));
      const dt = parseDate(get('date'));
      if (!dt) return skip('unreadable date');
      const orderNo = String(get('order')).trim();
      if (s.itemLevel && cur && orderNo && cur.orderNo === orderNo) return; // another line of the same order
      finish(cur); cur = null;
      // when only one name column exists, the surname is the last word, so a middle initial is skipped
      let first = String(get('first')).trim(), last = String(get('last')).trim();
      if (!first && !last && map.name !== undefined) { const parts = String(get('name')).trim().split(/\s+/); first = parts[0] || ''; last = parts.length > 1 ? parts[parts.length - 1] : ''; }
      const zip = String(get('zip')).trim();
      const identity = (first + '|' + last + '|' + String(get('address1')).trim() + '|' + zip).toLowerCase();
      const o = {
        orderNo, ms: dt.ms, hasTime: dt.hasTime,
        cents: map.value !== undefined ? parseMoney(get('value')) : undefined,
        state: String(get('state')).trim().toUpperCase().slice(0, 3) || undefined,
        zip3: /^\d{5}/.test(zip) ? zip.slice(0, 3) : undefined,
        tracking: String(get('tracking')).trim() !== '',
        buyer: identity.length > 3 ? 'b-' + hash(identity) : undefined,
        display: first ? first[0].toUpperCase() + first.slice(1).toLowerCase() + (last ? ' ' + last[0].toUpperCase() + '.' : '') : undefined,
      };
      if (s.itemLevel) cur = o; else finish(o);
    },
    end() { finish(cur); cur = null; return s; },
  };
}

// ---- summary -----------------------------------------------------------------------------------------------------
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const pct = (n, d) => (d ? Math.round((n / d) * 1000) / 10 : 0);
const top = (m, n, total) => [...m.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]))).slice(0, n).map(([k, v]) => ({ key: k, orders: v, sharePct: pct(v, total) }));
const dayIso = (d) => new Date(d * DAY).toISOString().slice(0, 10);

export function summarize(s, { weekEnding } = {}) {
  const endDay = weekEnding ? Math.floor(Date.parse(weekEnding) / DAY) : s.maxDay;
  const sumDays = (from, to) => { let orders = 0, cents = 0; for (let d = from; d <= to; d += 1) { const x = s.days.get(d); if (x) { orders += x.orders; cents += x.cents; } } return { orders, revenueCents: cents }; };
  const thisWeek = s.orders ? sumDays(endDay - 6, endDay) : { orders: 0, revenueCents: 0 };
  const lastWeek = s.orders ? sumDays(endDay - 13, endDay - 7) : { orders: 0, revenueCents: 0 };
  const buyers = [...s.buyers.entries()];
  const repeat = buyers.filter(([, b]) => b.orders >= 2).sort((a, b) => b[1].orders - a[1].orders || b[1].cents - a[1].cents || a[0].localeCompare(b[0]));
  const repeatOrders = repeat.reduce((t, [, b]) => t + b.orders, 0);
  const weeks = [];
  if (s.orders) for (let w = Math.min(11, Math.floor((s.maxDay - s.minDay) / 7)); w >= 0; w -= 1) weeks.push({ start: dayIso(endDay - 6 - w * 7), ...sumDays(endDay - 6 - w * 7, endDay - w * 7) });
  const busiestDay = s.weekday.indexOf(Math.max(...s.weekday));
  const hasHours = s.withTime > 0;
  return {
    ok: s.orders > 0,
    rows: s.rows, orders: s.orders, skipped: s.skipped, skipReasons: s.skipReasons, unknownValueOrders: s.unknownValue,
    columns: Object.keys(s.columns || {}),
    weekEnding: s.orders ? dayIso(endDay) : null,
    revenueCents: s.revenueCents,
    averageOrderCents: s.valueKnown ? Math.round(s.revenueCents / s.valueKnown) : null,
    thresholds: {
      over20: { orders: s.over20, sharePct: pct(s.over20, s.valueKnown), meaning: 'tracking recommended', policy: 'SHIP-1' },
      atLeast4999: { orders: s.ge4999, sharePct: pct(s.ge4999, s.valueKnown), revenueCents: s.ge4999Cents, meaning: 'tracking required', policy: 'SHIP-1', ...(s.columns && s.columns.tracking !== undefined ? { withoutTrackingNumber: s.noTrackingAt4999 } : {}) },
      atLeast250: { orders: s.ge250, sharePct: pct(s.ge250, s.valueKnown), revenueCents: s.ge250Cents, meaning: 'tracking and signature required', policy: 'SHIP-1' },
    },
    states: top(s.states, 10, s.orders).map(({ key, orders, sharePct }) => ({ state: key, orders, sharePct })),
    zipAreas: top(s.zip3, 10, s.orders).map(({ key, orders, sharePct }) => ({ zip3: key, orders, sharePct })),
    weekday: Object.fromEntries(WEEKDAYS.map((d, i) => [d, s.weekday[i]])),
    busiestWeekday: s.orders ? WEEKDAYS[busiestDay] : null,
    hours: hasHours ? s.hour.slice() : null,
    busiestHour: hasHours ? s.hour.indexOf(Math.max(...s.hour)) : null,
    hourNote: hasHours ? 'Times are as written in the file (no time zone is given).' : 'This export has no time of day in "Order Date", so there is no hour pattern.',
    thisWeek, lastWeek,
    weekChangePct: lastWeek.revenueCents ? Math.round(((thisWeek.revenueCents - lastWeek.revenueCents) / lastWeek.revenueCents) * 1000) / 10 : null,
    weeks,
    repeat: {
      buyers: s.buyers.size, repeatBuyers: repeat.length, repeatShareOfBuyersPct: pct(repeat.length, s.buyers.size), repeatShareOfOrdersPct: pct(repeatOrders, s.orders),
      top: repeat.slice(0, 10).map(([key, b]) => ({ buyer: key, orders: b.orders, spendCents: b.cents, daysBetween: b.orders > 1 ? Math.round(((b.lastDay - b.firstDay) / (b.orders - 1)) * 10) / 10 : null })),
      capped: s.buyersCapped,
    },
  };
}

const money = (c) => '$' + (c / 100).toFixed(2);
export const BUYER_PLACEHOLDER = (key) => `{{buyer:${key}}}`;
// Replace {{buyer:KEY}} with "Ada L." from the on-device table. Names never leave the device.
export function fillBuyerNames(text, names) {
  return String(text).replace(/\{\{buyer:([a-z0-9-]+)\}\}/g, (_, k) => (names && names.get(k)) || 'a repeat buyer');
}

// The weekly summary as plain text. Buyer names appear only as placeholders, in the seller-only block.
export function weeklyDraftFromFile(sm) {
  if (!sm.ok) return 'No orders could be read from that file.';
  const L = [`Week ending ${sm.weekEnding} (from your order file)`];
  L.push(`${sm.thisWeek.orders} orders, ${money(sm.thisWeek.revenueCents)}` + (sm.weekChangePct === null ? '.' : ` (${sm.weekChangePct >= 0 ? 'up' : 'down'} ${Math.abs(sm.weekChangePct)}% on last week's ${sm.lastWeek.orders} orders, ${money(sm.lastWeek.revenueCents)}).`));
  if (sm.averageOrderCents !== null) L.push(`Average order ${money(sm.averageOrderCents)} across ${sm.orders} orders in the file.`);
  const t = sm.thresholds;
  L.push(`${t.atLeast4999.orders} orders (${t.atLeast4999.sharePct}%) were $49.99 or more and need tracking; ${t.atLeast250.orders} were $250 or more and need signature too (rule SHIP-1; rules change, so check TCGplayer's current article).`);
  if (sm.states.length) L.push('Top states: ' + sm.states.slice(0, 3).map((x) => `${x.state} ${x.sharePct}%`).join(', ') + '. Top ZIP areas: ' + sm.zipAreas.slice(0, 3).map((x) => `${x.zip3}xx ${x.sharePct}%`).join(', ') + '.');
  L.push(`Busiest weekday: ${sm.busiestWeekday}.` + (sm.busiestHour !== null ? ` Busiest hour: ${sm.busiestHour}:00.` : ' ' + sm.hourNote));
  L.push(`Repeat buyers: ${sm.repeat.repeatBuyers} of ${sm.repeat.buyers} buyers (${sm.repeat.repeatShareOfOrdersPct}% of orders).`);
  if (sm.repeat.top.length) L.push('', 'Seller only (names stay on this device):', ...sm.repeat.top.slice(0, 5).map((b) => `- ${BUYER_PLACEHOLDER(b.buyer)}: ${b.orders} orders, ${money(b.spendCents)}`));
  return L.join('\n');
}

// Chart-ready numbers (labels and series, no drawing).
export function chartsFromSummary(sm) {
  if (!sm.ok) return [];
  const charts = [
    { kind: 'orders-per-week', title: 'Orders per week (label = week start)', type: 'line', x: sm.weeks.map((w) => w.start), series: [{ name: 'Orders', unit: 'orders', values: sm.weeks.map((w) => w.orders) }, { name: 'Sales', unit: 'cents', values: sm.weeks.map((w) => w.revenueCents) }] },
    { kind: 'states', title: 'Orders by state (top 10)', type: 'bar', x: sm.states.map((s) => s.state), series: [{ name: 'Orders', unit: 'orders', values: sm.states.map((s) => s.orders) }] },
    { kind: 'zip-areas', title: 'Orders by first 3 digits of ZIP (top 10)', type: 'bar', x: sm.zipAreas.map((s) => s.zip3), series: [{ name: 'Orders', unit: 'orders', values: sm.zipAreas.map((s) => s.orders) }] },
    { kind: 'weekday', title: 'Orders by weekday', type: 'bar', x: Object.keys(sm.weekday), series: [{ name: 'Orders', unit: 'orders', values: Object.values(sm.weekday) }] },
    { kind: 'order-value-tiers', title: 'Orders by shipping tier', type: 'bar', x: ['Under $20', '$20 to $49.98', '$49.99 to $249.99', '$250 and up'], series: [{ name: 'Orders', unit: 'orders', values: [sm.orders - sm.unknownValueOrders - sm.thresholds.over20.orders, sm.thresholds.over20.orders - sm.thresholds.atLeast4999.orders, sm.thresholds.atLeast4999.orders - sm.thresholds.atLeast250.orders, sm.thresholds.atLeast250.orders] }] },
  ];
  if (sm.hours) charts.push({ kind: 'hour', title: 'Orders by hour of day', type: 'bar', x: sm.hours.map((_, i) => String(i)), series: [{ name: 'Orders', unit: 'orders', values: sm.hours }] });
  return charts;
}

// ---- entry points -------------------------------------------------------------------------------------------------
// source: a string, or an iterable / async iterable of string chunks (a file stream, a fetch body).
export async function analyzeOrderFile(source, { weekEnding } = {}) {
  const agg = createOrderAggregator();
  const parser = createCsvParser((cells) => agg.row(cells));
  if (typeof source === 'string') {
    for (let i = 0; i < source.length; i += 65536) parser.push(source.slice(i, i + 65536));
  } else {
    for await (const chunk of source) parser.push(typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk, { stream: true }));
  }
  parser.end();
  const state = agg.end();
  const summary = summarize(state, { weekEnding });
  return { summary, names: state.names, draft: weeklyDraftFromFile(summary), charts: chartsFromSummary(summary) };
}
