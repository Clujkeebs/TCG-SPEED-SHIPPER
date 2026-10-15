import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleRequest } from '../src/background.js';
import { openStore } from '../src/store.js';
import { REQUEST_SOURCE } from '../src/bridge.js';

const SITE = 'https://tcgspeedshipper.com';
const req = (type, payload, id = 'r1') => ({ source: REQUEST_SOURCE, v: 1, id, type, ...(payload ? { payload } : {}) });
const scan = { id: 's1', sessionId: 'x', at: '2026-10-15T12:00:00Z', printingId: null, confidence: 0.5, method: 'manual', candidates: [], accepted: false };

test('hello reports all flags off', async () => {
  const store = await openStore({ indexedDB: undefined });
  const r = await handleRequest(req('hello'), SITE, store);
  assert.equal(r.ok, true);
  assert.ok(Object.values(r.result.flags).every((v) => v === false));
});

test('put then get then list through the handler', async () => {
  const store = await openStore({ indexedDB: undefined });
  assert.equal((await handleRequest(req('store.put', { collection: 'scans', record: scan }), SITE, store)).result.key, 's1');
  assert.equal((await handleRequest(req('store.get', { collection: 'scans', key: 's1' }), SITE, store)).result.record.id, 's1');
  assert.equal((await handleRequest(req('store.list', { collection: 'scans' }), SITE, store)).result.records.length, 1);
});

test('wrong origin and bad records are refused', async () => {
  const store = await openStore({ indexedDB: undefined });
  assert.equal((await handleRequest(req('hello'), 'https://seller.tcgplayer.com', store)).ok, false);
  const bad = await handleRequest(req('store.put', { collection: 'scans', record: { id: 's2' } }), SITE, store);
  assert.equal(bad.ok, false);
  assert.match(bad.error, /invalid scans record/);
});
