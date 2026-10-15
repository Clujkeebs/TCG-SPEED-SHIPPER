// node eval/run-simulated.js  -> prints a JSON summary for several damage rates (SIMULATED, see simulate.js).
import { readFileSync } from 'node:fs';
import { createIndex } from '../data/index.js';
import { runEval } from './harness.js';
import { simulateCases } from './simulate.js';

const printings = JSON.parse(readFileSync(new URL('../data/sample/printings.json', import.meta.url), 'utf8'));
const index = createIndex(printings);
const out = {};
for (const rate of [0, 0.02, 0.05, 0.1]) {
  const runs = [1, 2, 3, 4, 5].map((seed) => runEval(simulateCases(printings, { seed, rate }), { index }).overall);
  const avg = (k) => Math.round((runs.reduce((a, r) => a + r[k], 0) / runs.length) * 10) / 10;
  out['rate ' + rate] = { cases: printings.length * 5, top1: avg('top1'), top3: avg('top3'), autoAccepted: avg('autoAccepted'), autoWrong: runs.reduce((a, r) => a + r.autoWrong, 0), medianMs: avg('medianMs') };
}
console.log(JSON.stringify(out, null, 1));
