import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAuditLog, createMemoryStore, createIdbStore, hashArgs } from './audit.js';
import { validateAuditEntry } from '../shared/models.js';

test('hash is stable, order-free and hides the arguments', async () => {
  const a = await hashArgs({ b: 1, a: 'secret-name' });
  const b = await hashArgs({ a: 'secret-name', b: 1 });
  assert.equal(a, b);
  assert.match(a, /^[0-9a-f]{64}$/);
  assert.notEqual(a, await hashArgs({ a: 'secret-name', b: 2 }));
  assert.ok(!a.includes('secret'));
});

test('entries validate and never hold raw arguments', async () => {
  const log = createAuditLog({ now: () => new Date('2026-10-15T10:00:00Z') });
  const e = await log.record({ tool: 'orders.search', tier: 'read', args: { buyerKey: 'buyer-001' }, outcome: 'ok' });
  assert.equal(validateAuditEntry(e).ok, true);
  assert.ok(!JSON.stringify(await log.list()).includes('buyer-001'));
});

test('store is append-only: no update or delete, rows are frozen', async () => {
  const store = createMemoryStore();
  assert.equal(store.update, undefined);
  assert.equal(store.delete, undefined);
  const log = createAuditLog({ store });
  await log.record({ tool: 't', tier: 'read', args: {}, outcome: 'ok' });
  const rows = await log.list();
  rows[0].outcome = 'denied'; // a copy: the stored row is unchanged
  assert.equal((await log.list())[0].outcome, 'ok');
});

// A tiny stand-in for the browser's IndexedDB, enough for one object store with auto-increment keys.
function fakeIdb() {
  const stores = {};
  const req = (fn) => { const r = {}; queueMicrotask(() => { try { r.result = fn(); r.onsuccess && r.onsuccess(); } catch (e) { r.error = e; r.onerror && r.onerror(); } }); return r; };
  const db = {
    createObjectStore(name) { stores[name] = { rows: [], seq: 0 }; return {}; },
    transaction(name) {
      const s = stores[name];
      return { objectStore: () => ({ add: (v) => req(() => { s.rows.push({ ...v, seq: ++s.seq }); return s.seq; }), getAll: () => req(() => s.rows.map((r) => ({ ...r }))) }) };
    },
  };
  return { open() { const r = {}; queueMicrotask(() => { r.result = db; if (!stores.audit) r.onupgradeneeded && r.onupgradeneeded(); r.onsuccess && r.onsuccess(); }); return r; } };
}

test('IndexedDB store keeps entries in order', async () => {
  const log = createAuditLog({ store: createIdbStore(fakeIdb()) });
  await log.record({ tool: 'a', tier: 'read', args: {}, outcome: 'ok' });
  await log.record({ tool: 'b', tier: 'draft', args: { x: 1 }, outcome: 'denied' });
  const rows = await log.list();
  assert.deepEqual(rows.map((r) => r.tool), ['a', 'b']);
  assert.equal(rows[0].seq, undefined);
});
