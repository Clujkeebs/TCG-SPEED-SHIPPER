// The browser scenario: fixture page -> content script -> service worker -> IndexedDB -> back.
// Run by extension.e2e.test.js in its own process group (exit code 0 = pass).
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const here = fileURLToPath(new URL('.', import.meta.url));
const extPath = join(here, '..');
const chromePath = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const pwPath = process.env.PLAYWRIGHT_PATH || '/opt/node22/lib/node_modules/playwright';

const order = {
  id: 'ord-e2e-1', source: 'tcgplayer', orderedAt: '2026-10-15T12:00:00Z', status: 'paid', buyerKey: 'b-e2e',
  shipTo: { name: 'Test Buyer', address1: '1 Example St', city: 'Testville', state: 'CA', postalCode: '90000', country: 'US' },
  items: [{ name: 'Sample Card', quantity: 1, priceCents: 150 }], itemsTotalCents: 150, shippingPaidCents: 99
};

async function main() {
  const { chromium } = createRequire(import.meta.url)(pwPath);
  const html = readFileSync(join(here, 'fixtures', 'shipper-fixture.html'));
  const server = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/html' }); res.end(html); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const profile = mkdtempSync(join(tmpdir(), 'tcgss-e2e-'));
  const ctx = await chromium.launchPersistentContext(profile, {
    executablePath: chromePath,
    headless: false,
    args: ['--headless=new', '--no-sandbox', '--no-proxy-server', '--disable-background-networking', '--disable-component-update', '--disable-breakpad', '--disable-sync', '--no-first-run', '--no-default-browser-check', `--disable-extensions-except=${extPath}`, `--load-extension=${extPath}`]
  });
  try {
    let [sw] = ctx.serviceWorkers();
    sw ??= await ctx.waitForEvent('serviceworker', { timeout: 15000 });
    const page = await ctx.newPage();
    // "localhost" is on the extension's allow-list; 127.0.0.1 is not, so use the name.
    await page.goto(`http://localhost:${port}/`);

    const hello = await page.evaluate(() => window.tcgssSend('hello'));
    assert.equal(hello.ok, true);
    assert.equal(hello.result.name, 'TCG Speed Suite');
    assert.ok(Object.values(hello.result.flags).every((v) => v === false), 'all flags off by default');

    const put = await page.evaluate((o) => window.tcgssSend('store.put', { collection: 'orders', record: o }), order);
    assert.deepEqual([put.ok, put.result.key], [true, 'ord-e2e-1']);

    const got = await page.evaluate(() => window.tcgssSend('store.get', { collection: 'orders', key: 'ord-e2e-1' }));
    assert.equal(got.result.record.items[0].name, 'Sample Card');

    // The result really sits in the service worker's IndexedDB.
    const inDb = await sw.evaluate(() => new Promise((resolve, reject) => {
      const open = indexedDB.open('tcgss_suite');
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const q = open.result.transaction('orders').objectStore('orders').get('ord-e2e-1');
        q.onsuccess = () => resolve(q.result && q.result.id);
        q.onerror = () => reject(q.error);
      };
    }));
    assert.equal(inDb, 'ord-e2e-1');

    // Rejections: bad record, and a message with the wrong shape.
    const bad = await page.evaluate(() => window.tcgssSend('store.put', { collection: 'orders', record: { id: 'x' } }));
    assert.equal(bad.ok, false);
    const unknown = await page.evaluate(() => window.tcgssSend('run.script', { code: '1' }));
    assert.equal(unknown.ok, false);

    // A page on an origin that is NOT allow-listed (127.0.0.1) gets no bridge at all.
    const stranger = await ctx.newPage();
    await stranger.goto(`http://127.0.0.1:${port}/`);
    const silent = await stranger.evaluate(() => Promise.race([
      window.tcgssSend('hello').then(() => 'answered'),
      new Promise((r) => setTimeout(() => r('silent'), 1500))
    ]));
    assert.equal(silent, 'silent', 'non-allow-listed origin must get no answer');
    await stranger.close();

    // The extension's own pages load without errors, and a TCGplayer flag stays inert.
    const extId = new URL(sw.url()).host;
    const problems = [];
    for (const file of ['options.html', 'popup.html', 'sidepanel.html']) {
      const ui = await ctx.newPage();
      ui.on('pageerror', (e) => problems.push(file + ': ' + e.message));
      ui.on('console', (m) => { if (m.type() === 'error') problems.push(file + ': ' + m.text()); });
      await ui.goto(`chrome-extension://${extId}/src/ui/${file}`);
      if (file === 'options.html') {
        await ui.waitForSelector('input[data-flag]');
        assert.equal(await ui.locator('input[data-flag]').count(), 4);
        await ui.check('input[data-flag="pasteTracking"]');
        await ui.check('input[data-flag="agentPanel"]');
        const res = await ui.evaluate(async () => {
          const f = await import('./../flags.js');
          return { flags: await f.getFlags(), paste: await f.isEnabled('pasteTracking'), agent: await f.isEnabled('agentPanel') };
        });
        assert.equal(res.flags.pasteTracking, true, 'the switch is saved');
        assert.equal(res.paste, false, 'but the TCGplayer module stays locked');
        assert.equal(res.agent, true);
      }
      await ui.close();
    }
    assert.deepEqual(problems, [], 'extension pages must load without errors');
  } finally {
    await ctx.close();
    server.close();
    rmSync(profile, { recursive: true, force: true });
  }
}

main().then(() => process.exit(0), (err) => { console.error(err); process.exit(1); });
