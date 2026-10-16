import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTour, STEPS, tourSeen, markTourSeen } from '../src/ui/tour.js';
import { memoryArea } from '../src/flags.js';
import { clearEverything } from '../src/clear.js';
import { openStore } from '../src/store.js';
import { handleAdminMessage } from '../src/background.js';
import { createPracticeHost } from '../src/agent-host/host.js';
import { chromeStatePersist, STATE_KEY } from '../src/agent-host/persist.js';

test('the tour has plain steps and moves back and forth within bounds', () => {
  assert.equal(STEPS.length, 3);
  const t = createTour();
  assert.deepEqual([t.index, t.isFirst, t.isLast], [0, true, false]);
  t.back(); assert.equal(t.index, 0);
  t.next(); t.next(); t.next();
  assert.deepEqual([t.index, t.isLast], [2, true]);
  assert.ok(STEPS.every((s) => s.title.length < 40 && s.body.length < 260 && !/[{}_]/.test(s.body)));
});

test('the tour shows once: seen flag persists, and a broken store does not nag', async () => {
  const area = memoryArea();
  assert.equal(await tourSeen(area), false);
  await markTourSeen(area);
  assert.equal(await tourSeen(area), true);
  assert.equal(await tourSeen({ get: async () => { throw new Error('x'); } }), true);
});

test('Clear everything erases settings, records, audit and the practice Agent, and only extension pages may ask', async () => {
  const id = 'ext-id';
  const area = { ...memoryArea(), remove: async () => {}, clear: null };
  const data = {};
  const storage = { get: async (k) => (k in data ? { [k]: data[k] } : {}), set: async (o) => Object.assign(data, o), remove: async (k) => { delete data[k]; }, clear: async () => { for (const k of Object.keys(data)) delete data[k]; } };
  const store = await openStore({ indexedDB: undefined });
  await store.put('trackingBatches', { id: 'b1', receivedAt: '2026-10-15T12:00:00Z', items: [{ orderId: 'O1', trackingNumber: '123456' }] });
  await storage.set({ tcgss_flags_v1: { agentPanel: true }, tcgss_ui_v1: { tourDone: true } });
  const host = createPracticeHost({ extensionId: id, persist: chromeStatePersist(storage) });
  const sender = { id, url: `chrome-extension://${id}/src/ui/sidepanel.html` };
  await host.handle({ source: 'tcgss-panel', v: 1, id: 'q1', type: 'agent.ask', payload: { text: 'remember that I like tea' } }, sender, () => {});
  await new Promise((r) => setTimeout(r, 20));
  assert.ok(STATE_KEY in data, 'the host saved state');

  // a web page (same extension id for content scripts, but a web url) and a stranger are refused
  assert.equal((await handleAdminMessage({ source: 'tcgss-admin', type: 'clear-everything' }, { id, url: 'https://tcgspeedshipper.com/' }, id, { storage, store, host })).ok, false);
  assert.equal((await handleAdminMessage({ source: 'tcgss-admin', type: 'clear-everything' }, { id: 'other', url: `chrome-extension://${id}/x` }, id, { storage, store, host })).ok, false);
  assert.equal((await handleAdminMessage({ source: 'tcgss-admin', type: 'something-else' }, sender, id, { storage, store, host })).ok, false);
  assert.ok(Object.keys(data).length > 0, 'refused requests erased nothing');

  const res = await handleAdminMessage({ source: 'tcgss-admin', type: 'clear-everything' }, sender, id, { storage, store, host });
  assert.equal(res.ok, true);
  assert.deepEqual(Object.keys(data), [], 'all settings and saved state are gone');
  assert.deepEqual(await store.list('trackingBatches'), []);
  assert.deepEqual(host.snapshot().memory, []);
});
