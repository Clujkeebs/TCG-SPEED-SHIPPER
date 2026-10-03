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
  const r = core.parsePastedAddresses('Jane Doe\n456 Oak Ave\nApt 2B\nChicago, IL 60601\n\nBob Roe\n1 Main\nSpringfield IL 62701-1234\nUSA\n\nLost Person\n9 Nowhere Rd');
  check('two good blocks', r.good.length === 2, JSON.stringify(r));
  check('one bad block reported', r.bad.length === 1);
  check('apt line kept as addr2', r.good[0].addr2 === 'Apt 2B');
  check('trailing USA line tolerated', r.good[1].zip === '62701-1234' && r.good[1].state === 'IL');
  check('CRLF input handled', core.parsePastedAddresses('A B\r\n1 St\r\nX, NY 10001').good.length === 1);
  const P = (t) => core.parsePastedAddresses(t);
  check('addresses without blank lines between them', P('Jane Doe\n456 Oak Ave\nChicago, IL 60601\nBob Roe\n1 Main St\nSpringfield IL 62701').good.length === 2);
  const eb = P('Ship to\nJohn Smith\n123 Elm Street\nUnit 4\nAustin, TX 78701-1234\nUnited States\n(512) 555-1234\njohn@example.com');
  check('eBay copy: labels, country, phone and email ignored', eb.good.length === 1 && eb.bad.length === 0 && eb.good[0].firstName === 'John' && eb.good[0].addr2 === 'Unit 4', JSON.stringify(eb));
  const one = P('Jane Doe, 456 Oak Ave, Apt 2B, Chicago, IL 60601');
  check('one-line address', one.good.length === 1 && one.good[0].addr1 === '456 Oak Ave' && one.good[0].addr2 === 'Apt 2B' && one.good[0].city === 'Chicago');
  check('full state name', P('Maria Lopez\n77 Sunset Blvd\nLos Angeles, California, 90028').good[0].state === 'CA');
  check('ZIP on its own line', P('Sam Lee\n9 Pine Rd\nPortland, OR\n97201').good[0].zip === '97201');
  const tab = P('Name\tAddress\tCity\tState\tZip\nAmy Wu\t12 Bay St\tBoston\tMA\t2108');
  check('spreadsheet row, header skipped, lost leading zero restored', tab.good.length === 1 && tab.bad.length === 0 && tab.good[0].zip === '02108', JSON.stringify(tab));
  const junk = P('Order #12345\n1x Charizard ex\n$12.50\nLiam Gray\n5 Oak Ct\nReno, NV 89501');
  check('order lines and card lines are not names', junk.good.length === 1 && junk.good[0].firstName === 'Liam', JSON.stringify(junk));
  check('all-lowercase is capitalized', P('emma stone\n10 main st\ndallas, tx 75201').good[0].lastName === 'Stone');
  check('Canadian address', P('Leo Chen\n100 King St W\nToronto, ON M5H 1A1\nCanada').good[0].country === 'CA');
  const left = P('Jane Doe\n456 Oak Ave\nChicago IL\n\nGood Guy\n1 St\nNew York, NY 10001');
  check('an incomplete address is reported, not dropped', left.good.length === 1 && left.bad.length === 1);
  const tcg = P('Order Number: 2D7A1B3C-4E5F6A-7B8C9\nOrder Date: 10/02/2026\nBuyer Name: John Smith\nShipping Address\nJohn Smith\n123 Main St\nSpringfield, IL 62701\nUnited States\nPikachu - Base Set - Near Mint\n1\n$1.23');
  check('TCGplayer order page: only the address is used, card lines ignored', tcg.good.length === 1 && tcg.bad.length === 0 && tcg.good[0].firstName === 'John' && tcg.good[0].addr1 === '123 Main St', JSON.stringify(tcg));
  const us = P('John Smith, 123 Main St, Springfield, IL 62701, US');
  check('one-line address ending in a country', us.good.length === 1 && us.good[0].zip === '62701');
  const nc = P('Jane Doe 456 Oak Ave Apt 2 Chicago IL 60601');
  check('one-line address with no commas', nc.good.length === 1 && nc.good[0].addr1 === '456 Oak Ave Apt 2' && nc.good[0].city === 'Chicago', JSON.stringify(nc));
  check('name and street on one line', P('Ann Lee 77 Pine Ct\nReno, NV 89501').good[0].addr1 === '77 Pine Ct');
  check('a name like "Price Walker" is not mistaken for a price label', P('Price Walker\n5 Main St\nWaco, TX 76701').good[0].firstName === 'Price');
  check('card names above an address are not the name', P('Charizard ex - Obsidian Flames\nBen Fox\n12 Rose Ln\nMesa, AZ 85201').good[0].firstName === 'Ben');
}

section('Product weight parsing edge cases');
{
  const csv = ['Order #,FirstName,LastName,Address1,City,State,PostalCode,Product Name,Quantity,Product Weight',
    'W-1,Ann,Lee,1 A St,Reno,NV,89501,Card A,1,0.2',
    'W-1,Ann,Lee,1 A St,Reno,NV,89501,Card B,1,(0.1)',
    'W-2,Bo,Kim,2 B St,Reno,NV,89501,Card C,1,0'].join('\n');
  const o = core.parseCSV(csv);
  check('a negative line weight does not reduce the order total', o[0].productWeight === 0.2, String(o[0].productWeight));
  check('a zero weight leaves the order without a weight', o[1].productWeight === null, String(o[1].productWeight));
}

section('Pull sheet');
{
  const csv = ['Order #,FirstName,LastName,Address1,City,State,PostalCode,Product Name,Set Name,Condition,Quantity',
    'P-1,Ann,Lee,1 A St,Reno,NV,89501,Pikachu,Base Set,Near Mint,2',
    'P-1,Ann,Lee,1 A St,Reno,NV,89501,Charizard,Base Set,Lightly Played,1',
    'P-2,Bo,Kim,2 B St,Reno,NV,89501,pikachu,Base Set,Near Mint,1',
    'P-2,Bo,Kim,2 B St,Reno,NV,89501,Pikachu,Jungle,Near Mint,1',
    'P-3,Cy,Oh,3 C St,Reno,NV,89501,Abra,Base Set,Near Mint,1'].join('\n');
  const orders = core.parseCSV(csv);
  check('set and condition columns are read', orders[0].lines[0].set === 'Base Set' && orders[0].lines[0].condition === 'Near Mint');
  check('item names are unaffected by the new columns', orders[0].items[0] === '2× Pikachu', orders[0].items[0]);
  const ps = core.pullSheet(orders);
  const pika = ps.rows.find((r) => r.name.toLowerCase() === 'pikachu' && r.set === 'Base Set');
  check('same card + set + condition merges across orders (case-insensitive)', pika && pika.qty === 3 && pika.orders.join(',') === 'P-1,P-2', JSON.stringify(pika));
  check('same name in a different set stays separate', ps.rows.filter((r) => r.name.toLowerCase() === 'pikachu').length === 2);
  check('sorted by set, then name', ps.rows.map((r) => r.set + ':' + r.name).join('|') === 'Base Set:Abra|Base Set:Charizard|Base Set:Pikachu|Jungle:Pikachu', ps.rows.map((r) => r.set + ':' + r.name).join('|'));
  check('total card count', ps.totalCards === 6);
  const v = core.parseCSV(['Order #,FirstName,LastName,Address1,City,State,PostalCode,Product Name,Set Name,Condition,Quantity',
    'V-1,Ann,Lee,1 A St,Reno,NV,89501,Pikachu,Base Set,Near Mint,1',
    'V-1,Ann,Lee,1 A St,Reno,NV,89501,Pikachu,Jungle,Near Mint,1',
    'V-1,Ann,Lee,1 A St,Reno,NV,89501,Bolt,M10,Lightly Played,1',
    'V-1,Ann,Lee,1 A St,Reno,NV,89501,Bolt,M10,Lightly Played Foil,1',
    'V-2,Bo,Kim,2 B St,Reno,NV,89501,Bolt,M10,Lightly Played,3'].join('\n'));
  const vs = core.pullSheet(v);
  check('same-name variants in one order both reach the pull sheet', vs.rows.filter((r) => r.name === 'Pikachu').length === 2, JSON.stringify(vs.rows.map((r) => r.name + '/' + r.set)));
  check('foil condition stays a separate row with its full name', vs.rows.some((r) => r.condition === 'Lightly Played Foil'));
  const bolt = vs.rows.find((r) => r.name === 'Bolt' && r.condition === 'Lightly Played');
  check('per-order split is kept ("V-1, V-2 ×3")', bolt && bolt.qty === 4 && bolt.orderText === 'V-1, V-2 ×3', bolt && bolt.orderText);
  check('display item labels still dedupe', v[0].items.filter((x) => x === 'Pikachu').length === 1);
  const ship = core.parseCSV('Order #,FirstName,LastName,Address1,City,State,PostalCode,Item Count\nS-1,A,B,1 St,X,NV,89501,3');
  check('an order-level export (no product names) gives an empty pull sheet', core.pullSheet(ship).rows.length === 0);
}

section('Stamp plan for envelope orders');
{
  const env = (w) => ({ orderValue: 5, productWeight: w });
  const orders = [env(0.2), env(0.9), env(3.4), { orderValue: 60, productWeight: 0.1 }, env(null)];
  let p = core.stampPlan(orders, null);
  check('no packaging weight → no totals yet', p.needsPackaging === true && p.letters === 0 && p.total === 0);
  check('orders missing a weight are counted', p.noWeight === 1);
  p = core.stampPlan(orders, 0.5);
  check('tracked orders are left out', p.perOrder[3] === null);
  check('0.2 + 0.5 oz → 1 oz letter', p.perOrder[0] && p.perOrder[0].addlOunce === 0);
  check('0.9 + 0.5 oz → 2 oz letter (1 additional ounce)', p.perOrder[1] && p.perOrder[1].addlOunce === 1);
  check('3.4 + 0.5 oz → over 3.5 oz, not a letter', p.perOrder[2] && p.perOrder[2].notLetter === true && p.notLetter === 1);
  const one = core.letterPostage(0.7), two = core.letterPostage(1.4);
  check('batch totals add up', p.letters === 2 && p.forever === 2 && p.addlOunce === 1 && p.total === Math.round((one.price + two.price) * 100) / 100, JSON.stringify(p));
  p = core.stampPlan([env(0.2)], 0.5, { nonmachinable: true });
  check('rigid envelopes add the nonmachinable surcharge', p.nonmachinable === 1 && p.total === core.letterPostage(0.7, { nonmachinable: true }).price);
  check('negative packaging weight is ignored', core.stampPlan([env(0.2)], -1).needsPackaging === true);
  check('float noise: 0.5 + 0.5 is exactly 1 oz, not 2', core.stampPlan([env(0.5)], 0.5).perOrder[0].addlOunce === 0);
}

section('Slip QR link vs TCGplayer seller agreement');
{
  const r = core.slipLinkRisk;
  check('empty is fine', r('') === null && r('   ') === null && r(null) === null);
  check('tcgplayer.com store link is fine', r('https://www.tcgplayer.com/search/all/product?seller=abc') === null);
  check('tcgplayer.com without scheme is fine', r('tcgplayer.com/sellers/abc') === null);
  check('subdomain of tcgplayer.com is fine', r('https://shop.tcgplayer.com/x') === null);
  check('own website is offsite', r('https://mycardshop.com') === 'offsite');
  check('look-alike host is offsite', r('https://tcgplayer.com.evil.io/x') === 'offsite' && r('https://nottcgplayer.com') === 'offsite');
  check('bare word is invalid', r('mystore') === 'invalid');
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
  check('emoji is dropped, not printed as ?', core.pdfSafe('A😀B') === 'AB', core.pdfSafe('A😀B'));
  check('emoji between words leaves one space', core.pdfSafe("Zoë 🎴 O'Brien") === "Zoë O'Brien", core.pdfSafe("Zoë 🎴 O'Brien"));
  check('symbols like ★ are dropped', core.pdfSafe('Card ★ Shop') === 'Card Shop', core.pdfSafe('Card ★ Shop'));
  check('Canada prints as CANADA', core.addrLines({ addr1: '1 Rue', city: 'Montréal', state: 'QC', zip: 'H2X 3K8', country: 'CA' }).pop() === 'CANADA');
  check('unknown country code is uppercased', core.addrLines({ addr1: '1 St', city: 'X', country: 'za' }).pop() === 'ZA');
    // TCGplayer packing-slip PDF pages → orders (by order number in the text)
  const m = core.matchSlipPages([
    'Packing Slip  Order Number: 1A2B3C4D-5E6F7A-8B9C0  Ship to Jo Test  1 x Charizard ex',
    'continued: 1 x Pikachu',
    'Order Number: 9F8E7D6C-\n5B4A3F-2E1D0',
    'Order Number: SHORT-12345',
  ], ['1A2B3C4D-5E6F7A-8B9C0', '9F8E7D6C-5B4A3F-2E1D0', 'SHORT-1234', 'SHORT-12345', 'NOT-IN-PDF-999']);
  check('slip page matched to its order', JSON.stringify(m.pages['1A2B3C4D-5E6F7A-8B9C0']) === '[0,1]', JSON.stringify(m.pages));
  check('number split across lines still matches', JSON.stringify(m.pages['9F8E7D6C-5B4A3F-2E1D0']) === '[2]');
  check('longer number wins over its prefix', JSON.stringify(m.pages['SHORT-12345']) === '[3]' && !m.pages['SHORT-1234']);
  check('orders with no slip are reported', m.missing.indexOf('NOT-IN-PDF-999') !== -1 && m.missing.indexOf('SHORT-1234') !== -1);
  const m2 = core.matchSlipPages(['cover page', 'Order ABC-0001'], ['ABC-0001']);
  const m3 = core.matchSlipPages(['Order Number: ABC-0001', 'cont.', 'Order Number: ZZZ-9999', 'more of ZZZ'], ['ABC-0001']);
  check('another order\'s slip is not glued to the previous order', JSON.stringify(m3.pages['ABC-0001']) === '[0,1]' && JSON.stringify(m3.unmatched) === '[2,3]', JSON.stringify(m3));
  check('a leading page with no order is unmatched', JSON.stringify(m2.unmatched) === '[0]' && JSON.stringify(m2.pages['ABC-0001']) === '[1]');
  // TCGplayer slip → 4x6 thermal pages
  const tp = core.thermalSlipPlan([36, 500, 576, 760], 432, 288, 10);
  check('slip content is scaled to the label width', Math.abs(tp.scale - 412 / 540) < 1e-9, tp.scale);
  check('a short slip fits on one 4x6', tp.chunks.length === 1);
  check('its top lands at the top margin', Math.abs(tp.chunks[0].y + 760 * tp.scale - (288 - 10)) < 1e-9);
  const mid = core.thermalSlipPlan([36, 300, 576, 756], 432, 288, 10);
  check('a slip that fits at half size or more stays on one label', mid.chunks.length === 1 && Math.abs(mid.scale - 268 / 456) < 1e-9, mid.scale);
  check('a fitted slip is centered across the label', Math.abs(mid.chunks[0].x + 36 * mid.scale - (10 + (412 - 540 * mid.scale) / 2)) < 1e-9);
  const full = core.thermalSlipPlan([36, 36, 576, 756], 432, 288, 10);
  check('by default even a full page fits on one label', full.chunks.length === 1 && Math.abs(full.scale - 268 / 720) < 1e-9, full.scale);
  const tall = core.thermalSlipPlan([36, 36, 576, 756], 432, 288, 10, null, { split: true });
  check('with split, a long card list is set at half size and continues on more labels', tall.scale === 0.5 && tall.chunks.length === Math.ceil(720 * 0.5 / 268), tall.chunks.length);
  check('each continuation shifts up by one label height', Math.abs((tall.chunks[1].y - tall.chunks[0].y) - 268) < 1e-9);
  check('each full chunk fills the label between margins', Math.abs(tall.chunks[0].h - 268) < 1e-9);
  // A line straddling the first break (at 756 - 268/scale) moves the break above it.
  const brk = 756 - 268 / tall.scale;
  const snapped = core.thermalSlipPlan([36, 36, 576, 756], 432, 288, 10, [[brk - 4, brk + 8], [brk + 12, brk + 24]], { split: true });
  check('a break never cuts a text line in half', Math.abs(snapped.chunks[0].h - (756 - (brk + 8)) * snapped.scale) < 1e-9, snapped.chunks[0].h);
  check('the next label starts at that line', Math.abs(snapped.chunks[1].y + (brk + 8) * snapped.scale - 278) < 1e-9);
  const tiny = core.thermalSlipPlan([100, 700, 200, 720], 432, 288, 10);
  check('a tiny slip is not blown up past 1.4x', tiny.scale === 1.4);
  check('Puerto Rico gets no country line', core.addrLines({ addr1: '1 Calle', city: 'San Juan', state: 'PR', zip: '00901', country: 'PR' }).pop() === 'San Juan, PR 00901');
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
