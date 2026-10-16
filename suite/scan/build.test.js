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

test('no file points at the site root, so the app works from any folder such as /scan/public/', () => {
  const out = join(mkdtempSync(join(tmpdir(), 'scan-')), 'site');
  execFileSync(process.execPath, [new URL('./build.js', import.meta.url).pathname, out]);
  for (const f of ['scan/public/index.html', 'scan/public/app.js', 'scan/public/sw.js', 'scan/public/manifest.webmanifest', 'scan/public/styles.css', 'scan/public/fonts/fonts.css']) {
    const src = readFileSync(join(out, f), 'utf8');
    assert.doesNotMatch(src, /(?:href|src|from|import\()\s*=?\s*["'`]\/(?!\/)/, f + ' has a root-relative path');
    assert.doesNotMatch(src, /url\(['"]?\//, f + ' has a root-relative url()');
    assert.doesNotMatch(src, /(?:href|src)=["']http:/, f + ' loads over http');
  }
  // the service worker registers relative to the page, so its scope is the folder it is served from
  assert.match(readFileSync(join(out, 'scan/public/app.js'), 'utf8'), /register\('sw\.js'\)/);
});
