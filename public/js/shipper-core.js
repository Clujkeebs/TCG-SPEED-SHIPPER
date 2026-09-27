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
          orderNumber: onum, shipMethod: get('shipMethod'), itemCount: 0, items: [],
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

  var CITY_STATE_ZIP_RE = /^(.+?),?\s+([A-Za-z]{2})\.?\s+(\d{5}(?:[-\s]?\d{4})?)$/;

  function parsePastedAddresses(text) {
    var blocks = String(text || '').replace(/\r\n?/g, '\n').split(/\n\s*\n/)
      .map(function (b) { return b.trim(); }).filter(Boolean);
    var good = [], bad = [];
    blocks.forEach(function (block) {
      var lines = block.split('\n').map(function (l) { return l.trim(); }).filter(Boolean);
      // A trailing "USA"/"United States" line is common when copying from
      // TCGplayer or eBay; drop it rather than rejecting the whole block.
      if (lines.length > 2 && /^(us|usa|u\.s\.a?\.?|united states( of america)?)$/i.test(lines[lines.length - 1])) lines.pop();
      if (lines.length < 2) { bad.push({ raw: block, error: 'Needs a name line and a "City, ST ZIP" line.' }); return; }
      var last = lines[lines.length - 1];
      var m = last.match(CITY_STATE_ZIP_RE);
      if (!m) { bad.push({ raw: block, error: 'Last line "' + last + '" doesn\'t look like "City, ST ZIP".' }); return; }
      var name = splitName(lines[0]);
      var streetLines = lines.slice(1, lines.length - 1);
      good.push({
        firstName: name.first, lastName: name.last,
        addr1: streetLines[0] || '',
        addr2: streetLines.slice(1).join(', '),
        city: m[1].replace(/,\s*$/, ''), state: m[2].toUpperCase(), zip: m[3].replace(/\s/, '-'),
        country: '', orderNumber: '', shipMethod: '', itemCount: 0, items: [], orderValue: null
      });
    });
    return { good: good, bad: bad };
  }

  /* ── Label text ── */

  var DOMESTIC = ['us', 'usa', 'united states', 'united states of america', 'u.s.', 'u.s.a.'];

  function addrLines(o) {
    var lines = [];
    if (o.addr1) lines.push(o.addr1);
    if (o.addr2) lines.push(o.addr2);
    var csz = [o.city, o.state].filter(Boolean).join(', ') + (o.zip ? ' ' + o.zip : '');
    if (csz.trim()) lines.push(csz.trim());
    var c = o.country;
    if (c && DOMESTIC.indexOf(c.toLowerCase()) === -1) lines.push(c.toUpperCase());
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
      if (code >= 0xD800 && code <= 0xDBFF) { i++; out += '?'; continue; }
      base = ch.normalize ? ch.normalize('NFD').replace(/[̀-ͯ]/g, '') : ch;
      if (base.length && base.charCodeAt(0) < 0x100) out += base;
      else out += ({ 'ł': 'l', 'Ł': 'L', 'đ': 'd', 'Đ': 'D', 'ß': 'ss', 'ı': 'i' })[ch] || '?';
    }
    return out;
  }

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
    fullName: fullName,
    pdfSafe: pdfSafe,
    fitFontSize: fitFontSize,
    parseMoney: parseMoney,
    slipLinkRisk: slipLinkRisk,
    shippingTier: shippingTier,
    letterPostage: letterPostage,
    stampPlan: stampPlan,
    LETTER_POSTAGE: LETTER_POSTAGE,
    detectCarrier: detectCarrier,
    matchTracking: matchTracking,
    buildTrackingImport: buildTrackingImport,
    buildPirateShipCSV: buildPirateShipCSV,
    MAPS: MAPS
  };
});
