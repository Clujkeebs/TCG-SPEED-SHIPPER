import test from 'node:test';
import assert from 'node:assert/strict';
import { createWakeLock } from './wakelock.js';

function fake({ fail = false } = {}) {
  const listeners = {}; const log = [];
  const doc = { visibilityState: 'visible', addEventListener: (t, fn) => { listeners[t] = fn; } };
  const nav = { wakeLock: { request: async (type) => { if (fail) throw new Error('refused'); log.push('request:' + type); const s = { released: false, release: async () => { s.released = true; log.push('release'); }, addEventListener: (_t, fn) => { s.onrelease = fn; } }; nav.last = s; return s; } } };
  return { nav, doc, listeners, log };
}

test('on asks for a screen lock once, off releases it', async () => {
  const f = fake(); const w = createWakeLock(f);
  assert.equal(w.supported, true);
  assert.equal(await w.on(), true); assert.equal(w.active, true);
  assert.equal(await w.on(), false); // already held
  await w.off();
  assert.equal(w.active, false);
  assert.deepEqual(f.log, ['request:screen', 'release']);
});

test('the lock is taken again when the page comes back, but only while wanted', async () => {
  const f = fake(); const w = createWakeLock(f);
  await w.on();
  f.nav.last.onrelease(); // the browser dropped it when the page was hidden
  assert.equal(w.active, false);
  f.listeners.visibilitychange(); await new Promise((r) => setTimeout(r, 0));
  assert.equal(w.active, true);
  await w.off(); f.listeners.visibilitychange(); await new Promise((r) => setTimeout(r, 0));
  assert.equal(w.active, false);
});

test('unsupported or refused: quiet, no throw', async () => {
  const none = createWakeLock({ nav: {}, doc: { addEventListener() {} } });
  assert.equal(none.supported, false); assert.equal(await none.on(), false); await none.off();
  const refused = createWakeLock(fake({ fail: true }));
  assert.equal(await refused.on(), false); assert.equal(refused.active, false);
  assert.equal(createWakeLock({}).supported, false);
});
