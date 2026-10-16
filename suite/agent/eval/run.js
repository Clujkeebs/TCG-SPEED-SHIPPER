// node suite/agent/eval/run.js [--write]
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runAll, toMarkdown } from './harness.js';
import { runWeekInShop } from './week-in-shop.js';
import { runRedTeam } from './redteam.js';

const results = await runAll();
for (const r of results) console.log((r.pass ? 'pass  ' : 'FAIL  ') + r.id + (r.pass ? '' : '  ' + r.failures.join('; ')));
console.log(`${results.filter((r) => r.pass).length} of ${results.length} pass`);
const week = await runWeekInShop();
for (const c of week.checks) if (!c.pass) console.log('FAIL  week: ' + c.name + ' ' + c.detail);
const red = await runRedTeam();
for (const r of red) if (!r.pass) console.log('FAIL  ' + r.id + ' ' + r.failures.join('; '));
console.log(`red team: ${red.filter((r) => r.pass).length} of ${red.length} attacks end safely`);
console.log(`week in a shop: ${week.measured.checksPassed} of ${week.measured.checks} checks pass`);
if (process.argv.includes('--write')) {
  const path = fileURLToPath(new URL('../../../docs/suite/AGENT-EVAL.md', import.meta.url));
  writeFileSync(path, toMarkdown(results, '2026-10-16', week, red));
  console.log('wrote ' + path);
}
process.exitCode = results.every((r) => r.pass) && week.pass && red.every((r) => r.pass) ? 0 : 1;
