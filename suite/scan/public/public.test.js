import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const dir = dirname(fileURLToPath(import.meta.url));
const read = (f) => readFileSync(join(dir, f), 'utf8');

test('every file the service worker caches exists (a missing one breaks the whole install)', () => {
  const sw = read('sw.js');
  const files = [...sw.match(/const FILES = \[([\s\S]*?)\];/)[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
  assert.ok(files.length > 20);
  for (const f of files) {
    if (f === './') continue;
    assert.ok(existsSync(join(dir, f)), 'missing: ' + f);
  }
});

test('the service worker can wait for a tap and has one switch for auto-activation', () => {
  const sw = read('sw.js');
  assert.match(sw, /const AUTO_ACTIVATE = false;/); // a new version waits for the seller's tap
  assert.match(sw, /SKIP_WAITING/);
  assert.match(sw, /AUTO_ACTIVATE \? self\.skipWaiting\(\)/);
  assert.doesNotMatch(sw, /\.then\(\(\) => self\.skipWaiting\(\)\)/); // never unconditional
  assert.match(sw, /origin !== location\.origin\) return/); // card lookups are never cached or touched
});

test('home-screen app: icons, meta tags, manifest', () => {
  const html = read('index.html');
  for (const needle of ['apple-mobile-web-app-capable', 'apple-mobile-web-app-status-bar-style', 'apple-touch-icon', 'viewport-fit=cover']) assert.ok(html.includes(needle), needle);
  const m = JSON.parse(read('manifest.webmanifest'));
  assert.equal(m.display, 'standalone');
  for (const i of m.icons) assert.ok(existsSync(join(dir, i.src)), i.src);
  assert.ok(m.icons.some((i) => i.sizes === '512x512' && i.type === 'image/png'));
  const png = readFileSync(join(dir, 'icon-180.png'));
  assert.equal(png.readUInt32BE(16), 180); assert.equal(png.readUInt32BE(20), 180); // real 180x180 PNG
});

test('the video is inline and muted, and form fields are 16px or more (no zoom on tap in Safari)', () => {
  assert.match(read('index.html'), /<video id="video" playsinline muted/);
  const css = read('styles.css');
  assert.match(css, /input, select, button, textarea \{ font: 16px/);
  assert.match(css, /safe-area-inset-top/); assert.match(css, /safe-area-inset-bottom/);
  assert.doesNotMatch(css, /:hover\s*\{[^}]*display:\s*none/); // nothing that only appears on hover
  assert.match(read('camera.js'), /playsinline/);
});

test('every element the page code looks up by id exists in the page (a missing one stops the whole app)', () => {
  const html = read('index.html');
  const ids = new Set([...read('app.js').matchAll(/\$\('([A-Za-z0-9_-]+)'\)/g)].map((m) => m[1]));
  assert.ok(ids.size > 50);
  for (const id of ids) assert.ok(html.includes('id="' + id + '"'), 'no element with id ' + id);
});
