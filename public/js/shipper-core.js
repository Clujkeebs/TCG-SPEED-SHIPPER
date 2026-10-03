/* Pure, DOM-free parsing and text helpers for TCG Speed Shipper.
   Loaded by index.html as window.TCGSSCore, and required directly by
   test/csv-parser.test.js so the exact code that builds real labels is the
   code under test. Keep it free of DOM/jsPDF dependencies. */
(function (root, factory) {
  var core = factory();
  if (typeof module === 'object' && module.exports) module.exports = core;
  else root.TCGSSCore = core;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ── CSV ── */

  // RFC 4180 reader: handles quoted fields containing commas, escaped quotes
  // ("") and line breaks, CRLF/LF/CR line endings, and a leading UTF-8 BOM
  // (Excel adds one when re-saving a CSV). Splitting on newlines first — what
  // this used to do — broke any row whose address or product name contained
  // a line break, silently shifting every column after it.
  function readCSVRows(text) {
    text = String(text || '');
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
    var rows = [], row = [], field = '', inQ = false, i, c;
    for (i = 0; i < text.length; i++) {
      c = text[i];
      if (inQ) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; }
          else inQ = false;
        } else field += c;
      } else if (c === '"') {
        inQ = true;
      } else if (c === ',') {
        row.push(field); field = '';
      } else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(field); rows.push(row); row = []; field = '';
      } else field += c;
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row); }
    return rows
      .map(function (r) { return r.map(function (f) { return f.trim(); }); })
      .filter(function (r) { return r.some(function (f) { return f !== ''; }); });
  }

  function normHeader(s) { return String(s).toLowerCase().replace(/[^a-z0-9]/g, ''); }

  // Header candidates per field. `avoid` excludes look-alike columns from the
  // loose (substring) match — TCGplayer's shipping export has "Product Weight"
  // and "Item Count", which used to be picked up as the item name, so packing
  // slips listed "• 0.12" instead of cards.
  var MAPS = {
    firstName:   { names: ['first name', 'firstname', 'buyer first name'] },
    lastName:    { names: ['last name', 'lastname', 'buyer last name'] },
    fullName:    { names: ['name', 'buyer name', 'recipient name', 'ship to name', 'customer name', 'full name'], avoid: /product|item|card|seller|store|set|first|last|user/ },
    addr1:       { names: ['address 1', 'address1', 'street address', 'address line 1', 'ship address 1', 'shipping address 1', 'street', 'ship to address 1', 'address'], avoid: /2|email|^ip/ },
    addr2:       { names: ['address 2', 'address2', 'address line 2', 'ship address 2', 'ship to address 2'] },
    city:        { names: ['city', 'ship city', 'shipping city', 'ship to city'] },
    state:       { names: ['state', 'province', 'ship state', 'shipping state', 'ship to state', 'region'], avoid: /status|statement/ },
    zip:         { names: ['zip', 'postal code', 'postalcode', 'zip code', 'ship zip', 'shipping zip', 'postcode', 'ship to zip'] },
    country:     { names: ['country', 'ship country', 'ship to country'] },
    orderNumber: { names: ['order #', 'order number', 'order id', 'ordernumber', 'order no'], avoid: /date|status|total|value|count|weight|method/ },
    item:        { names: ['product name', 'item name', 'card name', 'product', 'item', 'card', 'description'], avoid: /weight|count|qty|quantity|value|price|cost|total|fee|date|id$|number|line|condition|sku/ },
    quantity:    { names: ['quantity', 'qty'] },
    itemCount:   { names: ['item count', 'itemcount', 'number of items'] },
    productWeight: { names: ['product weight', 'weight', 'total weight'], avoid: /unit|lb|kg|g$/ },
    setName:     { names: ['set name', 'set', 'expansion', 'edition'], avoid: /offset|reset|asset|setting/ },
    condition:   { names: ['condition'] },
    shipMethod:  { names: ['shipping method', 'ship method', 'shipping type', 'shipping service'] },
    orderValue:  { names: ['value of products', 'product value', 'order value', 'products total', 'item total', 'subtotal', 'order total'], avoid: /ship|fee|tax|count|weight|quantity/ }
  };

  // Exact (normalized) matches win over substring matches, across ALL
  // candidates — otherwise the first header that merely *contains* "order"
  // (e.g. "Order Date") could beat a later, exact "Order #".
  function findColumn(headers, spec) {
    var norm = headers.map(normHeader), i, j, cand;
    for (i = 0; i < spec.names.length; i++) {
      cand = normHeader(spec.names[i]);
      for (j = 0; j < norm.length; j++) if (norm[j] === cand) return j;
    }
    for (i = 0; i < spec.names.length; i++) {
      cand = normHeader(spec.names[i]);
      if (cand.length < 4) continue;
      for (j = 0; j < norm.length; j++) {
        if (norm[j].indexOf(cand) !== -1 && !(spec.avoid && spec.avoid.test(norm[j]))) return j;
      }
    }
    return -1;
  }

  function splitName(full) {
    var parts = String(full || '').trim().split(/\s+/).filter(Boolean);
    return { first: parts[0] || '', last: parts.slice(1).join(' ') };
  }

  function parseCSV(text) {
    var rows = readCSVRows(text);
    if (rows.length < 2) return { error: 'That file looks empty — it needs a header row plus at least one order.' };
    var headers = rows[0];
    var cols = {};
    Object.keys(MAPS).forEach(function (k) { cols[k] = findColumn(headers, MAPS[k]); });
    // A lone "Name" column must not be mistaken for first/last pairs.
    if (cols.firstName !== -1 && cols.firstName === cols.fullName) cols.fullName = -1;

    var hasName = cols.fullName !== -1 || (cols.firstName !== -1 && cols.lastName !== -1);
    if (!hasName || cols.addr1 === -1) {
      return {
        error: 'Could not find the buyer name and address columns in this file. Make sure it is the TCGplayer order/shipping export, not the pull sheet. Columns found: ' +
          headers.filter(Boolean).join(', ')
      };
    }

    var orderMap = {}, orderList = [];
    for (var r = 1; r < rows.length; r++) {
      var cells = rows[r];
      var get = function (key) {
        var c = cols[key];
        return (c === -1 || c >= cells.length) ? '' : (cells[c] || '').trim();
      };
      var fn, ln;
      if (cols.firstName !== -1 && cols.lastName !== -1) { fn = get('firstName'); ln = get('lastName'); }
      else { var sp = splitName(get('fullName')); fn = sp.first; ln = sp.last; }
      if (!fn && !ln) continue;
      var onum = get('orderNumber');
      var mapKey = onum || (fn + '|' + ln + '|' + get('addr1') + '|' + get('zip'));
      if (!orderMap[mapKey]) {
        var entry = {
          firstName: fn, lastName: ln, addr1: get('addr1'), addr2: get('addr2'),
          city: get('city'), state: get('state'), zip: get('zip'), country: get('country'),
          orderNumber: onum, shipMethod: get('shipMethod'), itemCount: 0, items: [], lines: [],
          orderValue: parseMoney(get('orderValue')), productWeight: null
        };
        orderMap[mapKey] = entry; orderList.push(entry);
      }
      var o = orderMap[mapKey];
      var item = get('item');
      var qty = parseInt(get('quantity'), 10);
      if (item) {
        var label = (qty > 1 ? qty + '× ' : '') + item;
        if (o.items.indexOf(label) === -1) o.items.push(label);
        // Every row goes on the pull sheet: two variants can share a display
        // label (same name and qty, different set or condition).
        o.lines.push({ name: item, qty: qty > 0 ? qty : 1, set: get('setName'), condition: get('condition') });
        o.itemCount += qty > 0 ? qty : 1;
      } else {
        var ic = parseInt(get('itemCount'), 10);
        if (ic > 0) o.itemCount += ic;
      }
      var weight = parseMoney(get('productWeight'));
      if (weight !== null && weight > 0) {
        if (cols.item !== -1) {
          o.productWeight = (o.productWeight === null ? 0 : o.productWeight) + weight;
        } else if (o.productWeight === null) {
          o.productWeight = weight;
        }
      }
    }
    return orderList;
  }

  // "$1,234.50", "12.00 USD", "(3.00)" → number; blank or junk → null.
  function parseMoney(s) {
    var t = String(s == null ? '' : s).replace(/[,$\s]|usd/gi, '');
    if (!t) return null;
    var n = parseFloat(t.replace(/^\((.*)\)$/, '-$1'));
    return isFinite(n) ? n : null;
  }

  /* ── Shipping plan ──
     TCGplayer's published seller shipping guidelines: tracking is
     recommended over $20, required at $49.99 and up, and signature
     confirmation is required at $250 and up. Under $20, a stamped plain white
     envelope (PWE) is the normal way to ship. When the export has no order
     value, the buyer's chosen shipping method is the best signal we have. */
  var TIERS = {
    signature:   { rank: 3, label: 'Signature required', short: 'Signature' },
    tracking:    { rank: 2, label: 'Tracking required', short: 'Tracking' },
    recommended: { rank: 1, label: 'Tracking recommended', short: 'Tracking rec.' },
    envelope:    { rank: 0, label: 'Envelope OK', short: 'Envelope' },
    unknown:     { rank: -1, label: '', short: '' }
  };
  // USPS Notice 123, First-Class Mail stamped letters: https://pe.usps.com/text/dmm300/Notice123.htm
  var LETTER_POSTAGE = Object.freeze({ EFFECTIVE: '2026-10-04', FIRST_OUNCE: 82, ADDL_OUNCE: 29, NONMACHINABLE: 49, MAX_OZ: 3.5 });
  function shippingTier(o) {
    var v = o.orderValue;
    var expedited = /expedit|priority|express|overnight|tracked|2[- ]?day/i.test(o.shipMethod || '');
    var tier;
    if (typeof v === 'number') {
      tier = v >= 250 ? 'signature' : v >= 49.99 ? 'tracking' : v > 20 ? 'recommended' : 'envelope';
      // A buyer who paid for expedited shipping expects tracking regardless.
      if (expedited && TIERS[tier].rank < TIERS.tracking.rank) tier = 'tracking';
    } else {
      tier = expedited ? 'tracking' : 'unknown';
    }
    return { tier: tier, label: TIERS[tier].label, short: TIERS[tier].short };
  }

  function letterPostage(weightOz, opts) {
    if (typeof weightOz !== 'number' || !isFinite(weightOz) || weightOz <= 0) return null;
    if (weightOz > LETTER_POSTAGE.MAX_OZ) return { notLetter: true, oz: weightOz };
    var addl = Math.max(0, Math.ceil(Math.round((weightOz - 1) * 100) / 100));
    var postage = LETTER_POSTAGE.FIRST_OUNCE + addl * LETTER_POSTAGE.ADDL_OUNCE;
    var surcharge = opts && opts.nonmachinable ? LETTER_POSTAGE.NONMACHINABLE : 0;
    return {
      oz: weightOz,
      forever: 1,
      addlOunce: addl,
      postage: postage / 100,
      surcharge: surcharge / 100,
      price: (postage + surcharge) / 100,
      effective: LETTER_POSTAGE.EFFECTIVE
    };
  }

  // Stamps for a batch: only envelope-tier orders (the ones that go out as
  // plain white envelopes), each weighed as TCGplayer's product weight plus the
  // seller's own packaging weight. Returns null until the seller has entered
  // their packaging weight: an estimate without it would undercount.
  function stampPlan(orders, packagingOz, opts) {
    var pkg = typeof packagingOz === 'number' && isFinite(packagingOz) && packagingOz >= 0 ? packagingOz : null;
    var plan = { letters: 0, forever: 0, addlOunce: 0, nonmachinable: 0, total: 0, notLetter: 0, noWeight: 0, perOrder: [] };
    (orders || []).forEach(function (o, i) {
      if (shippingTier(o).tier !== 'envelope') { plan.perOrder[i] = null; return; }
      if (typeof o.productWeight !== 'number' || !(o.productWeight > 0)) { plan.noWeight++; plan.perOrder[i] = null; return; }
      if (pkg === null) { plan.perOrder[i] = null; return; }
      var p = letterPostage(Math.round((o.productWeight + pkg) * 1000) / 1000, opts);
      plan.perOrder[i] = p;
      if (!p) return;
      if (p.notLetter) { plan.notLetter++; return; }
      plan.letters++;
      plan.forever += p.forever;
      plan.addlOunce += p.addlOunce;
      if (p.surcharge) plan.nonmachinable++;
      plan.total = Math.round((plan.total + p.price) * 100) / 100;
    });
    plan.needsPackaging = pkg === null;
    return plan;
  }

  // Pull sheet: every card across the batch, merged by card + set +
  // condition, with the orders it goes to, sorted by set then name so the
  // seller walks their binders once. Needs an export with product names.
  function pullSheet(orders) {
    var byKey = {}, rows = [], total = 0;
    (orders || []).forEach(function (o, i) {
      var ref = o.orderNumber || ('#' + (i + 1));
      (o.lines || []).forEach(function (l) {
        var key = [l.name, l.set || '', l.condition || ''].join('\u0001').toLowerCase();
        var r = byKey[key];
        if (!r) { r = byKey[key] = { name: l.name, set: l.set || '', condition: l.condition || '', qty: 0, orders: [], perOrder: {} }; rows.push(r); }
        r.qty += l.qty;
        total += l.qty;
        if (r.orders.indexOf(ref) === -1) r.orders.push(ref);
        r.perOrder[ref] = (r.perOrder[ref] || 0) + l.qty;
      });
    });
    // "A ×3, B": which order gets how many copies.
    rows.forEach(function (r) {
      r.orderText = r.orders.map(function (ref) { return r.perOrder[ref] > 1 ? ref + ' ×' + r.perOrder[ref] : ref; }).join(', ');
    });
    rows.sort(function (a, b) {
      return a.set.localeCompare(b.set, 'en', { sensitivity: 'base' }) || a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }) || a.condition.localeCompare(b.condition);
    });
    return { rows: rows, totalCards: total };
  }

  /* ── TCGplayer tracking import ──
     TCGplayer's documented bulk flow: take the original shipping export,
     fill in each order's tracking number (the export already has "Tracking #"
     and "Carrier" columns), and import that file back in the Seller Portal.
     Orders that ship without tracking are marked with the word "Shipped".
     This builds that file from the seller's own export, so every column
     TCGplayer expects is exactly as TCGplayer wrote it. */
  function detectCarrier(num) {
    var n = String(num || '').replace(/\s+/g, '').toUpperCase();
    if (/^1Z[0-9A-Z]{16}$/.test(n)) return 'UPS';
    if (/^(9[1-5]\d{18,24}|82\d{8}|[A-Z]{2}\d{9}US)$/.test(n)) return 'USPS';
    if (/^(\d{12}|\d{15}|96\d{20})$/.test(n)) return 'FedEx';
    return '';
  }

  // Lines are either "<tracking>" (matched to orders by position, as the
  // Tracking panel always has) or "<order #> <tracking>" (matched by order
  // number, so order doesn't matter).
  function matchTracking(lines, orderNumbers) {
    var byOrder = {}, positional = [], known = {};
    orderNumbers.forEach(function (o) { if (o) known[String(o).toUpperCase()] = o; });
    lines.forEach(function (raw) {
      var line = String(raw || '').trim();
      if (!line) return;
      var parts = line.split(/[\s,;\t]+/).filter(Boolean);
      if (parts.length >= 2 && known[parts[0].toUpperCase()]) byOrder[known[parts[0].toUpperCase()]] = parts.slice(1).join('');
      else positional.push(line.replace(/\s+/g, ''));
    });
    return orderNumbers.map(function (o, i) { return byOrder[o] || positional[i] || ''; });
  }

  function csvField(v) {
    v = v == null ? '' : String(v);
    // Spreadsheet formula injection: a buyer-supplied name or address that
    // starts with = + - @ (or a tab/CR) would run as a formula if the seller
    // opens the file in Excel or Sheets. A leading ' makes it plain text.
    // Plain numbers like -5.00 are left alone.
    if (/^[=+\-@\t\r]/.test(v) && !/^[+-]?\d+(\.\d+)?$/.test(v)) v = "'" + v;
    return /[",\r\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
  }

  // csvText: the seller's original TCGplayer export. tracking: { orderNumber:
  // trackingNumber }. opts.markShipped: orders with no number get "Shipped".
  // Returns { csv, included, skipped, missingRequired } or { error }.
  function buildTrackingImport(csvText, tracking, opts) {
    opts = opts || {};
    var rows = readCSVRows(csvText);
    if (rows.length < 2) return { error: 'The original CSV is empty.' };
    var headers = rows[0].slice();
    var orderCol = findColumn(headers, MAPS.orderNumber);
    if (orderCol === -1) return { error: 'This file has no order number column, so TCGplayer could not match it. Use the TCGplayer shipping export.' };
    var norm = headers.map(normHeader);
    var trackCol = norm.indexOf('tracking');
    if (trackCol === -1) trackCol = norm.indexOf('trackingnumber');
    if (trackCol === -1) { headers.push('Tracking #'); trackCol = headers.length - 1; }
    var carrierCol = norm.indexOf('carrier');
    if (carrierCol === -1) { headers.push('Carrier'); carrierCol = headers.length - 1; }
    var valueCol = findColumn(headers, MAPS.orderValue);

    var out = [headers], included = [], skipped = [], missingRequired = [], seen = {};
    for (var r = 1; r < rows.length; r++) {
      var row = rows[r].slice();
      while (row.length < headers.length) row.push('');
      var on = (row[orderCol] || '').trim();
      if (!on) continue;
      var num = (tracking[on] || '').trim();
      var value = valueCol === -1 ? null : parseMoney(row[valueCol]);
      if (num) {
        row[trackCol] = num;
        row[carrierCol] = detectCarrier(num) || row[carrierCol] || opts.defaultCarrier || 'USPS';
      } else if (opts.markShipped) {
        if (typeof value === 'number' && value >= 49.99 && !seen[on]) missingRequired.push(on);
        row[trackCol] = 'Shipped';
        row[carrierCol] = row[carrierCol] || opts.defaultCarrier || 'USPS';
      } else {
        if (!seen[on]) skipped.push(on);
        seen[on] = true;
        continue;
      }
      if (!seen[on]) included.push(on);
      seen[on] = true;
      out.push(row);
    }
    return {
      csv: out.map(function (rw) { return rw.map(csvField).join(','); }).join('\r\n') + '\r\n',
      included: included, skipped: skipped, missingRequired: missingRequired
    };
  }

  function buildPirateShipCSV(orders) {
    orders = orders || [];
    var rows = [['Name', 'Address', 'Address Line 2', 'City', 'State', 'Zipcode', 'Country', 'Order ID', 'Rubber Stamp 1']];
    orders.forEach(function (o) {
      var itemCount = parseInt(o.itemCount, 10);
      var items = itemCount > 0 ? itemCount + (itemCount === 1 ? ' item' : ' items') : '';
      var orderNumber = o.orderNumber == null ? '' : String(o.orderNumber);
      var stamp = orderNumber
        ? 'TCGplayer ' + orderNumber + (items ? ' · ' + items : '')
        : items;
      rows.push([
        fullName(o), o.addr1, o.addr2, o.city, o.state, o.zip,
        String(o.country || '').trim() || 'US', orderNumber, stamp
      ]);
    });
    return {
      csv: rows.map(function (row) { return row.map(csvField).join(','); }).join('\r\n') + '\r\n',
      count: orders.length
    };
  }

  /* ── Pasted addresses ── */

  /* ── Pasted addresses → orders ──
     Forgiving on purpose: sellers paste from eBay, Whatnot, PayPal, emails,
     spreadsheets and notes. We find each address by its "City, ST ZIP" line
     (anywhere, with or without commas, full state names, ZIP+4, Canada too),
     so blank lines between addresses are optional, one-line addresses work,
     and phone numbers, emails, "Ship to:" labels, order numbers and country
     lines are ignored. */
  var STATE_NAMES = { alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA', colorado: 'CO', connecticut: 'CT',
    delaware: 'DE', 'district of columbia': 'DC', florida: 'FL', georgia: 'GA', hawaii: 'HI', idaho: 'ID', illinois: 'IL', indiana: 'IN',
    iowa: 'IA', kansas: 'KS', kentucky: 'KY', louisiana: 'LA', maine: 'ME', maryland: 'MD', massachusetts: 'MA', michigan: 'MI',
    minnesota: 'MN', mississippi: 'MS', missouri: 'MO', montana: 'MT', nebraska: 'NE', nevada: 'NV', 'new hampshire': 'NH',
    'new jersey': 'NJ', 'new mexico': 'NM', 'new york': 'NY', 'north carolina': 'NC', 'north dakota': 'ND', ohio: 'OH', oklahoma: 'OK',
    oregon: 'OR', pennsylvania: 'PA', 'rhode island': 'RI', 'south carolina': 'SC', 'south dakota': 'SD', tennessee: 'TN', texas: 'TX',
    utah: 'UT', vermont: 'VT', virginia: 'VA', washington: 'WA', 'west virginia': 'WV', wisconsin: 'WI', wyoming: 'WY',
    'puerto rico': 'PR', guam: 'GU', 'virgin islands': 'VI', 'us virgin islands': 'VI', 'american samoa': 'AS', 'northern mariana islands': 'MP' };
  var US_CODES = 'AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY PR GU VI AS MP AA AE AP FM MH PW'.split(' ');
  var CA_CODES = 'AB BC MB NB NL NS NT NU ON PE QC SK YT'.split(' ');
  var STATE_ALT = Object.keys(STATE_NAMES).sort(function (x, y) { return y.length - x.length; }).join('|');
  // ...city[,] STATE[.][,] ZIP at the end of a line. City is the last comma part.
  var US_END_RE = new RegExp('(?:^|,)\\s*([^,]*?[A-Za-z][^,]*?)\\s*,?\\s+(' + STATE_ALT + '|[A-Za-z]{2})\\.?\\s*,?\\s*(\\d{4,5}(?:\\s*[-–]?\\s*\\d{4})?)$', 'i');
  var CA_END_RE = /(?:^|,)\s*([^,]*?[A-Za-z][^,]*?)\s*,?\s+([A-Za-z]{2})\.?\s*,?\s*([A-Za-z]\d[A-Za-z])\s?(\d[A-Za-z]\d)$/;
  // Kept for "City, ST" on one line with the ZIP alone on the next.
  var CITY_STATE_ONLY_RE = new RegExp('^([^,]*?[A-Za-z][^,]*?)\\s*,?\\s+(' + STATE_ALT + '|[A-Za-z]{2})\\.?$', 'i');
  var ZIP_ONLY_RE = /^(\d{5}(?:-?\d{4})?)$/;

  function stateCode(raw) {
    var t = String(raw || '').trim().toLowerCase().replace(/\.$/, '');
    if (STATE_NAMES[t]) return STATE_NAMES[t];
    t = t.toUpperCase();
    return US_CODES.indexOf(t) !== -1 ? t : '';
  }
  function cleanZip(zip, st) {
    var d = String(zip).replace(/[^\d]/g, '');
    // Spreadsheets drop the leading zero of New England / NJ / PR ZIPs.
    if (d.length === 4 || d.length === 8) d = '0' + d;
    if (d.length !== 5 && d.length !== 9) return '';
    return d.length === 9 ? d.slice(0, 5) + '-' + d.slice(5) : d;
  }
  // Matches the end of a line; returns the address tail and what came before it.
  function matchCityLine(line) {
    var m = line.match(US_END_RE);
    if (m) {
      var st = stateCode(m[2]), zip = cleanZip(m[3], st);
      var city = m[1].replace(/[,\s]+$/, '').trim();
      if (st && zip && city && !/^\d+$/.test(city)) {
        return { city: city, state: st, zip: zip, country: '', before: line.slice(0, m.index).replace(/[,\s]+$/, '') };
      }
    }
    m = line.match(CA_END_RE);
    if (m && CA_CODES.indexOf(m[2].toUpperCase()) !== -1) {
      return { city: m[1].trim(), state: m[2].toUpperCase(), zip: (m[3] + ' ' + m[4]).toUpperCase(), country: 'CA', before: line.slice(0, m.index).replace(/[,\s]+$/, '') };
    }
    return null;
  }

  var LABEL_RE = /^(?:ship(?:ping)?\s*(?:to|address)|deliver(?:y)?\s*(?:to|address)|recipient|buyer|customer|name|full\s*name|address(?:\s*line)?\s*\d?|addr\s*\d?|street(?:\s*address)?|mailing\s*address|city(?:\s*\/\s*state(?:\s*\/\s*zip)?)?|state|zip(?:\s*code)?|postal\s*code|to)\s*[:\-–]\s*/i;
  var BARE_LABEL_RE = /^(?:ship(?:ping)?\s*(?:to|address|info(?:rmation)?)|deliver(?:y)?\s*(?:to|address)|recipient|buyer|customer|address(?:es)?|mailing\s*address|sold\s*to)\s*:?$/i;
  var COUNTRY_ONLY_RE = /^(?:us|usa|u\.s\.a?\.?|united\s+states(?:\s+of\s+america)?|america|canada|ca)$/i;
  var PHONE_RE = /^(?:(?:phone|tel|ph|cell|mobile)\.?\s*[:#]?\s*)?\+?1?[\s.\-()]*\d{3}[\s.\-)]*\d{3}[\s.\-]*\d{4}(?:\s*(?:x|ext\.?)\s*\d+)?$/i;
  var JUNK_RE = /^(?:order|sale|item|items|qty|quantity|tracking|ship\s*by|shipping\s*(?:method|service|speed|type)|sku|price|total|subtotal|paid|date|sold|buyer\s*note|note|email|e-mail)\b/i;
  function isJunk(l) {
    return BARE_LABEL_RE.test(l) || /^\d+\s*[x×]\s|^[x×]\s*\d+\b/i.test(l) ||
      /^(?:first\s*)?name\b.*\b(?:address|city|zip|state)\b/i.test(l) || COUNTRY_ONLY_RE.test(l) || PHONE_RE.test(l) || /^\S+@\S+\.\S+$/.test(l) || JUNK_RE.test(l) || /\$\s?\d/.test(l) || /^[-=_*#.\s]+$/.test(l);
  }
  function isStreet(l) {
    return /^\d+[a-z]?(?:-\d+)?\s+\S/i.test(l) || /^(?:p\.?\s*o\.?\s*box|post\s+office\s+box|box\s+\d|rr\s*\d|rural\s+route|hc\s*\d|psc\s*\d|unit\s+\d+\s+box|one|two|three)\b/i.test(l);
  }
  function isUnit(l) {
    return /^(?:apt|apartment|unit|ste|suite|#|fl|floor|bldg|building|rm|room|lot|spc|space|dept)\b\.?/i.test(l);
  }

  function tidy(t) {
    t = String(t || '').trim();
    return t && t === t.toLowerCase() ? t.replace(/\b([a-z])/g, function (c) { return c.toUpperCase(); }) : t;
  }

  function parsePastedAddresses(text) {
    var raw = String(text || '').replace(/\r\n?/g, '\n').replace(/[   ]/g, ' ').replace(/[​-‍﻿]/g, '');
    var lines = [];
    raw.split('\n').forEach(function (l) {
      // Spreadsheet rows: tabs become commas, so the row reads as one line.
      l = l.replace(/\t+/g, ', ').replace(/\s{2,}/g, ' ').trim().replace(/^[,\s]+|[,\s]+$/g, '');
      l = l.replace(/^(?:\d{1,3}[.)]|[-*•·▪]|\(\d{1,3}\))\s+(?=\D)/, '');   // list numbering / bullets
      l = l.replace(LABEL_RE, '').trim();
      lines.push(l);
    });
    // "City, ST" with the ZIP alone on the next line → one line.
    for (var i = 0; i < lines.length - 1; i++) {
      if (lines[i] && CITY_STATE_ONLY_RE.test(lines[i]) && stateCode(lines[i].match(CITY_STATE_ONLY_RE)[2]) && ZIP_ONLY_RE.test(lines[i + 1])) {
        lines[i] = lines[i] + ' ' + lines[i + 1]; lines[i + 1] = '';
      }
    }

    var good = [], bad = [], group = [];
    // group holds the non-junk lines since the last address (or blank line
    // that came after a complete address).
    lines.forEach(function (l) {
      if (!l) { group.push(null); return; }
      var m = matchCityLine(l);
      if (!m) { if (!isJunk(l)) group.push(l); return; }
      var pre = group;
      group = [];
      // One-line addresses: "Jane Doe, 456 Oak Ave, Apt 2, Chicago, IL 60601".
      if (m.before) m.before.split(/\s*,\s*/).filter(Boolean).forEach(function (part) { if (!isJunk(part)) pre.push(part); });
      // Only look back to the last blank line if there are lines after it.
      var start = 0;
      for (var k = pre.length - 1; k >= 0; k--) if (pre[k] === null) { var after = pre.slice(k + 1).filter(Boolean); if (after.length) { start = k + 1; break; } }
      var dropped = pre.slice(0, start).filter(Boolean);
      if (dropped.length) bad.push({ raw: dropped.join('\n'), error: 'Couldn\'t find a "City, ST ZIP" for this one.' });
      var cand = pre.slice(start).filter(Boolean);
      // Name a line with no street at all ("Jane Doe Chicago, IL 60601")? Not guessable.
      var si = -1;
      for (var j = 0; j < cand.length; j++) if (isStreet(cand[j])) { si = j; break; }
      var nameLine = '', company = '', streets;
      if (si === -1) { nameLine = cand[0] || ''; streets = cand.slice(1); }
      else {
        var before = cand.slice(0, si).filter(function (x) { return !isUnit(x); });
        if (before.length === 1) nameLine = before[0];
        else if (before.length >= 2) { nameLine = before[before.length - 2]; company = before[before.length - 1]; }
        streets = cand.slice(si);
      }
      var shown = cand.concat([l]).join('\n');
      if (!nameLine) { bad.push({ raw: shown, error: 'No name above the street address.' }); return; }
      if (!streets.length) { bad.push({ raw: shown, error: 'No street address between the name and "' + m.city + ', ' + m.state + '".' }); return; }
      var name = splitName(tidy(nameLine));
      var addr = (company ? [company].concat(streets) : streets).map(tidy);
      good.push({
        firstName: name.first, lastName: name.last,
        addr1: addr[0], addr2: addr.slice(1).join(', '),
        city: tidy(m.city), state: m.state, zip: m.zip,
        country: m.country, orderNumber: '', shipMethod: '', itemCount: 0, items: [], orderValue: null
      });
    });
    var left = group.filter(Boolean);
    if (left.length) bad.push({ raw: left.join('\n'), error: 'Couldn\'t find a "City, ST ZIP" for this one.' });
    return { good: good, bad: bad };
  }

  /* ── TCGplayer packing-slip PDF → orders ──
     TCGplayer's Packing Slip button makes a PDF (with the card list) but no
     CSV. We don't parse its layout: we already know every order number from
     the shipping export, so each PDF page is matched by searching its text
     for one. A page with no order number continues the previous order (a
     long card list spilling onto a second page). Whitespace is ignored on
     both sides because PDF text extraction splits strings unpredictably. */
  function matchSlipPages(pageTexts, orderNumbers) {
    var norm = function (t) { return String(t == null ? '' : t).replace(/\s+/g, '').toUpperCase(); };
    var nums = [];
    (orderNumbers || []).forEach(function (n) { var k = norm(n); if (k.length >= 4 && nums.indexOf(k) === -1) nums.push(k); });
    // Longest first, so "ABC-12" never claims a page that belongs to "ABC-123".
    var byLen = nums.slice().sort(function (a, b) { return b.length - a.length; });
    var pages = {}, unmatched = [], current = null;
    (pageTexts || []).forEach(function (txt, i) {
      var t = norm(txt), best = null, bestAt = Infinity;
      byLen.forEach(function (n) {
        var at = t.indexOf(n);
        if (at === -1) return;
        // Skip a hit that is only part of a longer, already-found number.
        if (best && best.indexOf(n) !== -1 && at >= bestAt && at < bestAt + best.length) return;
        if (at < bestAt) { best = n; bestAt = at; }
      });
      if (best) current = best;
      // A page with its own "Order Number" heading but no order we know is
      // some other order's slip (not in this CSV), not a continuation.
      else if (/ORDER(NUMBER|#|NO\.?|ID):?/.test(t)) current = null;
      if (current) (pages[current] = pages[current] || []).push(i);
      else unmatched.push(i);
    });
    var missing = nums.filter(function (n) { return !pages[n]; });
    return { pages: pages, unmatched: unmatched, missing: missing, key: norm };
  }

  /* Laying a TCGplayer slip (a letter page) onto 4x6 thermal labels.
     `box` is the slip's content area [x0, y0, x1, y1] in PDF points (from
     the text positions), so empty page margins don't shrink the text. The
     whole slip is fitted onto one label, centered, unless that would shrink
     the text below half size. Then it's set at half size (or the label's width) and continues on the next: each chunk says where to draw the scaled page
     (x, y) so its slice sits under the label's top margin, and how much of
     the label (h) that slice fills. `lines` ([bottom, top] of each text
     line, optional) moves each break up into a gap between lines, so no
     card line is cut in half. */
  function thermalSlipPlan(box, pageW, pageH, margin, lines, opts) {
    pageW = pageW || 432; pageH = pageH || 288; margin = margin == null ? 10 : margin;
    var w = Math.max(1, box[2] - box[0]), h = Math.max(1, box[3] - box[1]);
    var usableW = pageW - 2 * margin, usableH = pageH - 2 * margin;
    // Fit the whole slip on one label, centered. ({split: true} instead
    // keeps text at half size or more and continues onto more labels.)
    var fitW = Math.min(usableW / w, 1.4), fitAll = Math.min(fitW, usableH / h);
    // One slip page always prints on exactly one label (customer request:
    // no thermal paper wasted on continuations), however long its card list.
    var scale = opts && opts.split ? (fitAll >= 0.5 ? fitAll : Math.min(fitW, 0.5)) : fitAll, span = usableH / scale;
    var x = margin + (usableW - w * scale) / 2 - box[0] * scale;
    var chunks = [], top = box[3];
    function chunk(bottom) {
      chunks.push({ x: x, y: pageH - margin - top * scale, h: (top - bottom) * scale });
      top = bottom;
    }
    while (chunks.length < 200) {
      var cut = top - span;
      if (cut <= box[1] + 1e-6) { chunk(box[1]); break; }
      for (var moved = true; moved && lines;) {
        moved = false;
        for (var i = 0; i < lines.length; i++) {
          // Never give up more than a quarter of a label to a clean break.
          if (lines[i][0] < cut && lines[i][1] > cut && lines[i][1] < top - span * 0.75) { cut = lines[i][1]; moved = true; }
        }
      }
      chunk(cut);
    }
    return { scale: scale, chunks: chunks, pageW: pageW, pageH: pageH, margin: margin };
  }


  /* ── Label text ── */

  // US territories and military mail are domestic for USPS: no country line.
  var DOMESTIC = ['us', 'usa', 'united states', 'united states of america', 'u.s.', 'u.s.a.', 'pr', 'puerto rico', 'gu', 'guam', 'vi', 'as', 'mp'];
  // International mail should end with the country name in capitals. "CA"
  // alone reads as California, so spell out the codes TCGplayer uses.
  var COUNTRY_NAMES = { ca: 'CANADA', gb: 'UNITED KINGDOM', uk: 'UNITED KINGDOM', au: 'AUSTRALIA', nz: 'NEW ZEALAND', ie: 'IRELAND',
    de: 'GERMANY', fr: 'FRANCE', it: 'ITALY', es: 'SPAIN', nl: 'NETHERLANDS', be: 'BELGIUM', ch: 'SWITZERLAND', at: 'AUSTRIA',
    se: 'SWEDEN', no: 'NORWAY', dk: 'DENMARK', fi: 'FINLAND', pl: 'POLAND', pt: 'PORTUGAL', jp: 'JAPAN', kr: 'SOUTH KOREA',
    sg: 'SINGAPORE', hk: 'HONG KONG', tw: 'TAIWAN', mx: 'MEXICO', br: 'BRAZIL', il: 'ISRAEL', ae: 'UNITED ARAB EMIRATES', ph: 'PHILIPPINES' };
  function countryLine(c) {
    c = String(c || '').trim();
    if (!c || DOMESTIC.indexOf(c.toLowerCase()) !== -1) return '';
    return COUNTRY_NAMES[c.toLowerCase()] || c.toUpperCase();
  }

  function addrLines(o) {
    var lines = [];
    if (o.addr1) lines.push(o.addr1);
    if (o.addr2) lines.push(o.addr2);
    var csz = [o.city, o.state].filter(Boolean).join(', ') + (o.zip ? ' ' + o.zip : '');
    if (csz.trim()) lines.push(csz.trim());
    var c = countryLine(o.country);
    if (c) lines.push(c);
    return lines;
  }

  function fullName(o) { return ((o.firstName || '') + ' ' + (o.lastName || '')).trim(); }

  // The QR link a Premium user prints on packing slips. TCGplayer's
  // Marketplace Seller Agreement bans slips, links or messages that send
  // buyers to an outside website (Pro web-store orders excepted), so a link
  // that leaves tcgplayer.com is flagged in the Design Studio. Returns null
  // (fine or empty), 'offsite', or 'invalid'.
  function slipLinkRisk(url) {
    var u = String(url || '').trim();
    if (!u) return null;
    var host;
    try { host = new URL(/^[a-z][a-z0-9+.-]*:/i.test(u) ? u : 'https://' + u).hostname.toLowerCase(); }
    catch (e) { return 'invalid'; }
    if (!host || host.indexOf('.') === -1) return 'invalid';
    return /(^|\.)tcgplayer\.com$/.test(host) ? null : 'offsite';
  }

  // jsPDF's built-in fonts only cover Windows-1252. Anything outside it
  // (e.g. "Łódź", "Đặng", CJK) used to print as garbage on the label — which
  // for an address means a misdelivery. Strip accents where that yields a
  // plain letter; replace what's left with "?" so it is visibly wrong rather
  // than silently mangled.
  var CP1252_EXTRA = '€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ';
  function pdfSafe(s) {
    s = String(s == null ? '' : s);
    var out = '', i, ch, code, base;
    for (i = 0; i < s.length; i++) {
      ch = s[i]; code = ch.charCodeAt(0);
      if (code < 0x100 || CP1252_EXTRA.indexOf(ch) !== -1) { out += ch; continue; }
      if (code >= 0xD800 && code <= 0xDBFF) {
        // Astral plane: almost always an emoji, which is decoration, so drop
        // it. A real letter out there (rare CJK) still shows as "?".
        var pair = s.slice(i, i + 2); i++;
        out += isLetter(pair) ? '?' : '';
        continue;
      }
      base = ch.normalize ? ch.normalize('NFD').replace(/[̀-ͯ]/g, '') : ch;
      if (base.length && base.charCodeAt(0) < 0x100) out += base;
      else out += ({ 'ł': 'l', 'Ł': 'L', 'đ': 'd', 'Đ': 'D', 'ß': 'ss', 'ı': 'i' })[ch] || (isLetter(ch) ? '?' : '');
    }
    // Dropping symbols can leave doubled or trailing spaces ("Zoë 🎴 O'Brien").
    return out.replace(/ {2,}/g, ' ').replace(/^ | $/g, '');
  }
  var LETTER_RE = null;
  try { LETTER_RE = new RegExp('\\p{L}', 'u'); } catch (e) { /* very old browser: treat all as letters */ }
  function isLetter(ch) { return LETTER_RE ? LETTER_RE.test(ch) : true; }

  // Largest font size (stepping down from `size` to `min`) at which every
  // line fits `maxWidth`, given a measure(text, size) function. Keeps long
  // street names from running off the edge of a label.
  function fitFontSize(lines, size, min, maxWidth, measure) {
    var s = size;
    while (s > min && lines.some(function (l) { return measure(l, s) > maxWidth; })) s -= 0.5;
    return s;
  }

  return {
    readCSVRows: readCSVRows,
    findColumn: findColumn,
    parseCSV: parseCSV,
    parsePastedAddresses: parsePastedAddresses,
    addrLines: addrLines,
    matchSlipPages: matchSlipPages,
    thermalSlipPlan: thermalSlipPlan,
    fullName: fullName,
    pdfSafe: pdfSafe,
    fitFontSize: fitFontSize,
    parseMoney: parseMoney,
    slipLinkRisk: slipLinkRisk,
    shippingTier: shippingTier,
    letterPostage: letterPostage,
    stampPlan: stampPlan,
    pullSheet: pullSheet,
    LETTER_POSTAGE: LETTER_POSTAGE,
    detectCarrier: detectCarrier,
    matchTracking: matchTracking,
    buildTrackingImport: buildTrackingImport,
    buildPirateShipCSV: buildPirateShipCSV,
    MAPS: MAPS
  };
});
