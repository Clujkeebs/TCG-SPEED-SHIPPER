import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createKv, attach, RECORD_VERSION } from './persist.js';
import { createFakeIdb } from './fixtures/fake-idb.js';
import { openWorld, makeWorld } from './eval/harness.js';
import { createShopMemory } from './memory.js';
import { newJob, tickJobs } from './jobs.js';

const MON = '2026-10-12T08:00:00Z';

test('the fake IndexedDB behaves like the real one where it matters (keys, copies, reopening)', async () => {
  const idb = createFakeIdb();
  const kv = createKv(idb);
  const value = { a: [1, 2], b: 'x' };
  await kv.put('k', value);
  value.a.push(3);
  assert.deepEqual(await kv.get('k'), { a: [1, 2], b: 'x' }, 'stored a copy');
  const got = await kv.get('k'); got.b = 'changed';
  assert.equal((await kv.get('k')).b, 'x', 'returned a copy');
  assert.equal(await createKv(idb).get('k') !== undefined, true, 'a second connection sees it');
  assert.deepEqual(await kv.keys(), ['k']);
  await kv.delete('k');
  assert.equal(await kv.get('k'), undefined);
});

test('a persistent store has exactly the same interface as the in-memory one, and keeps working', async () => {
  const idb = createFakeIdb();
  const w = await openWorld({ idb, clockStart: MON });
  const plain = makeWorld({ clockStart: MON });
  for (const part of ['memory', 'inbox', 'reports', 'automations']) assert.deepEqual(Object.keys(w[part]).sort(), Object.keys(plain[part]).sort(), part);
  assert.deepEqual(Object.keys(w.agent).sort(), Object.keys(plain.agent).sort());
  const f = w.memory.add({ text: 'I restock at 3', key: 'restock.threshold', value: 3 });
  assert.equal(f.id, 'mem-1', 'calls still return values synchronously');
});

test('memory, cards, plans, reports, schedules and the audit trail come back after closing and reopening', async () => {
  const idb = createFakeIdb();
  const a = await openWorld({ idb, clockStart: MON });
  await a.agent.remember({ text: 'I price 5% under market', key: 'price.percent', value: 5, category: 'preference' });
  const g = await a.agent.goal('Reprice my foils');
  const cardId = g.steps.find((s) => s.cardId).cardId;
  a.automations.save(newJob({ id: 'fri', name: 'Friday wrap-up', trigger: { type: 'cron', value: '0 8 * * 1' }, steps: [{ tool: 'report.weeklyDraft' }] }));
  await tickJobs({ store: a.automations, registry: a.registry, inbox: a.inbox, reports: a.reports, now: MON });
  const keepMe = a.memory.add({ text: 'delete me later', source: 'user' });
  a.memory.delete(keepMe.id);
  await a.persistence.flush();
  const auditBefore = await a.audit.exportJsonl();
  const snap = (w) => JSON.stringify({ mem: w.memory.list(), cards: w.inbox.list(), reports: w.reports.list(), jobs: w.automations.list(), runs: [...w.agent.runs.entries()] });

  const b = await openWorld({ idb, clockStart: MON });
  assert.equal(snap(b), snap(a), 'everything is back exactly as it was');
  assert.equal(await b.audit.exportJsonl(), auditBefore, 'the audit trail is back, in order');
  assert.equal(b.memory.get('price.percent'), 5);
  assert.equal(b.memory.list().length, 1, 'the forgotten fact stays forgotten');
  assert.equal(b.automations.get('fri').lastRunAt, MON);
  assert.equal(b.inbox.get(cardId).status, 'pending');
  // the waiting card is still approvable after a restart, and its approval is audited
  const done = await b.agent.decide(cardId, true);
  assert.equal(done.card.status, 'done');
  assert.notEqual(JSON.stringify(b.inventory), JSON.stringify(a.inventory), 'it ran against B\'s own stock list');
  const next = await b.agent.goal('Reprice my foils 20% under market');
  assert.notEqual(next.steps.find((s) => s.cardId).cardId, cardId, 'card numbers continue instead of starting over');
  await b.persistence.flush();
  const c = await openWorld({ idb, clockStart: MON });
  assert.equal(c.inbox.get(cardId).status, 'done');
  assert.equal(c.inbox.list({ status: 'pending' }).length, 1);
  assert.ok((await c.audit.list()).some((e) => e.tool === 'inventory.setPrices' && e.approvedBy === 'user'));
});

test('only changes are written: reading and unchanged calls cost no writes; bursts are saved in order', async () => {
  const idb = createFakeIdb();
  const w = await openWorld({ idb, clockStart: MON });
  await w.persistence.flush();
  const before = idb.stats.puts;
  w.memory.list(); w.memory.search('x'); w.inbox.list(); w.reports.list(); w.automations.list();
  await w.persistence.flush();
  assert.equal(idb.stats.puts, before, 'reads wrote nothing');
  for (let i = 0; i < 30; i += 1) w.memory.add({ text: 'fact number ' + i });
  await w.persistence.flush();
  assert.ok(idb.stats.puts - before <= 31);
  const b = await openWorld({ idb, clockStart: MON });
  assert.equal(b.memory.list().length, 30);
  assert.deepEqual(b.memory.list().map((f) => f.text), w.memory.list().map((f) => f.text));
});

test('a failed write is reported, nothing breaks, and the next change saves everything', async () => {
  const idb = createFakeIdb();
  const errors = [];
  const w = await openWorld({ idb, clockStart: MON, onError: (e) => errors.push(e.message) });
  idb.failNext('put', new Error('QuotaExceededError'));
  w.memory.add({ text: 'first fact' });
  await w.persistence.flush();
  assert.deepEqual(errors, ['QuotaExceededError']);
  assert.equal(w.memory.list().length, 1, 'the in-memory copy kept working');
  w.memory.add({ text: 'second fact' });
  await w.persistence.flush();
  const b = await openWorld({ idb, clockStart: MON });
  assert.deepEqual(b.memory.list().map((f) => f.text), ['first fact', 'second fact'], 'the retry saved both');
});

test('data from a newer version is left alone, not overwritten', async () => {
  const idb = createFakeIdb();
  const kv = createKv(idb);
  await kv.put('memory', { v: RECORD_VERSION + 1, data: [{ from: 'the future' }] });
  const errors = [];
  const w = await openWorld({ idb, clockStart: MON, onError: (e) => errors.push(e.message) });
  assert.deepEqual(w.persistence.readOnly, ['memory']);
  assert.match(errors[0], /different version/);
  w.memory.add({ text: 'will not be saved' });
  await w.persistence.flush();
  assert.deepEqual((await kv.get('memory')).data, [{ from: 'the future' }]);
  w.inbox.propose({ tool: 'memory.remember', args: { text: 'other stores still save' }, why: 'x' });
  await w.persistence.flush();
  assert.ok((await kv.get('inbox')).data.cards.length === 1);
});

test('a corrupt record is not trusted and not overwritten; a missing one just starts empty', async () => {
  const idb = createFakeIdb();
  await createKv(idb).put('memory', { v: RECORD_VERSION, data: [{ id: 'mem-1', text: 'sam@example.com' }] }); // fails the memory rules
  const errors = [];
  const w = await openWorld({ idb, clockStart: MON, onError: (e) => errors.push(e.message) });
  assert.equal(w.memory.list().length, 0);
  assert.match(errors.join(), /could not be read/);
  assert.ok(w.persistence.readOnly.includes('memory'));
  const fresh = await openWorld({ idb: createFakeIdb(), clockStart: MON });
  assert.equal(fresh.memory.list().length, 0);
  assert.equal(fresh.persistence.readOnly.length, 0);
});

test('attach works on any store (memory alone), and a database that cannot open is reported', async () => {
  const idb = createFakeIdb();
  const m = createShopMemory();
  const h = await attach(m, { kv: createKv(idb), key: 'm', snapshot: () => JSON.parse(m.exportJson()), restore: (d) => m.importJson(JSON.stringify(d)) });
  m.add({ text: 'alone' });
  await h.flush();
  assert.equal(h.saves, 1);
  const broken = { open() { const r = {}; queueMicrotask(() => { r.error = new Error('blocked'); r.onerror && r.onerror(); }); return r; } };
  const errors = [];
  const m2 = createShopMemory();
  const h2 = await attach(m2, { kv: createKv(broken), key: 'm', snapshot: () => [], restore: () => {}, onError: (e) => errors.push(e.message) });
  m2.add({ text: 'still works without a database' });
  await h2.flush();
  assert.equal(m2.list().length, 1);
  assert.ok(errors.length >= 1);
});
