import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = join(fileURLToPath(import.meta.url), '..', '..');
const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));

test('manifest is MV3 with minimal permissions', () => {
  assert.equal(manifest.manifest_version, 3);
  assert.deepEqual([...manifest.permissions].sort(), ['sidePanel', 'storage']);
  assert.equal(manifest.host_permissions, undefined);
  assert.deepEqual(manifest.optional_host_permissions, ['https://seller.tcgplayer.com/*']);
});

test('no content script runs on TCGplayer', () => {
  for (const cs of manifest.content_scripts) for (const m of cs.matches) assert.ok(!/tcgplayer/i.test(m), m);
  assert.deepEqual(manifest.content_scripts[0].matches, ['https://tcgspeedshipper.com/*', 'http://localhost/*']);
});

test('every file the manifest names exists', () => {
  const files = [manifest.background.service_worker, manifest.side_panel.default_path, manifest.options_ui.page, manifest.action.default_popup, ...manifest.content_scripts.flatMap((c) => c.js), ...manifest.web_accessible_resources.flatMap((w) => w.resources)];
  for (const f of files) assert.ok(existsSync(join(root, f)), f);
});

test('the vendored models.js is identical to suite/shared/models.js', () => {
  const a = readFileSync(join(root, 'src/vendor/models.js'), 'utf8');
  const b = readFileSync(join(root, '..', 'shared', 'models.js'), 'utf8');
  assert.equal(a, b, 'run: cp ../shared/models.js src/vendor/models.js');
});

test('no remote code, analytics or model names in the sources', () => {
  function walk(d) {
    return readdirSync(d).flatMap((n) => {
      const p = join(d, n);
      return statSync(p).isDirectory() ? walk(p) : [p];
    });
  }
  for (const f of walk(join(root, 'src')).filter((p) => /\.(js|html)$/.test(p) && !p.includes('vendor'))) {
    const text = readFileSync(f, 'utf8');
    assert.ok(!/https?:\/\/(?!tcgspeedshipper\.com|localhost|seller\.tcgplayer\.com)[a-z]/i.test(text.replace(/https?:\/\/www\.w3\.org/g, '')), f + ' mentions an unexpected host');
    assert.ok(!/analytics|gtag|sentry/i.test(text), f);
  }
});
