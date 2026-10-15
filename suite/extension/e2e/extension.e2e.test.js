// End to end: a fixture page -> content script -> service worker -> IndexedDB -> back.
// Needs Chromium (default /opt/pw-browsers; override CHROMIUM_PATH, PLAYWRIGHT_PATH). Skips when missing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { runScenario, canRun } from './run-scenario.js';

test('fixture page message reaches the service worker and is stored', { skip: !canRun && 'Chromium or Playwright not found', timeout: 90000 }, async () => {
  const { code, log } = await runScenario(join(fileURLToPath(new URL('.', import.meta.url)), 'scenario.mjs'));
  assert.equal(code, 0, 'browser scenario failed:\n' + log);
});
