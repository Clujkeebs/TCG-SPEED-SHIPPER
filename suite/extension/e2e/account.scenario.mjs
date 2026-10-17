// Account link in real Chromium with a STUB of the site's status address (never the real site):
// the token goes from the page to the service worker, is used for one GET, is dropped at expiry / sign-out /
// Clear everything, and never lands in long-term storage, messages or logs. Exit 0 = pass.
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const here = fileURLToPath(new URL('.', import.meta.url));
const prod = join(here, '..');
const chromePath = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const pwPath = process.env.PLAYWRIGHT_PATH || '/opt/node22/lib/node_modules/playwright';
const { makeTestBuild } = await import(pathToFileURL(join(prod, 'scripts/make-test-build.js')).href);

const b64 = (s) => Buffer.from(s).toString('base64url');
const jwt = (tag) => `${b64('{"alg":"HS256"}')}.${b64(`{"sub":"user-${tag}"}`)}.${b64('signature-' + tag)}`;
const TOKEN = jwt('e2e-one');

async function main() {
  const { chromium } = createRequire(import.meta.url)(pwPath);
  const html = readFileSync(join(here, 'fixtures', 'shipper-fixture.html'));
  const seen = []; // what the stub server saw
  let mode = 'ok';
  const server = http.createServer((req, res) => {
    if (req.url === '/api/agent/status') {
      seen.push({ url: req.url, method: req.method, auth: req.headers.authorization, cookie: req.headers.cookie, referer: req.headers.referer, origin: req.headers.origin });
      const reply = { ok: [200, { available: true, remaining: { runsToday: 3 } }], plan: [200, { available: false, code: 'plan' }], off: [503, { error: 'internal detail we must not show', code: 'off' }], expired401: [401, { error: 'no' }] }[mode];
      res.writeHead(reply[0], { 'content-type': 'application/json' });
      return res.end(JSON.stringify(reply[1]));
    }
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(html);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const extPath = makeTestBuild(mkdtempSync(join(tmpdir(), 'tcgss-acct-build-')), { apiBase: `http://localhost:${port}` });
  const profile = mkdtempSync(join(tmpdir(), 'tcgss-acct-'));
  const ctx = await chromium.launchPersistentContext(profile, {
    executablePath: chromePath, headless: false,
    args: ['--headless=new', '--no-sandbox', '--no-proxy-server', '--disable-background-networking', '--disable-component-update', '--disable-breakpad', '--disable-sync', '--no-first-run', `--disable-extensions-except=${extPath}`, `--load-extension=${extPath}`]
  });
  const consoleLines = [];
  ctx.on('console', (m) => consoleLines.push(m.text()));
  try {
    let [sw] = ctx.serviceWorkers();
    sw ??= await ctx.waitForEvent('serviceworker', { timeout: 15000 });
    const extId = new URL(sw.url()).host;
    const setup = await ctx.newPage();
    await setup.goto(`chrome-extension://${extId}/src/ui/options.html`);
    await setup.evaluate(() => chrome.storage.local.set({ tcgss_flags_v1: { agentPanel: true, onlineAssistant: true }, tcgss_ui_v1: { tourDone: true } }));

    const site = await ctx.newPage();
    await site.goto(`http://localhost:${port}/`);
    const send = (type, payload) => site.evaluate(([t, p]) => window.tcgssSend(t, p), [type, payload]);
    const nowSec = () => Math.floor(Date.now() / 1000);
    const panelLine = async () => {
      const p = await ctx.newPage();
      p.on('console', (m) => consoleLines.push(m.text()));
      await p.setViewportSize({ width: 360, height: 700 });
      await p.goto(`chrome-extension://${extId}/src/ui/sidepanel.html`);
      await p.waitForSelector('#quick button');
      await p.waitForFunction(() => document.getElementById('account') && !document.getElementById('account').hidden);
      const out = { line: await p.textContent('#account'), button: await p.isVisible('#openSite'), overflow: await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth) };
      await p.close();
      return out;
    };

    // 1. nobody linked: one plain line, an "Open" button, and the stub heard nothing
    let r = await panelLine();
    assert.deepEqual([r.line, r.button, r.overflow], ['You are not signed in.', true, 0]);
    assert.equal(seen.length, 0, 'nothing is sent without a token');

    // 2. the site hands over the access token (and only that); the answer says nothing but linked
    const linked = await send('account.link', { accessToken: TOKEN, expiresAt: nowSec() + 3600 });
    assert.deepEqual([linked.ok, linked.result], [true, { linked: true }]);
    const refresh = await send('account.link', { accessToken: TOKEN, expiresAt: nowSec() + 3600, refresh_token: jwt('refresh') });
    assert.equal(refresh.ok, false, 'a refresh token is refused outright');
    assert.match(refresh.error, /never a refresh token/);

    // 3. available: "3 runs left today"; the stub saw exactly one GET with the token in the Authorization header only
    r = await panelLine();
    assert.deepEqual([r.line, r.button], ['The online assistant is available. 3 runs left today.', false]);
    assert.equal(seen.length, 1);
    assert.deepEqual([seen[0].url, seen[0].method, seen[0].auth], ['/api/agent/status', 'GET', 'Bearer ' + TOKEN]);
    assert.equal(seen[0].cookie, undefined, 'no cookies');
    assert.equal(seen[0].referer, undefined, 'no referrer');

    // 4. the other plain lines (each relink clears the one-minute memory)
    mode = 'plan';
    await send('account.link', { accessToken: TOKEN, expiresAt: nowSec() + 3600 });
    assert.equal((await panelLine()).line, 'The online assistant needs the Premium plan.');
    mode = 'off';
    await send('account.link', { accessToken: TOKEN, expiresAt: nowSec() + 3600 });
    r = await panelLine();
    assert.equal(r.line, 'The online assistant is not switched on yet.');
    assert.ok(!r.line.includes('internal detail'), 'server text is never shown');

    // 5. the site says 401: the token is forgotten and not sent again
    mode = 'expired401';
    await send('account.link', { accessToken: TOKEN, expiresAt: nowSec() + 3600 });
    r = await panelLine();
    assert.deepEqual([r.line, r.button], ['You are not signed in.', true]);
    const afterFour = seen.length;
    r = await panelLine();
    assert.equal(seen.length, afterFour, 'forgotten after a 401: nothing more is sent');

    // 6. an expired token is not sent
    mode = 'ok';
    await send('account.link', { accessToken: TOKEN, expiresAt: Date.now() + 2500 }); // milliseconds are fine too
    await site.waitForTimeout(3200);
    const beforeExpired = seen.length;
    r = await panelLine();
    assert.equal(r.line, 'You are not signed in.');
    assert.equal(seen.length, beforeExpired, 'an expired token is never sent');

    // 7. sign-out: the site says so and the token is gone
    await send('account.link', { accessToken: TOKEN, expiresAt: nowSec() + 3600 });
    assert.equal((await send('account.unlink')).result.linked, false);
    const beforeSignOut = seen.length;
    assert.equal((await panelLine()).line, 'You are not signed in.');
    assert.equal(seen.length, beforeSignOut);

    // 8. a page on another origin cannot supply a token (127.0.0.1 is not the site)
    const stranger = await ctx.newPage();
    await stranger.goto(`http://127.0.0.1:${port}/`);
    const silent = await stranger.evaluate(() => Promise.race([window.tcgssSend('account.link', { accessToken: 'aaaa.bbbb.cccc', expiresAt: Math.floor(Date.now() / 1000) + 3600 }).then(() => 'answered'), new Promise((r) => setTimeout(() => r('silent'), 1500))]));
    assert.equal(silent, 'silent');
    await stranger.close();
    assert.equal((await panelLine()).line, 'You are not signed in.');

    // 9. where the token lives while linked: session storage only. Search EVERYTHING else for it.
    await send('account.link', { accessToken: TOKEN, expiresAt: nowSec() + 3600 });
    await panelLine();
    const dump = await setup.evaluate(async () => {
      const out = { local: JSON.stringify(await chrome.storage.local.get(null)), session: JSON.stringify(await chrome.storage.session.get(null)), pageStorage: JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }), idb: [] };
      for (const d of await indexedDB.databases()) {
        const db = await new Promise((res) => { const o = indexedDB.open(d.name); o.onsuccess = () => res(o.result); });
        for (const name of db.objectStoreNames) out.idb.push(await new Promise((res) => { const q = db.transaction(name).objectStore(name).getAll(); q.onsuccess = () => res(JSON.stringify(q.result)); }));
        db.close();
      }
      return out;
    });
    assert.ok(dump.session.includes(TOKEN), 'session storage holds it (the one backup)');
    for (const where of ['local', 'pageStorage']) assert.ok(!dump[where].includes(TOKEN), `the token is in ${where}`);
    assert.ok(!dump.idb.join('').includes(TOKEN), 'the token is in IndexedDB');
    assert.ok(!consoleLines.join('\n').includes(TOKEN), 'the token is in a console log');
    for (const q of seen) assert.ok(!JSON.stringify({ ...q, auth: undefined }).includes(TOKEN), 'the token appeared outside the Authorization header');

    // 10. Clear everything forgets it
    await setup.click('#clearAsk');
    await setup.click('#clearYes');
    await setup.waitForSelector('text=Everything was erased');
    assert.deepEqual(await setup.evaluate(() => chrome.storage.session.get(null)), {}, 'session storage is empty');
    const beforeClear = seen.length;
    await setup.evaluate(() => chrome.storage.local.set({ tcgss_flags_v1: { agentPanel: true, onlineAssistant: true }, tcgss_ui_v1: { tourDone: true } }));
    assert.equal((await panelLine()).line, 'You are not signed in.');
    assert.equal(seen.length, beforeClear);
    console.log('account scenario ok');
  } finally {
    await ctx.close();
    server.close();
    rmSync(profile, { recursive: true, force: true });
    rmSync(extPath, { recursive: true, force: true });
  }
}
main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
