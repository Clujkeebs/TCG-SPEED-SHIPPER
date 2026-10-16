import test from 'node:test';
import assert from 'node:assert/strict';
import { openSession, createMemoryStore, createIndexedDbStore } from './session.js';
import { validateListingDraft } from '../../shared/models.js';

const card = (o = {}) => ({ printingId: 'mtg:sample:a', condition: 'NM', finish: 'nonfoil', language: 'en', quantity: 1, priceCents: 199, ...o });
const fresh = () => openSession({ now: () => '2026-10-15T12:00:00Z' });

test('add creates valid drafts and merges identical rows', async () => {
  const s = await fresh();
  const r = s.add(card());
  assert.equal(validateListingDraft(r).ok, true);
  s.add(card({ quantity: 2 }));
  assert.equal(s.items.length, 1);
  assert.equal(s.items[0].quantity, 3);
  s.add(card({ condition: 'LP' }));
  s.add(card({ finish: 'foil' }));
  s.add(card({ language: 'ja' }));
  s.add(card({ printingId: 'mtg:sample:b' }));
  assert.equal(s.items.length, 5);
});

test('bad input is refused', async () => {
  const s = await fresh();
  assert.throws(() => s.add(card({ quantity: 0 })));
  assert.throws(() => s.add(card({ quantity: 1.5 })));
  assert.throws(() => s.add(card({ condition: 'XX' })));
  assert.throws(() => s.add(card({ priceCents: 1.5 })));
  assert.throws(() => s.edit('nope', { quantity: 2 }));
  assert.equal(s.items.length, 0);
});

test('quantity, edit, remove', async () => {
  const s = await fresh();
  const { id } = s.add(card());
  s.setQuantity(id, 4);
  s.edit(id, { priceCents: 250, condition: 'MP' });
  assert.deepEqual(s.items[0].quantity, 4);
  assert.equal(s.items[0].priceCents, 250);
  assert.equal(s.items[0].condition, 'MP');
  assert.throws(() => s.setQuantity(id, 0));
  assert.equal(s.remove(id), true);
  assert.equal(s.remove(id), false);
  assert.equal(s.items.length, 0);
});

test('undo steps back through add, edit, remove, clear, merge', async () => {
  const s = await fresh();
  const a = s.add(card());
  const b = s.add(card({ condition: 'LP' }));
  s.edit(b.id, { condition: 'NM' });
  assert.equal(s.mergeDuplicates(), 1);
  assert.equal(s.items.length, 1);
  assert.equal(s.items[0].quantity, 2);
  assert.ok(s.undo()); assert.equal(s.items.length, 2);
  assert.ok(s.undo()); assert.equal(s.items[1].condition, 'LP');
  s.remove(a.id);
  assert.ok(s.undo()); assert.equal(s.items.length, 2);
  s.clear(); assert.equal(s.items.length, 0);
  assert.ok(s.undo()); assert.equal(s.items.length, 2);
  s.undo(); s.undo();
  assert.equal(s.items.length, 0);
  assert.equal(s.undo(), false);
  assert.equal(s.canUndo(), false);
});

test('totals', async () => {
  const s = await fresh();
  assert.deepEqual(s.totals(), { rows: 0, cards: 0, valueCents: 0, unpriced: 0 });
  s.add(card({ quantity: 2, priceCents: 100 }));
  s.add(card({ printingId: 'x', quantity: 3, priceCents: 0 }));
  assert.deepEqual(s.totals(), { rows: 2, cards: 5, valueCents: 200, unpriced: 1 });
});

test('persists and reloads, including defaults and product ids', async () => {
  const store = createMemoryStore();
  const s = await openSession({ store });
  s.add(card({ quantity: 2 }));
  s.setDefaults({ game: 'pokemon', condition: 'LP' });
  s.setProductId('mtg:sample:a', 555);
  await s.flush();
  const again = await openSession({ store });
  assert.equal(again.items[0].quantity, 2);
  assert.deepEqual(again.defaults, { game: 'pokemon', condition: 'LP' });
  assert.equal(again.items[0].tcgplayerProductId, 555);
  assert.equal(again.add(card({ printingId: 'q' })).id, 'row-2'); // ids keep counting
  assert.throws(() => again.setProductId('x', -3));
  again.setProductId('mtg:sample:a', null);
  assert.equal('tcgplayerProductId' in again.items[0], false);
});

test('change listeners fire; the IndexedDB store falls back to memory in Node', async () => {
  const s = await fresh();
  let n = 0;
  const off = s.onChange(() => { n += 1; });
  s.add(card()); off(); s.add(card({ condition: 'HP' }));
  assert.equal(n, 1);
  const st = createIndexedDbStore();
  assert.equal(st.kind, 'memory');
});

test('editMany changes several rows in one undo step and skips rows the change function declines', async () => {
  const s = await fresh();
  const a = s.add(card({ printingId: 'a' })); const b = s.add(card({ printingId: 'b' })); const c = s.add(card({ printingId: 'c' }));
  const n = s.editMany([a.id, b.id], (row) => (row.printingId === 'a' ? { condition: 'LP', priceCents: 90 } : undefined));
  assert.equal(n, 1);
  assert.deepEqual([s.items[0].condition, s.items[0].priceCents, s.items[1].condition, s.items[2].condition], ['LP', 90, 'NM', 'NM']);
  s.editMany([a.id, b.id, c.id], () => ({ finish: 'foil' }));
  assert.ok(s.items.every((r) => r.finish === 'foil'));
  assert.ok(s.undo()); assert.ok(s.items.every((r) => r.finish === 'nonfoil')); // the whole bulk change undone at once
  assert.ok(s.undo()); assert.equal(s.items[0].condition, 'NM');
  assert.equal(s.editMany(['nope'], () => ({ condition: 'LP' })), 0);
  assert.throws(() => s.editMany([a.id], () => ({ condition: 'XX' })));
  assert.equal(s.items[0].condition, 'NM'); // a bad change leaves rows untouched
  assert.throws(() => s.editMany([a.id, b.id], (row) => (row.id === b.id ? { condition: 'XX' } : { condition: 'HP' })));
  assert.equal(s.items[0].condition, 'NM'); // even when only the second row was bad
});
