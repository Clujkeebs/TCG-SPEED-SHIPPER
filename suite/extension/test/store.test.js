import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openStore } from '../src/store.js';

const order = (id = 'ord-1') => ({
  id, source: 'tcgplayer', orderedAt: '2026-10-15T12:00:00Z', status: 'paid', buyerKey: 'b-1',
  shipTo: { name: 'Test Buyer', address1: '1 Example St', city: 'Testville', state: 'CA', postalCode: '90000', country: 'US' },
  items: [{ name: 'Sample Card', quantity: 1, priceCents: 150 }], itemsTotalCents: 150, shippingPaidCents: 99
});
const inv = { printingId: 'mtg:scryfall:abc', condition: 'NM', finish: 'foil', language: 'en', quantity: 2, source: 'scan' };

test('falls back to memory when IndexedDB is missing', async () => {
  const s = await openStore({ indexedDB: undefined });
  assert.equal(s.kind, 'memory');
});

test('falls back to memory when IndexedDB throws', async () => {
  const s = await openStore({ indexedDB: { open() { throw new Error('denied'); } } });
  assert.equal(s.kind, 'memory');
});

test('put, get, list, delete, clear', async () => {
  const s = await openStore({ indexedDB: undefined });
  assert.equal(await s.put('orders', order('a')), 'a');
  await s.put('orders', order('b'));
  assert.equal((await s.get('orders', 'a')).id, 'a');
  assert.equal((await s.list('orders')).length, 2);
  await s.delete('orders', 'a');
  assert.equal(await s.get('orders', 'a'), null);
  await s.clear('orders');
  assert.equal((await s.list('orders')).length, 0);
});

test('inventory is keyed by printing, condition, finish and language', async () => {
  const s = await openStore({ indexedDB: undefined });
  const key = await s.put('inventory', inv);
  assert.equal(key, 'mtg:scryfall:abc|NM|foil|en');
  await s.put('inventory', { ...inv, quantity: 5 });
  assert.equal((await s.list('inventory')).length, 1);
  assert.equal((await s.get('inventory', key)).quantity, 5);
});

test('invalid records are refused with the validator message', async () => {
  const s = await openStore({ indexedDB: undefined });
  await assert.rejects(s.put('orders', { ...order(), itemsTotalCents: 1.5 }), /itemsTotalCents/);
  await assert.rejects(s.put('inventory', { ...inv, condition: 'MINT' }), /condition/);
  assert.equal((await s.list('orders')).length, 0);
});

test('unknown collections are refused', async () => {
  const s = await openStore({ indexedDB: undefined });
  await assert.rejects(s.put('secrets', {}), /unknown collection/);
  assert.throws(() => s.get('secrets', 'x'), /unknown collection/);
});

test('stored copies are independent of the caller object', async () => {
  const s = await openStore({ indexedDB: undefined });
  const o = order();
  await s.put('orders', o);
  o.status = 'changed';
  assert.equal((await s.get('orders', 'ord-1')).status, 'paid');
});
