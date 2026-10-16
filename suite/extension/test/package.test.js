import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = join(fileURLToPath(import.meta.url), '..', '..');
const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));

test('manifest is MV3 with minimal permissions', () => {
  assert.equal(manifest.manifest_version, 3);
  assert.deepEqual([...manifest.permissions].sort(), ['alarms', 'sidePanel', 'storage']);
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

test('every vendored file is identical to its source (refresh with: npm run vendor)', async () => {
  const { VENDORED } = await import('../scripts/vendor-list.js');
  for (const f of VENDORED) {
    assert.equal(readFileSync(join(root, 'src/vendor', f), 'utf8'), readFileSync(join(root, '..', f), 'utf8'), f + ' is out of date');
  }
});

test('vendored files import nothing from node: and nothing outside the vendor folder', async () => {
  const { VENDORED } = await import('../scripts/vendor-list.js');
  for (const f of VENDORED) {
    const text = readFileSync(join(root, 'src/vendor', f), 'utf8');
    assert.ok(!/from 'node:|require\(/.test(text), f + ' uses node-only code');
    for (const m of text.matchAll(/from '(\.[^']+)'/g)) {
      const target = join(root, 'src/vendor', f, '..', m[1]);
      assert.ok(existsSync(target), f + ' imports ' + m[1] + ' which is not vendored');
    }
  }
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

test('the side-panel protocol mirror matches suite/agent/protocol.js', () => {
  const upstream = readFileSync(join(root, '..', 'agent', 'protocol.js'), 'utf8');
  const mine = readFileSync(join(root, 'src/agent/protocol.js'), 'utf8');
  for (const [name, expected] of [['PROTOCOL_VERSION', '1'], ['PANEL_SOURCE', "'tcgss-panel'"], ['AGENT_SOURCE', "'tcgss-agent'"], ['MAX_TEXT', '2000'], ['MAX_ID', '80']]) {
    const re = new RegExp(`export const ${name} = ([^;]+);`);
    assert.equal(upstream.match(re)?.[1], expected, 'upstream ' + name + ' changed');
    assert.equal(mine.match(re)?.[1], expected, 'mirror ' + name + ' out of date');
  }
  for (const event of ['agent.progress', 'agent.approval-needed', 'agent.answer', 'agent.stopped']) assert.ok(upstream.includes(`'${event}'`) && mine.includes(`'${event}'`), event);
});
