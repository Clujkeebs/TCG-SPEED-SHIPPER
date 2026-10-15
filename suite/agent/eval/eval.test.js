import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runAll, runScenario, toMarkdown } from './harness.js';

test('every scenario passes, offline', async () => {
  const results = await runAll();
  assert.ok(results.length >= 10);
  for (const r of results) assert.ok(r.pass, r.id + ': ' + r.failures.join('; '));
});

test('the harness catches a wrong expectation', async () => {
  const bad = { id: 'x', title: 'x', user: 'x', script: [[{ type: 'text', text: 'hello' }]], expect: { calls: ['orders.stats'] } };
  const r = await runScenario(bad);
  assert.equal(r.pass, false);
});

test('report lists every scenario', async () => {
  const md = toMarkdown(await runAll(), '2026-10-15');
  assert.match(md, /12 of 12|\d+ of \d+ scenarios pass/);
});
