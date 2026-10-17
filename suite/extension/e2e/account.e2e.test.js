// The account link in real Chromium, against a stub of the site's status address.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { runScenario, canRun } from './run-scenario.js';

test('account link: token from the site only, one status call, dropped at expiry/sign-out/Clear everything, never stored or logged', { skip: !canRun && 'Chromium or Playwright not found', timeout: 120000 }, async () => {
  const { code, log } = await runScenario(join(fileURLToPath(new URL('.', import.meta.url)), 'account.scenario.mjs'), 100000);
  assert.equal(code, 0, 'account scenario failed:\n' + log);
});
