import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseOrderExport, readCsvRows, parseDate, mapColumns, MAX_ROWS } from '../src/orders/parser.js';
import { importOrderText, defaultParser } from '../src/orders/index.js';
import { computeInsights, shortName, buyerLabels } from '../src/orders/insights.js';
import { openStore } from '../src/store.js';
import { validateOrder } from '../src/vendor/shared/models.js';
import { plainAnswer } from '../src/agent/friendly.js';
import { makeOrderCsv, HEADER, LAST_NAMES } from './helpers/orders-csv.js';

const sample = readFileSync(fileURLToPath(new URL('../../../public/samples/tcgplayer-sample-shipping-export.csv', import.meta.url)), 'utf8');

test("the Shipper's own sample export reads as valid orders", () => {
  const r = parseOrderExport(sample);
  assert.equal(r.ok, true);
  assert.equal(r.orders.length, 8);
  assert.ok(r.orders.every((o) => validateOrder(o).ok));
  assert.equal(r.orders[0].id, 'SAMPLE-0001');
  assert.equal(r.orders[0].orderedAt, '2026-10-01T12:00:00Z');
  assert.equal(r.orders[0].itemsTotalCents, 650);
  assert.equal(r.orders[0].shippingPaidCents, 99);
});

test('csv reading handles quotes, commas in cells, CRLF, a BOM and blank lines', () => {
  const rows = readCsvRows('﻿a,b,c\r\n1,"x, y","say ""hi"""\r\n\r\n3,4,5');
  assert.deepEqual(rows, [['a', 'b', 'c'], ['1', 'x, y', 'say "hi"'], ['3', '4', '5']]);
});

test('dates: US and ISO forms are read; nonsense is refused', () => {
  assert.equal(parseDate('10/1/2026'), '2026-10-01T12:00:00Z');
  assert.equal(parseDate('2/29/2028 3:45 PM'), '2028-02-29T12:00:00Z');
  assert.equal(parseDate('2026-10-05T01:02:03Z'), '2026-10-05T12:00:00Z');
  for (const bad of ['', 'yesterday', '13/1/2026', '2/30/2026', '1/1/1999', '10/1/26', null, undefined]) assert.equal(parseDate(bad), null, String(bad));
});

test('headers are matched loosely and the wrong file is explained in plain words', () => {
  assert.equal(mapColumns(['order number', 'ZIP', 'Name']).postalCode, 1);
  const wrong = parseOrderExport('Product Name,Quantity,Set\nSome Card,2,Some Set\n');
  assert.equal(wrong.ok, false);
  assert.match(wrong.error, /order \(shipping\) export, not the pull sheet/);
  assert.equal(parseOrderExport('').ok, false);
  assert.equal(parseOrderExport('only a header').ok, false);
  assert.equal(parseOrderExport(undefined).ok, false);
});

test('bad rows are skipped and counted, not fatal; duplicates are caught', () => {
  const csv = [HEADER, 'A1,Ada,Alder,1 St,,Town,CA,90000,US,10/1/2026,0.1,x,1,5.00,0.99,,', 'A2,Bram,Birch,2 St,,Town,CA,90000,US,not a date,0.1,x,1,5.00,0.99,,', 'A1,Cleo,Cobb,3 St,,Town,CA,90000,US,10/2/2026,0.1,x,1,5.00,0.99,,', 'A4,Dax,Dunmore,4 St,,Town,CA,90000,US,10/3/2026,0.1,x,1,five dollars,0.99,,'].join('\n');
  const r = parseOrderExport(csv);
  assert.equal(r.ok, true);
  assert.equal(r.orders.length, 1);
  assert.deepEqual(r.skipped.map((s) => [s.row, s.reason]), [[3, 'unreadable order date'], [4, 'order number appears twice'], [5, 'unreadable amount']]);
});

test('hostile cells stay plain data (no markup is ever interpreted here)', () => {
  const csv = [HEADER, 'A1,"<img src=x onerror=alert(1)>",=cmd|calc,1 St,,Town,CA,90000,US,10/1/2026,0.1,x,1,5.00,0.99,,'].join('\n');
  const r = parseOrderExport(csv);
  assert.equal(r.ok, true);
  assert.equal(r.orders[0].shipTo.name, '<img src=x onerror=alert(1)> =cmd|calc'); // stored as text; the UI only ever uses textContent
});

test('a file with too many rows is refused kindly', () => {
  const big = HEADER + '\n' + 'A,B,C,1 St,,T,CA,9,US,10/1/2026,0,x,1,1.00,0,,\n'.repeat(MAX_ROWS + 5);
  const r = parseOrderExport(big);
  assert.equal(r.ok, false);
  assert.match(r.error, /more than 20,000 orders/);
});

test('2,000 invented orders: read fast, valid, saved in one go, and the numbers are right', async () => {
  const csv = makeOrderCsv(2000);
  const t0 = performance.now();
  const store = await openStore({ indexedDB: undefined });
  const res = await importOrderText(csv, { save: (orders) => store.replaceAll('orders', orders) });
  const ms = performance.now() - t0;
  assert.equal(res.ok, true);
  assert.equal(res.orders.length, 2000);
  assert.equal(res.skipped.length, 0);
  assert.ok(ms < 1500, `took ${ms.toFixed(0)} ms`);
  assert.equal((await store.list('orders')).length, 2000);
  const ins = computeInsights(res.orders);
  assert.equal(ins.orders, 2000);
  assert.equal(ins.to, '2026-10-10');
  assert.ok(ins.states.length === 5 && ins.states[0].orders >= ins.states[4].orders);
  assert.equal(ins.weekdays.reduce((s, d) => s + d.orders, 0), 2000);
  assert.ok(ins.thisWeek.orders > 0 && ins.lastWeek.orders > 0);
  assert.ok(ins.averageOrderCents > 100 && ins.averageOrderCents < 4100);
  // buyers: first name and last initial only
  assert.ok(ins.repeat.top.length === 5);
  for (const b of ins.repeat.top) {
    assert.match(b.label, /^[A-Z][a-z]+ [A-Z]\.$/, b.label);
    for (const last of LAST_NAMES) assert.ok(!b.label.includes(last), 'no full last names');
  }
  const dump = JSON.stringify(ins);
  assert.ok(!dump.includes('Example St'), 'no street addresses in the insights');
  for (const zip of ['62701', '97201', '78701', '80201', '02108', '33601', '85001', '53701']) assert.ok(!dump.includes(`"${zip}"`), 'no postal codes in the insights');
});

test('replacing the orders replaces them (a second import does not pile up) and one bad record changes nothing', async () => {
  const store = await openStore({ indexedDB: undefined });
  const a = parseOrderExport(makeOrderCsv(50, { seed: 1 })).orders;
  const b = parseOrderExport(makeOrderCsv(20, { seed: 2 })).orders;
  await store.replaceAll('orders', a);
  await store.replaceAll('orders', b);
  assert.equal((await store.list('orders')).length, 20);
  await assert.rejects(store.replaceAll('orders', [...a, { id: 'x' }]));
  assert.equal((await store.list('orders')).length, 20, 'a failed import leaves the old orders alone');
});

test('another reader can drop in behind the same interface', async () => {
  const other = { name: 'agent-fast', parse: () => ({ ok: true, orders: parseOrderExport(sample).orders.slice(0, 2), skipped: [], rows: 2 }) };
  const saved = [];
  const r = await importOrderText('ignored', { parser: other, save: async (o) => saved.push(o.length) });
  assert.deepEqual([r.ok, r.parser, saved], [true, 'agent-fast', [2]]);
  assert.equal((await importOrderText('x', { parser: { name: 'broken', parse: () => 5 } })).ok, false);
  assert.equal(defaultParser.name, 'extension-basic');
  let called = false;
  await importOrderText('', { save: () => { called = true; } });
  assert.equal(called, false, 'nothing is saved when reading failed');
});

test('names: first name and last initial; labels map buyer keys', () => {
  assert.equal(shortName('Ada Alder'), 'Ada A.');
  assert.equal(shortName('Mary Ann van der Berg'), 'Mary B.');
  assert.equal(shortName('Cher'), 'Cher');
  assert.equal(shortName(''), 'A buyer');
  const orders = parseOrderExport(sample).orders;
  const labels = buyerLabels(orders);
  assert.equal(labels.get(orders[0].buyerKey), 'Sample B.');
});

test("the Agent's report becomes plain bullets and buyer keys become names", () => {
  const report = 'Goal: x\nPlan:\n1. a\n\nWhat happened:\n1. done: 8 of 70 buyers ordered more than once\n2. waiting-approval: waiting for your OK (card card-1)\n3. skipped: skipped because s2 is waiting for your OK';
  const out = plainAnswer(report);
  assert.equal(out, '✓ 8 of 70 buyers ordered more than once\n⏳ Waiting for your OK (see the card below)\nSkipped: skipped because s2 is waiting for your OK');
  assert.equal(plainAnswer('top: b-1a2b3c and buyer-004', (k) => (k === 'b-1a2b3c' ? 'Ada A.' : undefined)), 'top: Ada A. and a buyer');
  assert.equal(plainAnswer(''), 'Done.');
});
