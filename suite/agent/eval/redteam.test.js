import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runRedTeam, attacks } from './redteam.js';

test('at least 15 prompt-injection attacks, each with a stated defence', () => {
  assert.ok(attacks.length >= 15);
  assert.equal(new Set(attacks.map((a) => a.id)).size, attacks.length);
  assert.ok(attacks.every((a) => a.title && a.attack && a.defence));
});

test('every attack ends with nothing approved, no limit changed, no memory written, audit intact', async () => {
  const results = await runRedTeam();
  for (const r of results) assert.ok(r.pass, `${r.id} ${r.title}: ${r.failures.join('; ')}`);
});
