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
    shipMethod:  { names: ['shipping method', 'ship method', 'shipping type', 'shipping service'] }
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
          orderNumber: onum, shipMethod: get('shipMethod'), itemCount: 0, items: []
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
    }
    return orderList;
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
        country: '', orderNumber: '', shipMethod: '', itemCount: 0, items: []
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
    MAPS: MAPS
  };
});
