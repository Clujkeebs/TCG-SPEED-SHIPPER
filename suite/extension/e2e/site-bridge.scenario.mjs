// The web app's side of the account link (public/js/suite-bridge.js, the REAL file) talking to the REAL extension in real Chromium,
// against a STUB of the site's status address (never the real site). It proves the seam the unit tests cannot: that Chrome delivers the
// page's messages to the content script and the answers back with the origin and source the two sides check, that a login reaches the
// extension and is used once, that a renewed login replaces it, that sign-out takes it back, and that a browser WITHOUT the extension
// sees nothing but a hello. Exit 0 = pass.
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const here = fileURLToPath(new URL('.', import.meta.url));
const prod = join(here, '..');
const bridgeJs = readFileSync(join(here, '..', '..', '..', 'public', 'js', 'suite-bridge.js'));
const chromePath = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const pwPath = process.env.PLAYWRIGHT_PATH || '/opt/node22/lib/node_modules/playwright';
const { makeTestBuild } = await import(pathToFileURL(join(prod, 'scripts/make-test-build.js')).href);

const b64 = (s) => Buffer.from(s).toString('base64url');
const jwt = (tag) => `${b64('{"alg":"HS256"}')}.${b64(`{"sub":"user-${tag}"}`)}.${b64('signature-' + tag)}`;
const TOKEN_ONE = jwt('site-one');
const TOKEN_TWO = jwt('site-two');
const nowSec = () => Math.floor(Date.now() / 1000);
const session = (token) => ({ access_token: token, expires_at: nowSec() + 3600, refresh_token: 'REFRESH-SECRET-DO-NOT-LEAK', user: { email: 'seller@example.com' } });

// A page that behaves like the site: loads the real bridge script and calls sync() whenever the "login" changes.
const PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Pretend Speed Shipper</title></head><body><h1>Pretend site</h1>
<script>
  window.__posted = [];
  var realPost = window.postMessage.bind(window);
  window.postMessage = function (m, o) { try { window.__posted.push(JSON.parse(JSON.stringify(m))); } catch (e) {} return realPost(m, o); };
</script>
<script src="/js/suite-bridge.js"></script>
<script>
  var bridge = TCGSSBridge.create(window);
  window.sync = function (s) { return bridge.sync(s); };
</script></body></html>`;

async function main() {
  const { chromium } = createRequire(import.meta.url)(pwPath);
  const seen = []; // what the stub status address saw
  const server = http.createServer((req, res) => {
    if (req.url === '/api/agent/status') {
      seen.push({ method: req.method, auth: req.headers.authorization, cookie: req.headers.cookie, referer: req.headers.referer });
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ available: true, remaining: { runsToday: 3 } }));
    }
    if (req.url === '/js/suite-bridge.js') { res.writeHead(200, { 'content-type': 'text/javascript' }); return res.end(bridgeJs); }
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(PAGE);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const extPath = makeTestBuild(mkdtempSync(join(tmpdir(), 'tcgss-site-build-')), { apiBase: `http://localhost:${port}` });
  const profile = mkdtempSync(join(tmpdir(), 'tcgss-site-'));
  const ctx = await chromium.launchPersistentContext(profile, {
    executablePath: chromePath, headless: false,
    args: ['--headless=new', '--no-sandbox', '--no-proxy-server', '--disable-background-networking', '--disable-component-update', '--disable-breakpad', '--disable-sync', '--no-first-run', `--disable-extensions-except=${extPath}`, `--load-extension=${extPath}`],
  });
  let plain;
  try {
    let [sw] = ctx.serviceWorkers();
    sw ??= await ctx.waitForEvent('serviceworker', { timeout: 15000 });
    const extId = new URL(sw.url()).host;
    const setup = await ctx.newPage();
    await setup.goto(`chrome-extension://${extId}/src/ui/options.html`);
    await setup.evaluate(() => chrome.storage.local.set({ tcgss_flags_v1: { agentPanel: true, onlineAssistant: true }, tcgss_ui_v1: { tourDone: true } }));

    const panelLine = async () => {
      const p = await ctx.newPage();
      await p.setViewportSize({ width: 360, height: 700 });
      await p.goto(`chrome-extension://${extId}/src/ui/sidepanel.html`);
      await p.waitForSelector('#quick button');
      await p.waitForFunction(() => document.getElementById('account') && !document.getElementById('account').hidden);
      const line = await p.textContent('#account');
      await p.close();
      return line;
    };

    const site = await ctx.newPage();
    await site.goto(`http://localhost:${port}/`);

    // 1. signed out: the panel says so, and the stub heard nothing
    assert.equal(await panelLine(), 'You are not signed in.');
    assert.equal(seen.length, 0);

    // 2. the page's login changes: the page says hello, the extension answers, the token is linked and used for one status call
    await site.evaluate((s) => window.sync(s), session(TOKEN_ONE));
    assert.equal(await panelLine(), 'The online assistant is available. 3 runs left today.');
    assert.equal(seen.length, 1);
    assert.deepEqual([seen[0].method, seen[0].auth, seen[0].cookie, seen[0].referer], ['GET', 'Bearer ' + TOKEN_ONE, undefined, undefined]);
    const types1 = (await site.evaluate(() => window.__posted)).map((m) => m.type);
    assert.deepEqual(types1, ['hello', 'account.link']);

    // 3. the refresh token and the user never left the page (not in a message, not in the extension's storage, not in a request)
    const posted = JSON.stringify(await site.evaluate(() => window.__posted));
    assert.ok(!/REFRESH-SECRET|seller@example\.com/.test(posted), 'the page posted the refresh token or the user');
    const stored = await setup.evaluate(async () => JSON.stringify({ local: await chrome.storage.local.get(null), session: await chrome.storage.session.get(null) }));
    assert.ok(!/REFRESH-SECRET|seller@example\.com/.test(stored), 'the extension stored the refresh token or the user');
    assert.ok(!/REFRESH-SECRET|seller@example\.com/.test(JSON.stringify(seen)), 'a request carried the refresh token or the user');

    // 4. the same login again sends nothing new; a renewed login replaces the old one and is the one used next
    await site.evaluate((s) => window.sync(s), session(TOKEN_ONE));
    assert.equal((await site.evaluate(() => window.__posted)).length, 2, 'the same token is not sent twice');
    await site.evaluate((s) => window.sync(s), session(TOKEN_TWO));
    assert.deepEqual((await site.evaluate(() => window.__posted)).map((m) => m.type), ['hello', 'account.link', 'account.link']);
    assert.equal(await panelLine(), 'The online assistant is available. 3 runs left today.');
    assert.equal(seen.at(-1).auth, 'Bearer ' + TOKEN_TWO, 'the renewed token is the one used');

    // 5. sign-out: the page takes the token back, and the extension no longer sends it
    await site.evaluate(() => window.sync(null));
    const afterOut = seen.length;
    assert.equal(await panelLine(), 'You are not signed in.');
    assert.equal(seen.length, afterOut, 'nothing is sent after sign-out');
    assert.equal((await site.evaluate(() => window.__posted)).at(-1).type, 'account.unlink');

    // 6. a browser WITHOUT the extension: the page asks hello, nobody answers, and nothing about the login is ever posted
    const bare = await chromium.launch({ executablePath: chromePath, headless: true, args: ['--no-sandbox', '--no-proxy-server'] });
    plain = bare;
    const bp = await bare.newPage();
    await bp.goto(`http://localhost:${port}/`);
    await bp.evaluate((s) => { window.__pending = window.sync(s); }, session(TOKEN_ONE));
    await bp.evaluate(() => window.__pending); // resolves when the 2.5 s wait for an answer is over
    const barePosted = await bp.evaluate(() => window.__posted);
    assert.deepEqual(barePosted.map((m) => m.type), ['hello'], 'without the extension only a hello is posted');
    assert.ok(!JSON.stringify(barePosted).includes(TOKEN_ONE), 'the token left the page without an extension to receive it');

    console.log('site bridge scenario ok');
  } finally {
    if (plain) await plain.close();
    await ctx.close();
    server.close();
    rmSync(profile, { recursive: true, force: true });
    rmSync(extPath, { recursive: true, force: true });
  }
}
main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
