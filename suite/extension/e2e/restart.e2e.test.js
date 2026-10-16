// A forced service-worker restart in real Chromium must lose nothing (plan, memory, waiting approval, audit).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { runScenario, canRun } from './run-scenario.js';

test('after the service worker is killed, state is intact and a waiting approval can still be answered', { skip: !canRun && 'Chromium or Playwright not found', timeout: 90000 }, async () => {
  const { code, log } = await runScenario(join(fileURLToPath(new URL('.', import.meta.url)), 'restart.scenario.mjs'));
  assert.equal(code, 0, 'restart scenario failed:\n' + log);
});
