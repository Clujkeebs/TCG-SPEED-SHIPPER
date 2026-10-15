import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLimits } from './limits.js';

test('per-run call cap', () => {
  const l = createLimits({ perRun: { maxCalls: 2 }, perDay: {} });
  const run = l.newRun();
  for (let i = 0; i < 2; i++) { assert.equal(l.check(run).ok, true); l.record(run); }
  assert.match(l.check(run).reason, /run call/);
  assert.equal(l.check(l.newRun()).ok, true); // a new run starts fresh
});

test('spend is counted in whole cents and capped per run and per day', () => {
  const l = createLimits({ perRun: { maxSpendCents: 10 }, perDay: { maxSpendCents: 15 } });
  const r1 = l.newRun();
  assert.equal(l.check(r1, 10).ok, true);
  assert.equal(l.check(r1, 11).ok, false);
  assert.equal(l.check(r1, 1.5).ok, false);
  l.record(r1, 10);
  const r2 = l.newRun();
  assert.match(l.check(r2, 6).reason, /daily spending/);
  assert.equal(l.check(r2, 5).ok, true);
});

test('day counters reset at the next UTC day', () => {
  let t = new Date('2026-10-15T23:00:00Z');
  const l = createLimits({ perRun: {}, perDay: { maxCalls: 1 }, now: () => t });
  const run = l.newRun();
  l.record(run);
  assert.equal(l.check(run).ok, false);
  t = new Date('2026-10-16T00:30:00Z');
  assert.equal(l.check(run).ok, true);
});

test('kill switch stops everything until resumed', () => {
  const l = createLimits();
  l.kill('test');
  assert.match(l.check(l.newRun()).reason, /kill switch.*test/);
  l.resume();
  assert.equal(l.check(l.newRun()).ok, true);
});
