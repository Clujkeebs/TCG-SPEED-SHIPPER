// The seller's own order file, the Insights tab and the five quick actions, in real Chromium.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { runScenario, canRun } from './run-scenario.js';

test('import 2,000 orders, insights, quick actions, restart, accessibility, Clear everything', { skip: !canRun && 'Chromium or Playwright not found', timeout: 150000 }, async () => {
  const { code, log } = await runScenario(join(fileURLToPath(new URL('.', import.meta.url)), 'orders.scenario.mjs'), 120000);
  assert.equal(code, 0, 'orders scenario failed:\n' + log);
});
