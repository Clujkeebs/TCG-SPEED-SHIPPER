// node suite/agent/eval/run.js [--write]
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runAll, toMarkdown } from './harness.js';
import { runWeekInShop } from './week-in-shop.js';

const results = await runAll();
for (const r of results) console.log((r.pass ? 'pass  ' : 'FAIL  ') + r.id + (r.pass ? '' : '  ' + r.failures.join('; ')));
console.log(`${results.filter((r) => r.pass).length} of ${results.length} pass`);
const week = await runWeekInShop();
for (const c of week.checks) if (!c.pass) console.log('FAIL  week: ' + c.name + ' ' + c.detail);
console.log(`week in a shop: ${week.measured.checksPassed} of ${week.measured.checks} checks pass`);
if (process.argv.includes('--write')) {
  const path = fileURLToPath(new URL('../../../docs/suite/AGENT-EVAL.md', import.meta.url));
  writeFileSync(path, toMarkdown(results, '2026-10-15', week));
  console.log('wrote ' + path);
}
process.exitCode = results.every((r) => r.pass) && week.pass ? 0 : 1;
