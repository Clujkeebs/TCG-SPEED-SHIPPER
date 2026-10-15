// node suite/agent/eval/run.js [--write]
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runAll, toMarkdown } from './harness.js';

const results = await runAll();
for (const r of results) console.log((r.pass ? 'pass  ' : 'FAIL  ') + r.id + (r.pass ? '' : '  ' + r.failures.join('; ')));
console.log(`${results.filter((r) => r.pass).length} of ${results.length} pass`);
if (process.argv.includes('--write')) {
  const path = fileURLToPath(new URL('../../../docs/suite/AGENT-EVAL.md', import.meta.url));
  writeFileSync(path, toMarkdown(results, '2026-10-15'));
  console.log('wrote ' + path);
}
process.exitCode = results.every((r) => r.pass) ? 0 : 1;
