import test from 'node:test';
import assert from 'node:assert/strict';
import { createLiveScanner } from './live.js';

const B = (x = 10, y = 10) => ({ x, y, w: 100, h: 140, confidence: 0.9 });
function make(boxes) {
  let i = 0; let calls = 0;
  const s = createLiveScanner({ detect: () => boxes[Math.min(i++, boxes.length - 1)], identify: async () => ({ n: ++calls }) });
  return { s, calls: () => calls };
}

test('waits for a steady card, identifies once, then holds', async () => {
  const { s, calls } = make([B(), B(11, 10), B(10, 11), B(), B()]);
  const types = [];
  for (let k = 0; k < 5; k += 1) types.push((await s.step({})).type);
  assert.deepEqual(types, ['tracking', 'tracking', 'result', 'held', 'held']);
  assert.equal(calls(), 1);
});

test('a moving card keeps resetting the count', async () => {
  const { s, calls } = make([B(10), B(60), B(120), B(10), B(70)]);
  for (let k = 0; k < 5; k += 1) await s.step({});
  assert.equal(calls(), 0);
});

test('card leaves and a new one arrives: identified again', async () => {
  const none = null;
  const { s, calls } = make([B(), B(), B(), none, none, B(200, 50), B(200, 50), B(200, 50)]);
  for (let k = 0; k < 8; k += 1) await s.step({});
  assert.equal(calls(), 2);
});

test('one missed frame does not unlock', async () => {
  const { s, calls } = make([B(), B(), B(), null, B(), B(), B()]);
  for (let k = 0; k < 7; k += 1) await s.step({});
  assert.equal(calls(), 1);
});

test('low confidence boxes are ignored; busy frames are skipped', async () => {
  const lowS = createLiveScanner({ detect: () => ({ ...B(), confidence: 0.1 }), identify: async () => 1 });
  assert.equal((await lowS.step({})).type, 'none');
  let release; const gate = new Promise((r) => { release = r; });
  const s = createLiveScanner({ detect: () => B(), identify: () => gate, stableFrames: 1 });
  const first = s.step({});
  assert.equal((await s.step({})).type, 'busy');
  release(1); assert.equal((await first).type, 'result');
  s.reset();
});
