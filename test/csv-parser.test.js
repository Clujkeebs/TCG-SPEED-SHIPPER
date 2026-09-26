/* Exercises public/js/shipper-core.js — the exact parser the browser uses to
   turn a TCGplayer export into labels. A parsing bug here prints a wrong
   address on a real package, so the tricky real-world shapes are pinned. */
const core = require('../public/js/shipper-core.js');

let passed = 0, failed = 0;
function check(name, cond, extra) {
  if (cond) { passed++; console.log('  PASS  ' + name); }
  else { failed++; console.log('  FAIL  ' + name + (extra ? '  — ' + extra : '')); }
}
function section(t) { console.log('\n-- ' + t + ' --'); }

section('TCGplayer shipping export');
{
  const csv = [
    'Order #,FirstName,LastName,Address1,Address2,City,State,PostalCode,Country,Order Date,Product Weight,Shipping Method,Item Count,Value Of Products,Shipping Fee Paid,Tracking #,Carrier',
    'ABC123-1,Jane,Doe,456 Oak Ave,Apt 2B,Chicago,IL,60601,US,9/20/2026,0.12,Standard (7-10 days),3,4.50,0.99,,',
    'ABC123-2,John,"Smith, Jr.",789 Pine Rd,,Austin,TX,73301-1234,US,9/20/2026,0.5,Expedited,12,55.00,5.99,,',
  ].join('\r\n');
  const orders = core.parseCSV(csv);
  check('parses two orders', Array.isArray(orders) && orders.length === 2, JSON.stringify(orders));
  check('order number comes from "Order #"', orders[0].orderNumber === 'ABC123-1');
  check('quoted comma inside a field is kept', orders[1].lastName === 'Smith, Jr.');
  check('"Product Weight" is NOT treated as an item name', orders[0].items.length === 0, JSON.stringify(orders[0].items));
  check('"Item Count" is read as a count', orders[0].itemCount === 3 && orders[1].itemCount === 12);
  check('shipping method captured', orders[1].shipMethod === 'Expedited');
  check('ZIP+4 preserved', orders[1].zip === '73301-1234');
  check('US country is not printed', core.addrLines(orders[0]).indexOf('US') === -1);
}

section('Header order does not fool column matching');
{
  const csv = 'Order Date,Order #,First Name,Last Name,Address 1,City,State,Zip\n2026-09-01,X-9,Ann,Lee,1 Main St,Boise,ID,83702';
  const orders = core.parseCSV(csv);
  check('exact "Order #" beats earlier "Order Date"', orders[0].orderNumber === 'X-9', orders[0].orderNumber);
}

section('Item-level export (one row per card)');
{
  const csv = [
    'Order Number,Buyer Name,Address 1,City,State,Postal Code,Product Name,Quantity',
    '1001,Sam Q Public,10 Elm St,Dover,DE,19901,Lightning Bolt,4',
    '1001,Sam Q Public,10 Elm St,Dover,DE,19901,"Black Lotus ""Alpha""",1',
    '1002,Kim Park,22 Birch Ln,Salem,OR,97301,Pikachu,1',
  ].join('\n');
  const orders = core.parseCSV(csv);
  check('rows grouped by order', orders.length === 2);
  check('full name split into first/last', orders[0].firstName === 'Sam' && orders[0].lastName === 'Q Public');
  check('quantity shown on the item', orders[0].items[0] === '4× Lightning Bolt', orders[0].items[0]);
  check('escaped quotes decoded', orders[0].items[1] === 'Black Lotus "Alpha"', orders[0].items[1]);
  check('item count sums quantities', orders[0].itemCount === 5);
}

section('Messy files');
{
  const bom = '﻿First Name,Last Name,Address 1,City,State,Zip\nA,B,"1 Line\nBreak St",X,NY,10001\n\n';
  const o = core.parseCSV(bom);
  check('BOM stripped and header still recognised', Array.isArray(o) && o.length === 1, JSON.stringify(o));
  check('line break inside a quoted field does not split the row', o[0].addr1 === '1 Line\nBreak St' && o[0].city === 'X');

  const pull = core.parseCSV('Product Line,Product Name,Set,Quantity\nMagic,Bolt,M10,1');
  check('pull sheet (no addresses) gives a helpful error', pull.error && /pull sheet/.test(pull.error));
  check('empty file gives an error', !!core.parseCSV('').error);
  check('blank-name rows are skipped', core.parseCSV('First Name,Last Name,Address 1\n,,1 St\nA,B,2 St').length === 1);
}

section('Pasted addresses');
{
  const r = core.parsePastedAddresses('Jane Doe\n456 Oak Ave\nApt 2B\nChicago, IL 60601\n\nBob Roe\n1 Main\nSpringfield IL 62701-1234\nUSA\n\nbad block');
  check('two good blocks', r.good.length === 2, JSON.stringify(r));
  check('one bad block reported', r.bad.length === 1);
  check('apt line kept as addr2', r.good[0].addr2 === 'Apt 2B');
  check('trailing USA line tolerated', r.good[1].zip === '62701-1234' && r.good[1].state === 'IL');
  check('CRLF input handled', core.parsePastedAddresses('A B\r\n1 St\r\nX, NY 10001').good.length === 1);
}

section('PDF-safe text');
{
  check('Latin-1 accents untouched', core.pdfSafe('José Müller') === 'José Müller');
  check('non-Latin-1 accents stripped to base letter', core.pdfSafe('Nguyễn') === 'Nguyen', core.pdfSafe('Nguyễn'));
  check('Polish ł mapped', core.pdfSafe('Łódź') === 'Lódz', core.pdfSafe('Łódź'));
  check('smart quotes kept (in cp1252)', core.pdfSafe('O’Brien') === 'O’Brien');
  check('unmappable becomes ?', core.pdfSafe('東京') === '??');
  check('emoji becomes a single ?', core.pdfSafe('A😀B') === 'A?B');
}

section('Font fitting');
{
  const measure = (t, s) => t.length * s * 0.5;
  check('short lines keep full size', core.fitFontSize(['abc'], 15, 8, 200, measure) === 15);
  const s = core.fitFontSize(['x'.repeat(40)], 15, 8, 200, measure);
  check('long line shrinks until it fits', s < 15 && 40 * s * 0.5 <= 200, String(s));
  check('never below the minimum', core.fitFontSize(['x'.repeat(400)], 15, 8, 200, measure) === 8);
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
