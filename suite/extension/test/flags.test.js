import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_FLAGS, FLAG_DEFS, TOS_OK, getFlags, setFlag, isEnabled, memoryArea, STORAGE_KEY } from '../src/flags.js';

test('every flag defaults to off and the TOS gate is closed', async () => {
  assert.equal(TOS_OK, false);
  const flags = await getFlags(memoryArea());
  assert.deepEqual(flags, DEFAULT_FLAGS);
  assert.ok(Object.values(flags).every((v) => v === false));
});

test('flags persist in the storage area', async () => {
  const area = memoryArea();
  await setFlag('agentPanel', true, area);
  assert.equal((await getFlags(area)).agentPanel, true);
  await setFlag('agentPanel', false, area);
  assert.equal((await getFlags(area)).agentPanel, false);
});

test('TCGplayer modules stay off while the TOS gate is closed, even if the flag is on', async () => {
  const area = memoryArea();
  for (const name of Object.keys(FLAG_DEFS)) await setFlag(name, true, area);
  assert.equal(await isEnabled('pasteTracking', { area }), false);
  assert.equal(await isEnabled('printShipping', { area }), false);
  assert.equal(await isEnabled('uploadToTcgplayer', { area }), false);
  assert.equal(await isEnabled('agentPanel', { area }), true);
});

test('with the gate open (test only) the flag decides', async () => {
  const area = memoryArea();
  assert.equal(await isEnabled('pasteTracking', { area, tosOk: true }), false);
  await setFlag('pasteTracking', true, area);
  assert.equal(await isEnabled('pasteTracking', { area, tosOk: true }), true);
});

test('bad input is rejected and junk in storage is ignored', async () => {
  const area = memoryArea();
  await assert.rejects(setFlag('nope', true, area));
  await assert.rejects(setFlag('agentPanel', 'yes', area));
  await area.set({ [STORAGE_KEY]: { agentPanel: 'true', pasteTracking: 1, extra: true } });
  assert.deepEqual(await getFlags(area), DEFAULT_FLAGS);
  assert.equal(await isEnabled('unknown', { area }), false);
});

test('a broken storage area falls back to all off', async () => {
  const broken = { get: async () => { throw new Error('boom'); }, set: async () => {} };
  assert.deepEqual(await getFlags(broken), DEFAULT_FLAGS);
});
