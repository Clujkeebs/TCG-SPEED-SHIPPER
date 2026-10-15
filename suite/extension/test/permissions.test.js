import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = join(fileURLToPath(import.meta.url), '..', '..');
const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));
const doc = readFileSync(join(root, '..', '..', 'docs/suite/EXTENSION-PERMISSIONS.md'), 'utf8');

const fromManifest = () => new Set([
  ...(manifest.permissions ?? []),
  ...(manifest.optional_permissions ?? []),
  ...(manifest.host_permissions ?? []),
  ...(manifest.optional_host_permissions ?? []),
  ...(manifest.content_scripts ?? []).flatMap((c) => c.matches ?? []),
  ...Object.values(manifest.externally_connectable ?? {}).flat()
]);
const fromDoc = () => new Set([...doc.matchAll(/^\| `([^`]+)` \|/gm)].map((m) => m[1]));

test('every permission, host and page match in the manifest has a row in the permissions doc', () => {
  const documented = fromDoc();
  for (const item of fromManifest()) assert.ok(documented.has(item), `manifest has ${item} but docs/suite/EXTENSION-PERMISSIONS.md does not`);
});

test('the permissions doc lists nothing the manifest does not ask for', () => {
  const asked = fromManifest();
  for (const item of fromDoc()) assert.ok(asked.has(item), `the doc lists ${item} but the manifest does not ask for it`);
});

test('no broad access: no all-sites match, no wildcard host, no powerful permissions', () => {
  const all = [...fromManifest()];
  for (const item of all) {
    assert.ok(!/<all_urls>|\*:\/\/\*\/|^\*:|^https?:\/\/\*\//.test(item), item + ' is too broad');
  }
  const banned = ['tabs', 'activeTab', 'cookies', 'history', 'webRequest', 'webRequestBlocking', 'scripting', 'downloads', 'management', 'nativeMessaging', 'debugger', 'proxy', 'declarativeNetRequest', 'identity', 'clipboardRead'];
  for (const b of banned) assert.ok(!all.includes(b), b + ' must not be requested');
  assert.equal(manifest.externally_connectable, undefined, 'no direct line from web pages to the worker');
});

test('TCGplayer is never an install-time host or a content script match', () => {
  assert.equal((manifest.host_permissions ?? []).some((h) => /tcgplayer/i.test(h)), false);
  for (const c of manifest.content_scripts) for (const m of c.matches) assert.ok(!/tcgplayer/i.test(m));
});
