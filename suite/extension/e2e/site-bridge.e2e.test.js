// The web app's side of the account link (the real public/js/suite-bridge.js) against the real extension in real Chromium.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { runScenario, canRun } from './run-scenario.js';

test('site bridge: hello first, then the access token only; a renewed token replaces it; sign-out takes it back; no extension means no token posted', { skip: !canRun && 'Chromium or Playwright not found', timeout: 120000 }, async () => {
  const { code, log } = await runScenario(join(fileURLToPath(new URL('.', import.meta.url)), 'site-bridge.scenario.mjs'), 100000);
  assert.equal(code, 0, 'site bridge scenario failed:\n' + log);
});
