import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateRequest, isAllowedOrigin, makeError, makeResponse, REQUEST_SOURCE, BRIDGE_VERSION } from '../src/bridge.js';

const SITE = 'https://tcgspeedshipper.com';
const msg = (over = {}) => ({ source: REQUEST_SOURCE, v: BRIDGE_VERSION, id: 'm1', type: 'hello', ...over });

test('allowed origins', () => {
  for (const o of [SITE, 'http://localhost', 'http://localhost:3000']) assert.equal(isAllowedOrigin(o), true, o);
});

test('rejected origins', () => {
  for (const o of [
    'http://tcgspeedshipper.com',
    'https://tcgspeedshipper.com:8443',
    'https://evil.tcgspeedshipper.com',
    'https://tcgspeedshipper.com.evil.com',
    'https://seller.tcgplayer.com',
    'https://localhost',
    'http://localhost.evil.com',
    'null',
    '',
    'https://tcgspeedshipper.com/',
    undefined,
    42
  ]) assert.equal(isAllowedOrigin(o), false, String(o));
});

test('accepts well-formed messages', () => {
  assert.equal(validateRequest(msg(), SITE).ok, true);
  assert.equal(validateRequest(msg({ type: 'store.list', payload: { collection: 'orders' } }), 'http://localhost:8080').ok, true);
  assert.equal(validateRequest(msg({ type: 'store.get', payload: { collection: 'scans', key: 'a' } }), SITE).ok, true);
  assert.equal(validateRequest(msg({ type: 'store.put', payload: { collection: 'listings', record: {} } }), SITE).ok, true);
});

test('rejects messages from other origins', () => {
  assert.equal(validateRequest(msg(), 'https://seller.tcgplayer.com').ok, false);
  assert.equal(validateRequest(msg(), undefined).ok, false);
});

test('rejects malformed messages', () => {
  const bad = [
    null,
    'hello',
    [],
    msg({ source: 'other' }),
    msg({ v: 2 }),
    msg({ id: '' }),
    msg({ id: 'x'.repeat(81) }),
    msg({ id: 5 }),
    msg({ type: 'eval' }),
    msg({ extra: 1 }),
    msg({ payload: { a: 1 } }),
    msg({ type: 'store.list', payload: { collection: 'passwords' } }),
    msg({ type: 'store.list' }),
    msg({ type: 'store.get', payload: { collection: 'orders' } }),
    msg({ type: 'store.get', payload: { collection: 'orders', key: 7 } }),
    msg({ type: 'store.put', payload: { collection: 'orders', record: 'x' } }),
    msg({ type: 'store.put', payload: { collection: '__proto__', record: {} } })
  ];
  for (const m of bad) assert.equal(validateRequest(m, SITE).ok, false, JSON.stringify(m));
});

test('replies are tagged and bounded', () => {
  assert.deepEqual(makeResponse('a', 1), { source: 'tcgss-extension', v: 1, id: 'a', ok: true, result: 1 });
  assert.equal(makeError(undefined, 'no').id, null);
  assert.equal(makeError('y'.repeat(200), 'no').id.length, 80);
});
