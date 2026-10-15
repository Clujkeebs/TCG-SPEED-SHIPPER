// End to end: a fixture page -> content script -> service worker -> IndexedDB -> back.
// Needs Chromium (default /opt/pw-browsers; override CHROMIUM_PATH, PLAYWRIGHT_PATH). Skips when missing.
// The browser runs in its own process group, which is killed afterwards, so a lingering Chromium
// helper process can never hold the test runner open.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const scenario = join(fileURLToPath(new URL('.', import.meta.url)), 'scenario.mjs');
const chromePath = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const pwPath = process.env.PLAYWRIGHT_PATH || '/opt/node22/lib/node_modules/playwright';
const canRun = existsSync(chromePath) && existsSync(pwPath);

test('fixture page message reaches the service worker and is stored', { skip: !canRun && 'Chromium or Playwright not found', timeout: 90000 }, async () => {
  const child = spawn(process.execPath, [scenario], { detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  child.stdout.on('data', (d) => (log += d));
  child.stderr.on('data', (d) => (log += d));
  const code = await new Promise((resolve) => {
    const timer = setTimeout(() => resolve('timeout'), 60000);
    child.on('exit', (c) => { clearTimeout(timer); resolve(c); });
  });
  try { process.kill(-child.pid, 'SIGKILL'); } catch { /* already gone */ }
  child.stdout.destroy();
  child.stderr.destroy();
  assert.equal(code, 0, 'browser scenario failed:\n' + log.split('\n').filter((l) => !/dbus/.test(l)).slice(-15).join('\n'));
});
