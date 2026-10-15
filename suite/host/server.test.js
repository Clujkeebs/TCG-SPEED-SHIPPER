import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { request } from 'node:http';
import { createHost } from './server.js';

const dir = mkdtempSync(join(tmpdir(), 'suite-host-'));
mkdirSync(join(dir, 'app', 'vendor'), { recursive: true });
writeFileSync(join(dir, 'index.html'), '<!doctype html><title>home</title>');
writeFileSync(join(dir, 'app', 'index.html'), '<!doctype html><title>app</title>');
writeFileSync(join(dir, 'app', 'big.js'), 'export const x = "' + 'a'.repeat(5000) + '";');
writeFileSync(join(dir, 'app', 'vendor', 'core.wasm'), Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]));
writeFileSync(join(dir, 'app', 'model.gz'), Buffer.from('already compressed'.repeat(100)));
writeFileSync(join(dir, '..secret-name-is-fine.txt'), 'ok');

function get(server, path, { method = 'GET', headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port: server.address().port, path, method, headers }, (res) => {
      const chunks = []; res.on('data', (c) => chunks.push(c)); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject); req.end();
  });
}
const up = (opts) => new Promise((resolve) => { const s = createHost({ root: dir, ...opts }); s.listen(0, '127.0.0.1', () => resolve(s)); });

test('serves files with the right type and safe headers', async () => {
  const s = await up();
  try {
    const r = await get(s, '/app/');
    assert.equal(r.status, 200);
    assert.match(r.headers['content-type'], /text\/html/);
    assert.equal(r.headers['x-content-type-options'], 'nosniff');
    assert.equal(r.headers['x-frame-options'], 'DENY');
    assert.match(r.headers['permissions-policy'], /camera=\(self\)/);
    assert.match(r.headers['permissions-policy'], /microphone=\(\)/);
    assert.equal(r.headers['x-robots-tag'], 'noindex, nofollow');
    assert.equal(r.headers['cache-control'], 'no-cache');
    const w = await get(s, '/app/vendor/core.wasm');
    assert.equal(w.headers['content-type'], 'application/wasm');
    assert.match(w.headers['cache-control'], /max-age=604800/);
    const g = await get(s, '/app/model.gz', { headers: { 'accept-encoding': 'gzip' } });
    assert.equal(g.headers['content-type'], 'application/gzip');
    assert.equal(g.headers['content-encoding'], undefined, 'an already compressed file is not compressed again');
  } finally { s.close(); }
});

test('folders: redirect to the slash form, no listing, no index means 404', async () => {
  const s = await up();
  try {
    const r = await get(s, '/app');
    assert.equal(r.status, 301); assert.equal(r.headers.location, '/app/');
    assert.equal((await get(s, '/app/vendor/')).status, 404);
  } finally { s.close(); }
});

test('nothing outside the folder, whatever the spelling', async () => {
  const s = await up();
  try {
    for (const p of ['/../package.json', '/app/../../etc/passwd', '/%2e%2e/%2e%2e/etc/passwd', '/app/%2e%2e%2f%2e%2e%2fetc/passwd', '/%00', '/%']) {
      const r = await get(s, p);
      assert.ok([400, 404].includes(r.status), p + ' -> ' + r.status);
      assert.doesNotMatch(r.body.toString(), /root:|"name"/);
    }
    assert.equal((await get(s, '/..secret-name-is-fine.txt')).status, 200, 'a file whose NAME starts with dots is still inside the folder');
  } finally { s.close(); }
});

test('only GET and HEAD; HEAD has no body', async () => {
  const s = await up();
  try {
    assert.equal((await get(s, '/', { method: 'POST' })).status, 405);
    assert.equal((await get(s, '/', { method: 'DELETE' })).status, 405);
    const h = await get(s, '/', { method: 'HEAD' });
    assert.equal(h.status, 200); assert.equal(h.body.length, 0);
  } finally { s.close(); }
});

test('gzip for big text when asked, plain otherwise; 304 on a matching ETag', async () => {
  const s = await up();
  try {
    const z = await get(s, '/app/big.js', { headers: { 'accept-encoding': 'gzip' } });
    assert.equal(z.headers['content-encoding'], 'gzip');
    assert.match(gunzipSync(z.body).toString(), /^export const x/);
    assert.ok(z.body.length < 500);
    const p = await get(s, '/app/big.js');
    assert.equal(p.headers['content-encoding'], undefined);
    assert.match(p.body.toString(), /^export const x/);
    const again = await get(s, '/app/big.js', { headers: { 'if-none-match': p.headers.etag } });
    assert.equal(again.status, 304);
  } finally { s.close(); }
});

test('health check and robots; HSTS only behind https', async () => {
  const s = await up();
  try {
    const h = await get(s, '/healthz'); assert.equal(h.status, 200); assert.equal(h.body.toString(), 'ok');
    assert.equal((await get(s, '/api/health')).status, 200, 'the Shipper\'s health check path also works here');
    const r = await get(s, '/robots.txt'); assert.match(r.body.toString(), /Disallow: \//);
    assert.equal(h.headers['strict-transport-security'], undefined);
    const t = await get(s, '/', { headers: { 'x-forwarded-proto': 'https' } });
    assert.match(t.headers['strict-transport-security'], /max-age=31536000/);
  } finally { s.close(); }
});

test('noindex can be switched off', async () => {
  const s = await up({ noindex: false });
  try {
    const r = await get(s, '/');
    assert.equal(r.headers['x-robots-tag'], undefined);
    assert.equal((await get(s, '/robots.txt')).status, 404);
  } finally { s.close(); }
});
