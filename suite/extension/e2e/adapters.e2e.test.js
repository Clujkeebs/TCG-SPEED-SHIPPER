// Adapter framework against synthetic pages, in a real (plain) Chromium page. No extension, no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { runScenario, canRun } from './run-scenario.js';

test('adapters read, fill, attach and self-test on synthetic pages', { skip: !canRun && 'Chromium or Playwright not found', timeout: 90000 }, async () => {
  const { code, log } = await runScenario(join(fileURLToPath(new URL('.', import.meta.url)), 'adapters.scenario.mjs'));
  assert.equal(code, 0, 'adapter scenario failed:\n' + log);
});
