import test from 'node:test';
import assert from 'node:assert/strict';
import { checkDevice, checksToText } from './device.js';

const good = () => ({
  isSecureContext: true,
  nav: { mediaDevices: { getUserMedia() {} }, onLine: true, clipboard: { writeText() {} } },
  WebAssembly: { validate: () => true },
  storageProbe: async () => true,
});
const byKey = (cs) => Object.fromEntries(cs.map((c) => [c.key, c]));

test('everything fine: all green with plain sentences', async () => {
  const cs = await checkDevice(good());
  assert.deepEqual(cs.map((c) => c.key), ['secure', 'camera', 'wasm', 'simd', 'storage', 'online', 'clipboard']);
  assert.ok(cs.every((c) => c.ok && c.text.endsWith('.')));
});

test('each failure is red with a sentence that says what to do', async () => {
  const e = good();
  e.isSecureContext = false; e.nav = { onLine: false }; e.WebAssembly = undefined; e.storageProbe = async () => false;
  const c = byKey(await checkDevice(e));
  assert.equal(c.secure.ok, false); assert.match(c.secure.text, /https/);
  assert.equal(c.camera.ok, false); assert.match(c.camera.text, /upload photos/);
  assert.equal(c.wasm.ok, false); assert.equal(c.simd.ok, false);
  assert.equal(c.storage.ok, false); assert.match(c.storage.text, /Download the CSV/);
  assert.equal(c.online.ok, false); assert.equal(c.clipboard.ok, false);
});

test('no SIMD is only a slower path; a throwing probe is red, not a crash', async () => {
  const e = good(); e.WebAssembly = { validate: () => false };
  const c = byKey(await checkDevice(e));
  assert.equal(c.wasm.ok, true); assert.equal(c.simd.ok, false); assert.match(c.simd.text, /slower/);
  const t = good(); t.storageProbe = async () => { throw new Error('x'); }; t.WebAssembly = { validate: () => { throw new Error('y'); } };
  const d = byKey(await checkDevice(t));
  assert.equal(d.storage.ok, false); assert.equal(d.simd.ok, false);
});

test('text form for the problem report', async () => {
  const txt = checksToText(await checkDevice(good()));
  assert.match(txt, /OK   secure:/);
  assert.equal(txt.split('\n').length, 7);
  assert.equal(checksToText(undefined), '');
});
