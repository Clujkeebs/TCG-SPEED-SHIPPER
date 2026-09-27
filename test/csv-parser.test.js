/* Exercises public/js/shipper-core.js — the exact parser the browser uses to
   turn a TCGplayer export into labels. A parsing bug here prints a wrong
   address on a real package, so the tricky real-world shapes are pinned. */
const core = require('../public/js/shipper-core.js');
const fs = require('fs');
const path = require('path');

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

section('Sample shipping export');
{
  const csv = fs.readFileSync(path.join(__dirname, '..', 'public', 'samples', 'tcgplayer-sample-shipping-export.csv'), 'utf8');
  const orders = core.parseCSV(csv);
  const tiers = { envelope: 0, recommended: 0, tracking: 0, signature: 0 };
  orders.forEach(function (o) { tiers[core.shippingTier(o).tier]++; });
  check('parses 8 sample orders', orders.length === 8, String(orders.length));
  check('sample order tier mix', JSON.stringify(tiers) === JSON.stringify({ envelope: 5, recommended: 1, tracking: 1, signature: 1 }), JSON.stringify(tiers));
  check('leading-zero ZIP is preserved', orders.some(function (o) { return o.zip === '02108'; }));
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

section('Product weight parsing');
{
  const orderLevel = [
    'Order #,First Name,Last Name,Address 1,City,State,Zip,Product Weight,Item Count',
    'A,Ann,Lee,1 St,X,NY,10001,0.25,3',
    'A,Ann,Lee,1 St,X,NY,10001,0.25,3'
  ].join('\n');
  const orderOrders = core.parseCSV(orderLevel);
  check('order-level weight is read once for a repeated order', orderOrders.length === 1 && orderOrders[0].productWeight === 0.25, JSON.stringify(orderOrders));
  check('Product Weight is not detected as an item-name column', core.findColumn(['Product Weight'], core.MAPS.item) === -1);

  const lineLevel = [
    'Order Number,Buyer Name,Address 1,City,State,Postal Code,Product Name,Product Weight,Quantity',
    '1001,Sam Q Public,10 Elm St,Dover,DE,19901,Lightning Bolt,0.1,4',
    '1001,Sam Q Public,10 Elm St,Dover,DE,19901,Black Lotus,0.2,1'
  ].join('\n');
  const lineOrders = core.parseCSV(lineLevel);
  check('line-level weights sum per order', lineOrders.length === 1 && Math.abs(lineOrders[0].productWeight - 0.3) < 1e-10, JSON.stringify(lineOrders));

  const blank = core.parseCSV('Order #,First Name,Last Name,Address 1,Product Weight\nB,Bob,Roe,2 St,');
  check('blank weight stays null', blank[0].productWeight === null);
  const nonnumeric = core.parseCSV('Order #,First Name,Last Name,Address 1,Product Weight\nB,Bob,Roe,2 St,n/a');
  check('nonnumeric weight stays null', nonnumeric[0].productWeight === null);
  const noWeight = core.parseCSV('Order #,First Name,Last Name,Address 1\nC,Cy,Ng,3 St');
  check('missing weight column stays null', noWeight[0].productWeight === null);
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

section('Shipping plan');
{
  const csv = [
    'Order #,FirstName,LastName,Address1,City,State,PostalCode,Shipping Method,Item Count,Value Of Products,Shipping Fee Paid',
    'A,Ann,Lee,1 St,X,NY,10001,Standard,1,$4.50,0.99',
    'B,Bo,Kim,2 St,X,NY,10001,Standard,2,35.00,0.99',
    'C,Cy,Ng,3 St,X,NY,10001,Standard,9,"1,049.99",0.99',
    'D,Di,Ro,4 St,X,NY,10001,Expedited,1,3.00,5.99',
    'E,Ed,Po,5 St,X,NY,10001,Standard,4,49.99,0.99',
  ].join('\n');
  const o = core.parseCSV(csv);
  check('"Value Of Products" parsed, not "Shipping Fee Paid"', o[0].orderValue === 4.5, String(o[0].orderValue));
  check('thousands separator handled', o[2].orderValue === 1049.99);
  check('under $20 → envelope', core.shippingTier(o[0]).tier === 'envelope');
  check('$20–49.98 → tracking recommended', core.shippingTier(o[1]).tier === 'recommended');
  check('$49.99 → tracking required', core.shippingTier(o[4]).tier === 'tracking');
  check('$250+ → signature', core.shippingTier(o[2]).tier === 'signature');
  check('expedited buyer always gets tracking', core.shippingTier(o[3]).tier === 'tracking');
  check('no value, standard → unknown (no guessing)', core.shippingTier({ orderValue: null, shipMethod: 'Standard' }).tier === 'unknown');
  check('parseMoney junk → null', core.parseMoney('n/a') === null && core.parseMoney('') === null);
}

section('Letter postage estimates');
{
  const one = core.letterPostage(1);
  check('1 oz costs $0.82 with no additional ounces', one.price === 0.82 && one.addlOunce === 0, JSON.stringify(one));
  check('result includes one Forever stamp and the effective date', one.forever === 1 && one.effective === core.LETTER_POSTAGE.EFFECTIVE);
  check('0.5 oz costs $0.82', core.letterPostage(0.5).price === 0.82);
  check('2 oz costs $1.11', core.letterPostage(2).price === 1.11);
  check('floating-point noise at 2 oz does not add another ounce', core.letterPostage(2.0000000001).addlOunce === 1);
  check('3 oz costs $1.40', core.letterPostage(3).price === 1.4);
  const max = core.letterPostage(3.5);
  check('3.5 oz costs $1.69 with three additional ounces', max.price === 1.69 && max.addlOunce === 3, JSON.stringify(max));
  check('1.01 oz costs $1.11', core.letterPostage(1.01).price === 1.11);
  const tooHeavy = core.letterPostage(3.51);
  check('3.51 oz is not a letter', tooHeavy.notLetter === true && tooHeavy.oz === 3.51, JSON.stringify(tooHeavy));
  [0, -1, NaN, null, '2'].forEach(function (weight) {
    check(String(weight) + ' oz input is invalid', core.letterPostage(weight) === null);
  });
  const nonmachinable = core.letterPostage(1, { nonmachinable: true });
  check('nonmachinable 1 oz includes a $0.49 surcharge', nonmachinable.price === 1.31 && nonmachinable.surcharge === 0.49 && nonmachinable.postage === 0.82, JSON.stringify(nonmachinable));
  check('LETTER_POSTAGE is frozen', Object.isFrozen(core.LETTER_POSTAGE));
}

section('TCGplayer tracking import file');
{
  const csv = [
    'Order #,FirstName,LastName,Address1,City,State,PostalCode,Value Of Products,Tracking #,Carrier',
    'A,Ann,"Lee, Jr.",1 St,X,NY,10001,4.50,,',
    'B,Bo,Kim,2 St,X,NY,10001,60.00,,',
    'C,Cy,Ng,3 St,X,NY,10001,8.00,,',
  ].join('\r\n');
  check('USPS number detected', core.detectCarrier('9400 1000 0000 0000 0000 00') === 'USPS');
  check('UPS number detected', core.detectCarrier('1Z999AA10123456784') === 'UPS');
  check('FedEx number detected', core.detectCarrier('123456789012') === 'FedEx');
  check('positional matching', core.matchTracking(['111', '222'], ['A', 'B', 'C']).join() === '111,222,');
  check('order-number matching wins, in any order', core.matchTracking(['C 333', 'A 111'], ['A', 'B', 'C']).join() === '111,,333');

  const r = core.buildTrackingImport(csv, { B: '9400100000000000000000' }, { markShipped: true });
  const rows = core.readCSVRows(r.csv);
  check('keeps every original column and header', rows[0].join('|') === 'Order #|FirstName|LastName|Address1|City|State|PostalCode|Value Of Products|Tracking #|Carrier');
  check('tracked order gets number + detected carrier', rows[2][8] === '9400100000000000000000' && rows[2][9] === 'USPS');
  check('untracked orders marked "Shipped"', rows[1][8] === 'Shipped' && rows[3][8] === 'Shipped');
  check('quoted fields survive the round trip', rows[1][2] === 'Lee, Jr.');
  check('CRLF line endings', /\r\n/.test(r.csv));

  const r2 = core.buildTrackingImport(csv, { B: '9400100000000000000000' }, { markShipped: false });
  check('without "mark shipped", untracked orders are left out and reported', r2.included.join() === 'B' && r2.skipped.join() === 'A,C');

  const r3 = core.buildTrackingImport(csv, {}, { markShipped: true });
  check('flags a $49.99+ order marked Shipped without tracking (TCGplayer will reject it)', r3.missingRequired.join() === 'B');

  const noCols = core.buildTrackingImport('Order #,FirstName,LastName,Address1\nA,Ann,Lee,1 St', { A: '1Z999AA10123456784' }, {});
  const nr = core.readCSVRows(noCols.csv);
  check('adds Tracking #/Carrier columns when the export lacks them', nr[0].slice(-2).join() === 'Tracking #,Carrier' && nr[1][4] === '1Z999AA10123456784' && nr[1][5] === 'UPS');
  check('refuses a file with no order numbers', !!core.buildTrackingImport('Name,Address 1\nA,1 St', {}, {}).error);
}

section('Pirate Ship tracked-order export');
{
  const orders = [
    { firstName: 'Ann, "Ace"', lastName: 'Lee', addr1: '1 "Main", Apt', addr2: '', city: 'Boston', state: 'MA', zip: '02108', country: '', orderNumber: 'S1', itemCount: 1 },
    { firstName: 'Bill', lastName: 'One', addr1: '2 Oak St', addr2: 'Suite 4', city: 'Austin', state: 'TX', zip: '73301-1234', country: 'US', orderNumber: 'S2', itemCount: 3 },
    { firstName: 'No', lastName: 'Number', addr1: '3 Elm St', addr2: '', city: 'Reno', state: 'NV', zip: '89501', country: ' ', orderNumber: '', itemCount: 3 }
  ];
  const result = core.buildPirateShipCSV(orders);
  const rows = core.readCSVRows(result.csv);
  check('exact Pirate Ship header', rows[0].join(',') === 'Name,Address,Address Line 2,City,State,Zipcode,Country,Order ID,Rubber Stamp 1', rows[0].join(','));
  check('comma and quote escaping in name and address', result.csv.indexOf('"Ann, ""Ace"" Lee","1 ""Main"", Apt"') !== -1, result.csv);
  check('blank address line 2 stays empty', rows[1][2] === '');
  check('blank country defaults to US', rows[1][6] === 'US' && rows[3][6] === 'US');
  check('ZIP+4 and leading-zero ZIP are preserved', rows[1][5] === '02108' && rows[2][5] === '73301-1234');
  check('count matches the input', result.count === orders.length, String(result.count));
  check('one-item stamp', rows[1][8] === 'TCGplayer S1 · 1 item', rows[1][8]);
  check('three-item stamp', rows[2][8] === 'TCGplayer S2 · 3 items', rows[2][8]);
  check('item stamp works without an order number', rows[3][8] === '3 items', rows[3][8]);
}

section('CSV formula injection');
{
  const csv = 'Order #,FirstName,LastName,Address1,City,State,PostalCode,Value Of Products,Tracking #,Carrier\n' +
    'A,"=HYPERLINK(""http://x"")",Lee,@SUM(1),X,NY,10001,-5.00,,';
  const out = core.readCSVRows(core.buildTrackingImport(csv, { A: '9400100000000000000000' }, {}).csv);
  check('a formula-looking name is neutralised', out[1][1] === "'=HYPERLINK(\"http://x\")", out[1][1]);
  check('a leading @ is neutralised', out[1][3] === "'@SUM(1)", out[1][3]);
  check('plain negative numbers are left alone', out[1][7] === '-5.00', out[1][7]);
  check('normal values untouched', out[1][2] === 'Lee' && out[1][8] === '9400100000000000000000');
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
