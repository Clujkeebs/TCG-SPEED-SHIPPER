import test from 'node:test';
import assert from 'node:assert/strict';
import { priceFreshness, formatAsOf } from './freshness.js';

const P = (asOf, source = 'scryfall', finish = 'nonfoil') => ({ prices: { asOf, source, byFinish: { [finish]: { market: 100 } } } });
const NOW = Date.parse('2026-10-16T12:00:00Z');

test('fresh within 24 hours, stale after', () => {
  assert.equal(priceFreshness(P('2026-10-16T01:00:00Z'), 'nonfoil', NOW).state, 'fresh');
  assert.equal(priceFreshness(P('2026-10-15T13:00:00Z'), 'nonfoil', NOW).state, 'fresh'); // 23 h
  assert.equal(priceFreshness(P('2026-10-15T11:00:00Z'), 'nonfoil', NOW).state, 'stale'); // 25 h
  assert.equal(priceFreshness(P('2026-10-01T00:00:00Z'), 'nonfoil', NOW).state, 'stale');
});

test('a plain date counts from the end of that day', () => {
  assert.equal(priceFreshness(P('2026-10-16'), 'nonfoil', NOW).state, 'fresh');
  assert.equal(priceFreshness(P('2026-10-15'), 'nonfoil', NOW).state, 'fresh');
  assert.equal(priceFreshness(P('2026-10-14'), 'nonfoil', NOW).state, 'stale');
});

test('demo prices, missing prices, unknown dates', () => {
  assert.equal(priceFreshness(P('2026-10-15', 'synthetic-demo'), 'nonfoil', NOW).state, 'demo');
  assert.equal(priceFreshness(P('2026-10-16T01:00:00Z'), 'foil', NOW).state, 'none');
  assert.equal(priceFreshness({}, 'nonfoil', NOW).state, 'none');
  assert.equal(priceFreshness(undefined, 'nonfoil', NOW).state, 'none');
  assert.equal(priceFreshness(P('not a date'), 'nonfoil', NOW).state, 'stale');
});

test('formatAsOf shows the date', () => {
  assert.equal(formatAsOf('2026-10-15T23:30:00Z'), '2026-10-15');
  assert.equal(formatAsOf('2026-10-15'), '2026-10-15');
  assert.equal(formatAsOf('junk'), 'junk');
});
