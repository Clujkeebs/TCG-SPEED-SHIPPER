import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runBatch4 } from './batch4.js';

test('batch 4: model door, draft text and cost measurement all pass against the contract stub', async () => {
  const r = await runBatch4();
  for (const c of r.checks) assert.ok(c.pass, `${c.area}: ${c.name} ${c.detail}`);
  assert.ok(r.checks.length >= 8);
});
