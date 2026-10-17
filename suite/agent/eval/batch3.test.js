import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runBatch3 } from './batch3.js';

test('batch 3: order file at scale, saving on the device, briefing and voice all pass', async () => {
  const r = await runBatch3();
  for (const c of r.checks) assert.ok(c.pass, `${c.area}: ${c.name} ${c.detail}`);
  assert.ok(r.checks.length >= 18);
  assert.ok(r.measured.briefing.words <= 150);
});
