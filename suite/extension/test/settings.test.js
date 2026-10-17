import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateEndpoint, getSettings, saveEndpoint, DEFAULT_SETTINGS, SETTINGS_KEY } from '../src/settings.js';
import { memoryArea } from '../src/flags.js';

test('the endpoint is off and empty by default', async () => {
  assert.deepEqual(await getSettings(memoryArea()), DEFAULT_SETTINGS);
});

test('only plain https addresses are accepted', () => {
  assert.equal(validateEndpoint('https://agent.example.com').ok, true);
  assert.equal(validateEndpoint('https://agent.example.com/v1/').value, 'https://agent.example.com/v1');
  for (const bad of ['http://agent.example.com', 'https://user:pw@agent.example.com', 'https://agent.example.com/?k=1', 'https://agent.example.com/#x', 'https://localhost', 'https://127.0.0.1', 'https://[::1]/', 'ftp://x.com', 'javascript:alert(1)', '', 'nope', 5, null, 'https://' + 'a'.repeat(300) + '.com']) {
    assert.equal(validateEndpoint(bad).ok, false, String(bad));
  }
});

test('saving, enabling and reading back; junk in storage is ignored', async () => {
  const area = memoryArea();
  assert.equal((await saveEndpoint('https://agent.example.com', true, area)).ok, true);
  assert.deepEqual(await getSettings(area), { agentEndpoint: 'https://agent.example.com', agentEndpointEnabled: true });
  assert.equal((await saveEndpoint('http://bad', true, area)).ok, false);
  await saveEndpoint('', true, area);
  assert.equal((await getSettings(area)).agentEndpointEnabled, false, 'cannot be on without an address');
  await area.set({ [SETTINGS_KEY]: { agentEndpoint: 'http://evil', agentEndpointEnabled: true } });
  assert.deepEqual(await getSettings(area), DEFAULT_SETTINGS);
});

test('the only network use is the account status call (src/account/status.js, one GET to the site)', async () => {
  const { readdirSync, readFileSync, statSync } = await import('node:fs');
  const { join } = await import('node:path');
  const src = new URL('../src/', import.meta.url).pathname;
  const walk = (d) => readdirSync(d).flatMap((n) => (statSync(join(d, n)).isDirectory() ? (n === 'vendor' ? [] : walk(join(d, n))) : [join(d, n)]));
  for (const f of walk(src).filter((p) => p.endsWith('.js') && !p.endsWith('settings.js') && !p.endsWith('options.js') && !p.endsWith('account/status.js') && !p.endsWith('src/background.js'))) {
    const t = readFileSync(f, 'utf8');
    assert.ok(!/\bfetch\(|XMLHttpRequest|WebSocket|sendBeacon/.test(t), f + ' makes network requests');
    assert.ok(!/agentEndpoint/.test(t), f + ' uses the endpoint');
  }
});

test('status.js is the only file that calls the network, to one fixed address', async () => {
  const { readFileSync } = await import('node:fs');
  const status = readFileSync(new URL('../src/account/status.js', import.meta.url), 'utf8');
  assert.equal((status.match(/\bfetchFn\(/g) || []).length, 1, 'exactly one request');
  assert.match(status, /STATUS_PATH = '\/api\/agent\/status'/);
  const bg = readFileSync(new URL('../src/background.js', import.meta.url), 'utf8');
  assert.equal((bg.match(/\bfetch\(/g) || []).length, 0);
  assert.ok((bg.match(/globalThis\.fetch/g) || []).length <= 1, 'background only passes fetch to status.js');
});
