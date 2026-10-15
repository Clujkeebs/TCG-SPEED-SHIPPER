import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runWeekInShop } from './week-in-shop.js';

test('a week in a shop runs offline from goals to approved actions with a full audit trail', async () => {
  const r = await runWeekInShop();
  for (const c of r.checks) assert.ok(c.pass, 'FAILED: ' + c.name + ' ' + c.detail);
  assert.equal(r.days.length, 6);
  assert.ok(r.measured.byTier.act >= 5);
  assert.deepEqual(r.measured.cardsByStatus, { done: 1, undone: 1, declined: 2 });
  assert.equal(r.measured.reports, 3);
  assert.equal(r.measured.byOutcome.denied, 2);
  assert.equal(r.measured.checksPassed, r.measured.checks);
});

test('the week is repeatable: same numbers every run', async () => {
  const a = await runWeekInShop(), b = await runWeekInShop();
  const strip = (m) => ({ ...m, milliseconds: 0 });
  assert.deepEqual(strip(a.measured), strip(b.measured));
  assert.equal(a.auditJsonl.split('\n').length, b.auditJsonl.split('\n').length);
});
