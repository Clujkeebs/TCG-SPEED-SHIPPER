import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCsvParser, parseDate, parseMoney, mapColumns, analyzeOrderFile, fillBuyerNames, BUYER_PLACEHOLDER } from './orderfile.js';
import { makeShippingExportCsv, SHIPPING_HEADER } from './fixtures/shipping-export.js';
import { makeWorld } from './eval/harness.js';
import { seededRandom } from './fixtures/orders.js';

// The written-down budget for 10,000 invented rows (about 1 MB): measured on a small cloud machine at 130 ms and
// 9 MB of memory growth; the limits below leave a wide margin for slower machines.
export const BUDGET = { rows: 10000, maxMs: 1500, maxRssGrowthMB: 100 };

function rowsOf(text, chunker) {
  const rows = [];
  const p = createCsvParser((r) => rows.push(r));
  chunker(text, (c) => p.push(c));
  p.end();
  return rows;
}

test('streaming parser: quotes, commas, doubled quotes, CRLF, blank lines, BOM', () => {
  const text = '﻿a,b,c\r\n1,"x, y","say ""hi"""\r\n\r\n2,,"multi\nline"\n3,z,';
  const whole = rowsOf(text, (t, push) => push(t));
  assert.deepEqual(whole, [['a', 'b', 'c'], ['1', 'x, y', 'say "hi"'], ['2', '', 'multi\nline'], ['3', 'z', '']]);
});

test('same rows however the text is cut into chunks (even in the middle of a quote pair or a CRLF)', () => {
  const text = makeShippingExportCsv({ rows: 300, seed: 5 }).replace('Alder', 'Al"""der, "Jr."') ;
  const expected = rowsOf(text, (t, push) => push(t));
  const rand = seededRandom(9);
  for (let trial = 0; trial < 25; trial += 1) {
    const got = rowsOf(text, (t, push) => { for (let i = 0; i < t.length;) { const n = 1 + Math.floor(rand() * 40); push(t.slice(i, i + n)); i += n; } });
    assert.deepEqual(got, expected, 'trial ' + trial);
  }
  assert.deepEqual(rowsOf('a,"b""', (t, push) => { for (const ch of t) push(ch); }), [['a', 'b"']]);
  assert.deepEqual(rowsOf('x\r\ny\r\n', (t, push) => { for (const ch of t) push(ch); }), [['x'], ['y']]);
});

test('hostile input: giant cell and too many columns are refused', () => {
  assert.throws(() => rowsOf('a\n' + 'x'.repeat(30000), (t, push) => push(t)), /too long/);
  assert.throws(() => rowsOf(','.repeat(500), (t, push) => push(t)), /too many columns/);
});

test('dates, money and column names behave like the Shipper\'s', () => {
  assert.equal(parseDate('9/20/2026').ms, Date.UTC(2026, 8, 20));
  assert.deepEqual(parseDate('9/20/2026 2:05 PM'), { ms: Date.UTC(2026, 8, 20, 14, 5), hasTime: true });
  assert.equal(parseDate('2026-09-20T07:30').hasTime, true);
  assert.equal(parseDate('13/40/2026'), undefined);
  assert.equal(parseDate('soon'), undefined);
  assert.equal(parseMoney('$1,234.50'), 123450);
  assert.equal(parseMoney('4.5'), 450);
  assert.equal(parseMoney('free'), undefined);
  const m = mapColumns(SHIPPING_HEADER.split(','));
  assert.equal(m.order, 0, '"Order #" is the order number, not "Order Date"');
  assert.equal(m.date, 9);
  assert.equal(m.value, 13);
  assert.equal(mapColumns(['Order Date', 'Order #', 'First Name', 'Last Name', 'Address 1', 'City', 'State', 'Zip']).order, 1);
});

test('small file: every number can be checked by hand', async () => {
  const csv = [SHIPPING_HEADER,
    'A-1,Ada,Lovelace,1 Example St,,Austin,TX,78701,US,10/12/2026 9:15,0.1,Standard,1,10.00,0.99,,',
    'A-2,Ada,Lovelace,1 Example St,,Austin,TX,78701,US,10/14/2026 20:05,0.1,Standard,1,60.00,0.99,9400111,USPS',
    'A-3,Bram,Cobb,2 Example St,,Dallas,TX,75201,US,10/5/2026 20:30,0.1,Standard,1,300.00,0.99,,',
    'A-4,Cleo,Hale,3 Example St,,Seattle,WA,98101,US,10/6/2026,0.1,Standard,1,20.00,0.99,,',
    'A-5,Dax,Ivers,4 Example St,,Seattle,WA,98101,US,not a date,0.1,Standard,1,5.00,0.99,,'].join('\n');
  const { summary: s, draft, names } = await analyzeOrderFile(csv);
  assert.equal(s.orders, 4); assert.equal(s.skipped, 1); assert.deepEqual(s.skipReasons, { 'unreadable date': 1 });
  assert.equal(s.revenueCents, 39000); assert.equal(s.averageOrderCents, 9750);
  assert.equal(s.thresholds.over20.orders, 2, 'over $20 means more than $20.00');
  assert.equal(s.thresholds.atLeast4999.orders, 2); assert.equal(s.thresholds.atLeast250.orders, 1);
  assert.equal(s.thresholds.atLeast4999.withoutTrackingNumber, 1);
  assert.deepEqual(s.states.map((x) => [x.state, x.orders]), [['TX', 3], ['WA', 1]]);
  assert.equal(s.zipAreas[0].zip3 === '787' || s.zipAreas[0].zip3 === '750' || s.zipAreas[0].zip3 === '981', true);
  assert.equal(s.weekEnding, '2026-10-14');
  assert.deepEqual(s.thisWeek, { orders: 2, revenueCents: 7000 });
  assert.deepEqual(s.lastWeek, { orders: 2, revenueCents: 32000 });
  assert.equal(s.weekChangePct, -78.1);
  assert.equal(s.repeat.repeatBuyers, 1); assert.equal(s.repeat.top[0].orders, 2);
  assert.equal(s.busiestHour, 20);
  assert.equal(names.size, 3);
  assert.ok([...names.values()].includes('Ada L.'));
  assert.match(draft, /Seller only \(names stay on this device\)/);
  assert.equal(fillBuyerNames(draft, names).includes('Ada L.: 2 orders'), true);
});

test('names: the summary, draft and charts never hold a buyer name; the filled text holds first name and initial only', async () => {
  const csv = makeShippingExportCsv({ rows: 2000, seed: 3 });
  const r = await analyzeOrderFile(csv);
  const shown = JSON.stringify(r);
  for (const name of new Set(csv.split('\r\n').slice(1, 400).flatMap((l) => l.split(',').slice(1, 3)))) if (name.length > 2) assert.ok(!shown.includes(name), 'leaked ' + name);
  assert.ok(!shown.includes('Example St'));
  const filled = fillBuyerNames(r.draft, r.names);
  assert.ok(/- [A-Z][a-z]+ [A-Z]\.: \d+ orders/.test(filled), 'first name and initial');
  assert.ok(!/- [A-Z][a-z]+ [A-Z][a-z]{2,}:/.test(filled), 'no full last name');
  assert.equal(fillBuyerNames('{{buyer:nope}}', r.names), 'a repeat buyer');
  assert.equal(BUYER_PLACEHOLDER('b-1'), '{{buyer:b-1}}');
});

test('hour pattern only when the file has times; item-level files group lines into orders', async () => {
  const withTime = await analyzeOrderFile(makeShippingExportCsv({ rows: 500, withTime: true }));
  assert.ok(withTime.summary.hours && withTime.summary.hours.length === 24 && withTime.charts.some((c) => c.kind === 'hour'));
  const without = await analyzeOrderFile(makeShippingExportCsv({ rows: 500 }));
  assert.equal(without.summary.hours, null);
  assert.match(without.summary.hourNote, /no time of day/);
  const item = 'Order Number,Buyer Name,Address 1,City,State,Postal Code,Order Date,Product Name,Quantity\n1001,Sam Q Public,10 Elm St,Dover,DE,19901,10/1/2026,Lightning Bolt,4\n1001,Sam Q Public,10 Elm St,Dover,DE,19901,10/1/2026,Black Lotus,1\n1002,Kim Park,22 Birch Ln,Salem,OR,97301,10/2/2026,Pikachu,1\n';
  const i = await analyzeOrderFile(item);
  assert.equal(i.summary.orders, 2);
  assert.equal(i.summary.unknownValueOrders, 2, 'no value column: said so, not guessed');
  assert.ok([...i.names.values()].includes('Sam P.'));
});

test('chart numbers line up and tiers add up', async () => {
  const { summary: s, charts } = await analyzeOrderFile(makeShippingExportCsv({ rows: 3000 }));
  for (const c of charts) for (const series of c.series) assert.equal(series.values.length, c.x.length, c.kind);
  const tiers = charts.find((c) => c.kind === 'order-value-tiers').series[0].values;
  assert.equal(tiers.reduce((a, b) => a + b, 0), s.orders - s.unknownValueOrders);
  assert.equal(s.weeks.reduce((a, w) => a + w.orders, 0) <= s.orders, true);
});

test('empty and broken files give plain answers, not crashes', async () => {
  assert.equal((await analyzeOrderFile('')).summary.ok, false);
  assert.equal((await analyzeOrderFile('just,some,header\n')).summary.ok, false);
  assert.match((await analyzeOrderFile('nonsense')).draft, /No orders could be read/);
});

test('streams from an async source in odd-sized pieces', async () => {
  const csv = makeShippingExportCsv({ rows: 1500 });
  async function* pieces() { for (let i = 0; i < csv.length; i += 777) yield new TextEncoder().encode(csv.slice(i, i + 777)); }
  const a = await analyzeOrderFile(pieces());
  const b = await analyzeOrderFile(csv);
  assert.equal(a.summary.orders, b.summary.orders);
  assert.equal(a.summary.revenueCents, b.summary.revenueCents);
});

test(`budget: ${BUDGET.rows} rows in under ${BUDGET.maxMs} ms and under ${BUDGET.maxRssGrowthMB} MB of memory growth`, async () => {
  const csv = makeShippingExportCsv({ rows: BUDGET.rows });
  await analyzeOrderFile(csv.slice(0, 50000)); // warm up
  if (global.gc) global.gc();
  const rss0 = process.memoryUsage().rss, t0 = process.hrtime.bigint();
  const r = await analyzeOrderFile(csv);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6, mb = (process.memoryUsage().rss - rss0) / 1e6;
  assert.equal(r.summary.orders, BUDGET.rows);
  assert.ok(ms < BUDGET.maxMs, `took ${ms.toFixed(0)} ms`);
  assert.ok(mb < BUDGET.maxRssGrowthMB, `grew ${mb.toFixed(1)} MB`);
});

test('through the tool and the agent: read-only, audited, names stay on the device', async () => {
  const w = makeWorld({ clockStart: '2026-10-16T08:00:00Z' });
  const csv = makeShippingExportCsv({ rows: 1200 });
  const before = JSON.stringify(w.inventory);
  const out = await w.agent.orderFile(csv);
  assert.equal(out.status, 'ok');
  assert.equal(out.sent, false);
  assert.ok(!/\b(Alder|Birch|Cobb|Dunmore)\b/.test(JSON.stringify(out)), 'no last name in what the model would see');
  assert.ok(w.names.size > 100, 'names kept on the device');
  assert.equal(JSON.stringify(w.inventory), before);
  assert.ok((await w.audit.list()).some((e) => e.tool === 'orders.fileInsights' && e.outcome === 'ok'));
  assert.equal(w.registry.get('orders.fileInsights').untrusted, true);
  assert.match(w.agent.fillNames(out.draft), /- [A-Z][a-z]+ [A-Z]\.: /);
  assert.equal((await w.agent.orderFile('nonsense')).status, 'unreadable');
  assert.equal((await w.registry.run('orders.fileInsights', { csv: 'x'.repeat(6000001) })).ok, false);
});
