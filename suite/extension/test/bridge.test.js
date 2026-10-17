import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateRequest, isAllowedOrigin, makeError, makeResponse, MESSAGE_TYPES, REQUEST_SOURCE, BRIDGE_VERSION } from '../src/bridge.js';

const SITE = 'https://tcgspeedshipper.com';
const msg = (over = {}) => ({ source: REQUEST_SOURCE, v: BRIDGE_VERSION, id: 'm1', type: 'hello', ...over });

const DEV = { allowLocalhost: true };

test('production allows only the exact site origin; localhost only in the test build', () => {
  assert.equal(isAllowedOrigin(SITE), true);
  for (const o of ['http://localhost', 'http://localhost:3000', 'http://localhost:8080']) {
    assert.equal(isAllowedOrigin(o), false, 'production must refuse ' + o);
    assert.equal(isAllowedOrigin(o, true), true, 'test build accepts ' + o);
  }
});

test('rejected origins, in production and in the test build', () => {
  for (const o of [
    'http://tcgspeedshipper.com',
    'https://tcgspeedshipper.com:8443',
    'https://evil.tcgspeedshipper.com',
    'https://tcgspeedshipper.com.evil.com',
    'https://seller.tcgplayer.com',
    'https://localhost',
    'http://localhost.evil.com',
    'http://127.0.0.1:3000',
    'null',
    '',
    'https://tcgspeedshipper.com/',
    undefined,
    42
  ]) {
    assert.equal(isAllowedOrigin(o), false, String(o));
    assert.equal(isAllowedOrigin(o, true), false, 'test build: ' + String(o));
  }
});

test('a page can call exactly four things, all write-only: hello, tracking.put, account.link, account.unlink', () => {
  assert.deepEqual([...MESSAGE_TYPES].sort(), ['account.link', 'account.unlink', 'hello', 'tracking.put']);
  assert.equal(validateRequest(msg(), SITE).ok, true);
});

test('every way of reading or writing the extension\'s storage is refused as an unknown type', () => {
  const names = ['store.put', 'store.get', 'store.list', 'store.delete', 'store.clear', 'tracking.get', 'tracking.list', 'tracking.delete', 'orders.list', 'orders.get', 'inventory.list', 'listings.list', 'scans.list', 'agent.ask', 'agent.audit', 'ext.orders.use', 'ext.jobs.list', 'clear-everything', '__proto__', 'constructor', 'toString'];
  for (const type of names) {
    for (const payload of [undefined, {}, { collection: 'orders' }, { collection: 'orders', key: 'a' }, { collection: 'orders', record: { id: 'x' } }, { batchId: 'b' }]) {
      const r = validateRequest(msg({ type, ...(payload ? { payload } : {}) }), SITE);
      assert.equal(r.ok, false, type);
      assert.equal(r.error, 'unknown type', type);
    }
  }
});

test('hello takes no payload; tracking.put needs the exact shape', () => {
  assert.equal(validateRequest(msg({ payload: { a: 1 } }), SITE).ok, false);
  assert.equal(validateRequest(msg({ type: 'tracking.put', payload: { batchId: 'b-1', items: [{ orderId: 'O1', trackingNumber: '123456' }] } }), SITE).ok, true);
});

test('rejects messages from other origins', () => {
  assert.equal(validateRequest(msg(), 'https://seller.tcgplayer.com').ok, false);
  assert.equal(validateRequest(msg(), 'http://localhost:3000').ok, false, 'production refuses localhost');
  assert.equal(validateRequest(msg(), 'http://localhost:3000', DEV).ok, true, 'the test build accepts it');
  assert.equal(validateRequest(msg(), undefined).ok, false);
});

test('rejects malformed messages', () => {
  const bad = [
    null, 'hello', [],
    msg({ source: 'other' }), msg({ v: 2 }), msg({ id: '' }), msg({ id: 'x'.repeat(81) }), msg({ id: 5 }),
    msg({ type: 'eval' }), msg({ extra: 1 }), msg({ payload: { a: 1 } })
  ];
  for (const m of bad) assert.equal(validateRequest(m, SITE).ok, false, JSON.stringify(m));
});

test('replies are tagged and bounded', () => {
  assert.deepEqual(makeResponse('a', 1), { source: 'tcgss-extension', v: 1, id: 'a', ok: true, result: 1 });
  assert.equal(makeError(undefined, 'no').id, null);
  assert.equal(makeError('y'.repeat(200), 'no').id.length, 80);
});

test('fuzz: junk never throws and is never accepted', () => {
  const junk = [undefined, null, 0, -1, NaN, '', 'x', true, [], [1], {}, { a: 1 }, () => 1, Symbol('s'), 10n, new Date(0), Object.create(null), { __proto__: { source: 'tcgss-app' } }, { toString: () => { throw new Error('boom'); } }];
  for (const m of junk) for (const o of [SITE, undefined, null, {}, 'null']) {
    let r;
    assert.doesNotThrow(() => { r = validateRequest(m, o); }, String(typeof m));
    assert.equal(r.ok, false);
  }
  const good = msg({ type: 'tracking.put', payload: { batchId: 'b', items: [{ orderId: 'O1', trackingNumber: '123456' }] } });
  for (const key of ['source', 'v', 'id', 'type', 'payload']) {
    for (const bad of [undefined, null, 0, [], {}, 'zz']) {
      if (key === 'id' && bad === 'zz') continue; // a valid id
      assert.equal(validateRequest({ ...good, [key]: bad }, SITE).ok, false, key + '=' + JSON.stringify(bad));
    }
  }
});

// ---- tracking batches ----
const batch = (over = {}) => ({ batchId: 'batch-2026-10-15-1', items: [{ orderId: 'SYN-1001', trackingNumber: '9400 1000 0000 0000 0000 00', carrier: 'USPS' }, { orderId: 'SYN-1002', trackingNumber: '1Z999AA10123456784' }], ...over });

test('tracking.put accepts the documented shape from the Shipper site only', () => {
  assert.equal(validateRequest(msg({ type: 'tracking.put', payload: batch() }), SITE).ok, true);
  assert.equal(validateRequest(msg({ type: 'tracking.put', payload: batch() }), 'http://localhost:3000').ok, false, 'production refuses localhost');
  for (const o of ['https://seller.tcgplayer.com', 'https://evil.example', 'http://tcgspeedshipper.com', 'https://tcgspeedshipper.com.evil.com']) {
    assert.equal(validateRequest(msg({ type: 'tracking.put', payload: batch() }), o).ok, false, o);
  }
});

test('tracking.put rejects every way the shape can be wrong', () => {
  const longItems = Array.from({ length: 201 }, (_, i) => ({ orderId: 'O' + i, trackingNumber: '123456' }));
  const bad = [
    batch({ batchId: '' }), batch({ batchId: 'has space' }), batch({ batchId: 'x'.repeat(81) }), batch({ batchId: 5 }), batch({ batchId: '../etc' }),
    batch({ items: [] }), batch({ items: 'x' }), batch({ items: longItems }), batch({ items: [null] }), batch({ items: [[]] }),
    batch({ items: [{ orderId: 'A', trackingNumber: '123456' }, { orderId: 'A', trackingNumber: '654321' }] }),
    batch({ items: [{ orderId: 'A b', trackingNumber: '123456' }] }),
    batch({ items: [{ orderId: 'A', trackingNumber: '123' }] }), batch({ items: [{ orderId: 'A', trackingNumber: 'x'.repeat(41) }] }),
    batch({ items: [{ orderId: 'A', trackingNumber: '<script>alert(1)</script>' }] }), batch({ items: [{ orderId: 'A', trackingNumber: 123456789 }] }),
    batch({ items: [{ orderId: 'A', trackingNumber: '123456', carrier: 'Pigeon' }] }),
    batch({ items: [{ orderId: 'A', trackingNumber: '123456', buyerName: 'Pat' }] }), batch({ extra: 1 }),
    undefined, null, 'x', [], {}
  ];
  for (const payload of bad) assert.equal(validateRequest(msg({ type: 'tracking.put', payload }), SITE).ok, false, JSON.stringify(payload)?.slice(0, 80));
});

test('fuzz: random mutations of a good tracking message are never accepted unless still valid', () => {
  let seed = 12345;
  const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const junk = [undefined, null, 0, -1, NaN, '', ' ', 'a'.repeat(100), true, [], {}, { a: 1 }, 'ok-id', '123456', Symbol('s')];
  for (let n = 0; n < 500; n++) {
    const b = JSON.parse(JSON.stringify(batch()));
    const where = [b, b.items[0], b.items[1]][Math.floor(rand() * 3)];
    const keys = Object.keys(where);
    const key = keys[Math.floor(rand() * keys.length)];
    where[key] = junk[Math.floor(rand() * junk.length)];
    let r;
    assert.doesNotThrow(() => { r = validateRequest(msg({ type: 'tracking.put', payload: b }), SITE); });
    if (r.ok) {
      // accepted only if it genuinely matches the documented shape
      assert.match(b.batchId, /^[A-Za-z0-9._-]{1,80}$/);
      for (const it of b.items) { assert.match(it.orderId, /^[A-Za-z0-9._-]{1,80}$/); assert.match(it.trackingNumber, /^[A-Za-z0-9 ]{6,40}$/); }
    }
  }
});
