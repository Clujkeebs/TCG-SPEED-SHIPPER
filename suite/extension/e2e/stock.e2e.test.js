// The seller's own stock file in real Chromium.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { runScenario, canRun } from './run-scenario.js';

test('import stock, repricing over it, restart, wrong files explained, going back, Clear everything', { skip: !canRun && 'Chromium or Playwright not found', timeout: 150000 }, async () => {
  const { code, log } = await runScenario(join(fileURLToPath(new URL('.', import.meta.url)), 'stock.scenario.mjs'), 120000);
  assert.equal(code, 0, 'stock scenario failed:\n' + log);
});
