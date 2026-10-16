import test from 'node:test';
import assert from 'node:assert/strict';
import { openLists, MAX_LISTS } from './lists.js';
import { openSession, createMemoryStore } from './session.js';

let clock = 0;
const now = () => new Date(Date.UTC(2026, 9, 16, 0, 0, clock++)).toISOString();
const card = (o = {}) => ({ printingId: 'mtg:sample:a', condition: 'NM', finish: 'nonfoil', language: 'en', quantity: 1, priceCents: 100, ...o });

test('starts with one list; the old single list is kept as "My list"', async () => {
  const L = await openLists({ store: createMemoryStore(), now, legacy: { items: [{ id: 'row-1', quantity: 2 }], seq: 1 } });
  assert.equal(L.count(), 1);
  assert.equal(L.meta()[0].name, 'My list'); assert.equal(L.meta()[0].cards, 2);
});

test('create, rename, switch, duplicate, delete', async () => {
  const L = await openLists({ store: createMemoryStore(), now });
  const first = L.activeId;
  const b = L.create('Saturday box');
  assert.equal(L.activeId, b);
  L.rename(b, '  Saturday   box 2 ');
  assert.equal(L.meta().find((m) => m.id === b).name, 'Saturday box 2');
  assert.throws(() => L.rename(b, '   '));
  L.switchTo(first); assert.equal(L.activeId, first);
  const d = L.duplicate(first);
  assert.equal(L.meta().find((m) => m.id === d).name, 'My list copy');
  assert.equal(L.activeId, d);
  const next = L.remove(d);
  assert.notEqual(next, d); assert.equal(L.count(), 2);
  assert.throws(() => L.switchTo('nope'));
});

test('deleting the last list leaves a fresh empty one', async () => {
  const L = await openLists({ store: createMemoryStore(), now });
  const id = L.remove(L.activeId);
  assert.equal(L.count(), 1); assert.equal(L.meta()[0].rows, 0); assert.equal(L.activeId, id);
});

test('each list keeps its own rows through a session; duplicate is a real copy', async () => {
  const L = await openLists({ store: createMemoryStore(), now });
  const a = L.activeId;
  const sa = await openSession({ store: L.sessionStore(a), now });
  sa.add(card({ quantity: 3 })); await sa.flush();
  const b = L.create('Other');
  const sb = await openSession({ store: L.sessionStore(b), now });
  assert.equal(sb.items.length, 0);
  sb.add(card({ printingId: 'x' })); await sb.flush();
  const d = L.duplicate(a);
  const sd = await openSession({ store: L.sessionStore(d), now });
  assert.equal(sd.items[0].quantity, 3);
  sd.setQuantity(sd.items[0].id, 9); await sd.flush();
  assert.equal(L.items(a)[0].quantity, 3); // the original is untouched
  assert.equal(L.items(d)[0].quantity, 9);
  assert.equal(L.meta().find((m) => m.id === a).cards, 3);
});

test('survives a restart (new manager over the same store)', async () => {
  const store = createMemoryStore();
  const L = await openLists({ store, now }); const a = L.activeId;
  const s = await openSession({ store: L.sessionStore(a), now }); s.add(card()); await s.flush();
  L.create('Two'); await L.flush();
  const again = await openLists({ store, now });
  assert.equal(again.count(), 2);
  assert.equal(again.meta().find((m) => m.id === a).rows, 1);
  assert.equal(again.create('Three') !== a, true);
});

test('only the newest 20 are kept, never the one in use', async () => {
  const L = await openLists({ store: createMemoryStore(), now });
  const first = L.activeId;
  for (let i = 0; i < 25; i += 1) L.create('L' + i);
  assert.equal(L.count(), MAX_LISTS);
  assert.equal(L.meta().some((m) => m.id === first), false); // the oldest went
  assert.equal(L.meta().some((m) => m.active), true);
  const active = L.activeId;
  assert.ok(L.meta().find((m) => m.id === active)); // the list in use is never the one dropped
});
