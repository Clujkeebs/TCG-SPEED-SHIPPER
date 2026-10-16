import test from 'node:test';
import assert from 'node:assert/strict';
import { scaleToMax, MAX_SIDE } from './imagesize.js';
import { createIdleCloser } from './idle.js';

test('small pictures are left alone, big ones fit 1600 on the long side keeping their shape', () => {
  assert.deepEqual(scaleToMax(1280, 720), { width: 1280, height: 720, scale: 1 });
  assert.deepEqual(scaleToMax(1600, 1600), { width: 1600, height: 1600, scale: 1 });
  const a = scaleToMax(4032, 3024); assert.equal(a.width, 1600); assert.equal(a.height, 1200);
  const b = scaleToMax(3024, 4032); assert.equal(b.height, 1600); assert.equal(b.width, 1200);
  assert.equal(scaleToMax(100000, 1).height, 1); // never zero
  assert.equal(MAX_SIDE, 1600);
});

test('idle closer fires once after the wait and restarts on touch', () => {
  const timers = []; let closed = 0;
  const c = createIdleCloser({ ms: 60000, close: () => { closed += 1; }, setTimer: (fn, ms) => { timers.push({ fn, ms, live: true }); return timers.length - 1; }, clearTimer: (id) => { timers[id].live = false; } });
  c.touch(); c.touch();
  assert.equal(timers.filter((t) => t.live).length, 1); assert.equal(timers[0].ms, 60000);
  assert.equal(c.waiting, true);
  timers[1].fn(); assert.equal(closed, 1); assert.equal(c.waiting, false);
  c.touch(); c.cancel(); assert.equal(c.waiting, false);
});
