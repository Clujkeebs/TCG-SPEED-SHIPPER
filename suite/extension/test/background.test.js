import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleRequest } from '../src/background.js';
import { openStore } from '../src/store.js';
import { REQUEST_SOURCE } from '../src/bridge.js';
import { parseOrderExport } from '../src/orders/parser.js';
import { makeOrderCsv } from './helpers/orders-csv.js';

const SITE = 'https://tcgspeedshipper.com';
const req = (type, payload, id = 'r1') => ({ source: REQUEST_SOURCE, v: 1, id, type, ...(payload ? { payload } : {}) });
const batch = { batchId: 'b-1', items: [{ orderId: 'SYN-1', trackingNumber: '9400 1000 0000', carrier: 'USPS' }] };

test('hello says who we are and nothing else (no switches, no data)', async () => {
  const store = await openStore({ indexedDB: undefined });
  const r = await handleRequest(req('hello'), SITE, store);
  assert.equal(r.ok, true);
  assert.deepEqual(Object.keys(r.result).sort(), ['name', 'version']);
});

test('tracking.put stores a batch locally and answers with a count only', async () => {
  const store = await openStore({ indexedDB: undefined });
  const put = await handleRequest(req('tracking.put', batch), SITE, store);
  assert.deepEqual([put.ok, put.result.key, put.result.count], [true, 'b-1', 1]);
  assert.deepEqual(Object.keys(put.result).sort(), ['count', 'key']);
  const saved = await store.get('trackingBatches', 'b-1');
  assert.equal(saved.items[0].trackingNumber, '9400 1000 0000');
  assert.match(saved.receivedAt, /^\d{4}-\d\d-\d\dT/);
});

test('wrong origin, bad batches and production localhost are refused', async () => {
  const store = await openStore({ indexedDB: undefined });
  assert.equal((await handleRequest(req('hello'), 'https://seller.tcgplayer.com', store)).ok, false);
  assert.equal((await handleRequest(req('tracking.put', batch), 'http://localhost:3000', store)).ok, false);
  assert.equal((await handleRequest(req('tracking.put', { ...batch, items: [] }), SITE, store)).ok, false);
  assert.deepEqual(await store.list('trackingBatches'), []);
});

// ---- the privacy line: the seller's orders never leave through the page bridge
test('a page cannot read, list or overwrite the seller\'s imported orders (or anything else in storage)', async () => {
  const store = await openStore({ indexedDB: undefined });
  const orders = parseOrderExport(makeOrderCsv(30)).orders;
  await store.replaceAll('orders', orders);
  await store.put('trackingBatches', { id: 'keep', receivedAt: '2026-10-15T12:00:00Z', items: [{ orderId: 'O1', trackingNumber: '123456' }] });
  const before = JSON.stringify([await store.list('orders'), await store.list('trackingBatches')]);

  const attempts = [
    ['store.list', { collection: 'orders' }], ['store.get', { collection: 'orders', key: orders[0].id }],
    ['store.put', { collection: 'orders', record: { ...orders[0], status: 'hacked' } }], ['store.put', { collection: 'orders', record: orders[0] }],
    ['store.list', { collection: 'inventory' }], ['store.list', { collection: 'trackingBatches' }],
    ['tracking.get', { batchId: 'keep' }], ['tracking.list', undefined],
    ['orders.list', undefined], ['ext.orders.status', undefined], ['agent.audit', undefined], ['clear-everything', undefined]
  ];
  const seen = [];
  for (const [type, payload] of attempts) {
    const r = await handleRequest(req(type, payload), SITE, store);
    seen.push(JSON.stringify(r));
    assert.equal(r.ok, false, type);
    assert.equal(r.error, 'unknown type', type);
  }
  const everything = seen.join(' ');
  for (const o of orders.slice(0, 5)) assert.ok(!everything.includes(o.shipTo.name) && !everything.includes(o.shipTo.address1), 'no buyer data in any answer');
  assert.equal(JSON.stringify([await store.list('orders'), await store.list('trackingBatches')]), before, 'nothing was changed');

  // the only two things a page can do give back nothing from storage
  const hello = JSON.stringify(await handleRequest(req('hello'), SITE, store));
  const put = JSON.stringify(await handleRequest(req('tracking.put', batch), SITE, store));
  for (const o of orders.slice(0, 5)) assert.ok(!(hello + put).includes(o.shipTo.name));
  assert.equal((await store.list('orders')).length, 30);
});
