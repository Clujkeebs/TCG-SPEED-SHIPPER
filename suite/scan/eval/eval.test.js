import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createIndex } from '../data/index.js';
import { runEval, summarize } from './harness.js';
import { simulateCases, printedText, mulberry32 } from './simulate.js';

const printings = JSON.parse(readFileSync(new URL('../data/sample/printings.json', import.meta.url), 'utf8'));
const index = createIndex(printings);

test('simulation is deterministic per seed', () => {
  assert.deepEqual(simulateCases(printings, { seed: 3, rate: 0.05 }), simulateCases(printings, { seed: 3, rate: 0.05 }));
  assert.notDeepEqual(simulateCases(printings, { seed: 3, rate: 0.05 }), simulateCases(printings, { seed: 4, rate: 0.05 }));
  assert.equal(mulberry32(1)() < 1, true);
  assert.equal(printedText({ game: 'other', name: 'X' }), 'X');
});

test('clean text: nearly every sample card resolves, and no auto-accept is wrong', () => {
  const r = runEval(simulateCases(printings, { rate: 0 }), { index });
  assert.ok(r.overall.top1 >= 90, JSON.stringify(r.overall));
  assert.equal(r.overall.autoWrong, 0);
  assert.equal(Object.keys(r.byGame).length, 4);
});

test('light damage keeps the right card in the top three for most cards', () => {
  const r = runEval(simulateCases(printings, { rate: 0.03, seed: 2 }), { index });
  assert.ok(r.overall.top3 >= 80, JSON.stringify(r.overall));
});

test('summarize handles an empty list', () => {
  assert.equal(summarize([]).overall.n, 0);
});
