// node suite/agent/eval/run.js [--write]
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runAll, toMarkdown } from './harness.js';
import { runWeekInShop } from './week-in-shop.js';
import { runRedTeam } from './redteam.js';
import { runBatch3 } from './batch3.js';
import { runBatch4 } from './batch4.js';

const results = await runAll();
for (const r of results) console.log((r.pass ? 'pass  ' : 'FAIL  ') + r.id + (r.pass ? '' : '  ' + r.failures.join('; ')));
console.log(`${results.filter((r) => r.pass).length} of ${results.length} pass`);
const week = await runWeekInShop();
for (const c of week.checks) if (!c.pass) console.log('FAIL  week: ' + c.name + ' ' + c.detail);
const red = await runRedTeam();
for (const r of red) if (!r.pass) console.log('FAIL  ' + r.id + ' ' + r.failures.join('; '));
console.log(`red team: ${red.filter((r) => r.pass).length} of ${red.length} attacks end safely`);
const b4 = await runBatch4();
for (const c of b4.checks) if (!c.pass) console.log('FAIL  batch4: ' + c.name + ' ' + c.detail);
console.log(`batch 4: ${b4.checks.filter((c) => c.pass).length} of ${b4.checks.length} checks pass`);
const b3 = await runBatch3();
for (const c of b3.checks) if (!c.pass) console.log('FAIL  batch3: ' + c.name + ' ' + c.detail);
console.log(`batch 3: ${b3.checks.filter((c) => c.pass).length} of ${b3.checks.length} checks pass (${b3.measured.insights.rows} rows in ${b3.measured.insights.medianMs} ms)`);
console.log(`week in a shop: ${week.measured.checksPassed} of ${week.measured.checks} checks pass`);
if (process.argv.includes('--write')) {
  const path = fileURLToPath(new URL('../../../docs/suite/AGENT-EVAL.md', import.meta.url));
  writeFileSync(path, toMarkdown(results, '2026-10-17', week, red, b3, b4));
  console.log('wrote ' + path);
}
process.exitCode = results.every((r) => r.pass) && week.pass && red.every((r) => r.pass) && b3.pass && b4.pass ? 0 : 1;
