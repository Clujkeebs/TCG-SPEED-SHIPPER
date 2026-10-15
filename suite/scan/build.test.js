import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('static build has the app, its imports, and no test files', () => {
  const out = join(mkdtempSync(join(tmpdir(), 'scan-')), 'site');
  execFileSync(process.execPath, [new URL('./build.js', import.meta.url).pathname, out]);
  for (const f of ['index.html', 'scan/public/index.html', 'scan/public/app.js', 'scan/public/sw.js', 'scan/core/pricing.js', 'scan/data/sample/printings.json', 'shared/models.js']) assert.ok(existsSync(join(out, f)), f);
  assert.ok(!existsSync(join(out, 'scan/core/pricing.test.js')));
  // every relative import in the app resolves inside the folder
  for (const f of ['scan/public/app.js', 'scan/core/csv.js', 'scan/ocr/pipeline.js']) {
    const src = readFileSync(join(out, f), 'utf8');
    for (const m of src.matchAll(/from '(\.[^']+)'/g)) assert.ok(existsSync(join(out, f, '..', m[1])), f + ' -> ' + m[1]);
  }
});
