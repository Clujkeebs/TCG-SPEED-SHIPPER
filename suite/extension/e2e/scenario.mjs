// The browser scenario: fixture page -> content script -> service worker -> IndexedDB -> back.
// Run by extension.e2e.test.js in its own process group (exit code 0 = pass).
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const prodPath = join(here, '..');
// The browser test uses a TEST COPY of the extension that also accepts localhost pages. Production never does.
const { DB_VERSION } = await import(pathToFileURL(join(prodPath, 'src/store.js')).href);
const { makeTestBuild } = await import(pathToFileURL(join(prodPath, 'scripts/make-test-build.js')).href);
const extPath = makeTestBuild(mkdtempSync(join(tmpdir(), 'tcgss-testbuild-')));
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

    // The page can call exactly two things. hello gives out name and version only.
    const hello = await page.evaluate(() => window.tcgssSend('hello'));
    assert.equal(hello.ok, true);
    assert.deepEqual(Object.keys(hello.result).sort(), ['name', 'version']);
    assert.equal(hello.result.name, 'TCG Speed Suite');

    // The seller's imported orders sit in the extension's storage (written by an extension page, as the panel does)...
    const extId = new URL(sw.url()).host;
    const setup = await ctx.newPage();
    await setup.goto(`chrome-extension://${extId}/src/ui/options.html`);
    await setup.evaluate(([o, version]) => new Promise((resolve, reject) => {
      const open = indexedDB.open('tcgss_suite', version);
      open.onupgradeneeded = () => { for (const c of ['printings', 'orders', 'listings', 'inventory', 'scans', 'trackingBatches']) if (!open.result.objectStoreNames.contains(c)) open.result.createObjectStore(c); };
      open.onerror = () => reject(open.error);
      open.onsuccess = () => { const tx = open.result.transaction('orders', 'readwrite'); tx.objectStore('orders').put(o, o.id); tx.oncomplete = () => resolve(); };
    }), [order, DB_VERSION]);
    await setup.close();

    // ...and NO message from a page can read, list or overwrite them (or anything else).
    const attempts = [['store.list', { collection: 'orders' }], ['store.get', { collection: 'orders', key: 'ord-e2e-1' }], ['store.put', { collection: 'orders', record: { ...order, status: 'hacked' } }], ['store.list', { collection: 'inventory' }], ['tracking.get', { batchId: 'e2e-batch' }], ['tracking.list', undefined], ['agent.audit', undefined], ['clear-everything', undefined], ['run.script', { code: '1' }]];
    for (const [type, payload] of attempts) {
      const r = await page.evaluate(([t, p]) => window.tcgssSend(t, p), [type, payload]);
      assert.equal(r.ok, false, type + ' must be refused');
      assert.equal(r.error, 'unknown type', type);
      assert.ok(!JSON.stringify(r).includes('Test Buyer'), type + ' leaked buyer data');
    }
    const untouched = await ctx.newPage();
    await untouched.goto(`chrome-extension://${extId}/src/ui/options.html`);
    const stored = await untouched.evaluate(() => new Promise((resolve) => { const o = indexedDB.open('tcgss_suite'); o.onsuccess = () => { const q = o.result.transaction('orders').objectStore('orders').get('ord-e2e-1'); q.onsuccess = () => resolve(q.result); }; }));
    assert.deepEqual([stored.id, stored.status, stored.shipTo.name], ['ord-e2e-1', 'paid', 'Test Buyer'], 'the order is untouched');
    await untouched.close();

    // Tracking batch from the site: accepted and stored (write only); a malformed one is refused.
    const tb = await page.evaluate(() => window.tcgssSend('tracking.put', { batchId: 'e2e-batch', items: [{ orderId: 'SYN-9', trackingNumber: '9400 1000 0000 0000', carrier: 'USPS' }] }));
    assert.deepEqual([tb.ok, tb.result.count], [true, 1]);
    assert.deepEqual(Object.keys(tb.result).sort(), ['count', 'key']);
    const tbad = await page.evaluate(() => window.tcgssSend('tracking.put', { batchId: 'e2e-bad', items: [{ orderId: 'SYN-9', trackingNumber: 'x', carrier: 'USPS' }] }));
    assert.equal(tbad.ok, false);

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
    // Side panel (agent flag is on from the step above): goal, plan, approval card, memory, stop.
    const panel = await ctx.newPage();
    panel.on('pageerror', (e) => problems.push('sidepanel: ' + e.message));
    await panel.setViewportSize({ width: 360, height: 640 });
    await panel.goto(`chrome-extension://${extId}/src/ui/sidepanel.html`);
    await panel.waitForSelector('#memlist li');
    assert.equal(await panel.locator('#memlist li').count(), 2);
    // First-run tour: shown once, keyboard reachable, remembered after Skip.
    await panel.waitForSelector('#tour:not([hidden])');
    assert.match(await panel.textContent('#tourTitle'), /practice mode/);
    assert.equal(await panel.evaluate(() => document.activeElement.id), 'tourTitle', 'focus moves into the tour');
    await panel.click('#tourNext');
    assert.match(await panel.textContent('#tourTitle'), /last word/);
    await panel.click('#tourBack');
    await panel.keyboard.press('Escape');
    await panel.waitForSelector('#tour', { state: 'hidden' });
    assert.equal(await panel.evaluate(() => document.activeElement.id), 'goal', 'focus returns to the question box');
    // Keyboard only: Enter sends; the new card takes focus; Tab reaches Approve; Enter approves.
    await panel.waitForSelector('#suglist li');
    assert.ok((await panel.locator('#suglist li').count()) >= 2, 'weekly suggestions are shown');
    await panel.fill('#goal', 'Reprice my cards 5% under market');
    await panel.press('#goal', 'Enter');
    await panel.waitForSelector('.card button[data-answer=approve]');
    assert.equal(await panel.evaluate(() => document.activeElement.className), 'card', 'the approval card takes keyboard focus');
    // 360 px wide: nothing may push the page sideways.
    const overflow = await panel.evaluate(() => ({ doc: document.documentElement.scrollWidth - document.documentElement.clientWidth, main: document.getElementById('body').scrollWidth - document.getElementById('body').clientWidth }));
    assert.deepEqual(overflow, { doc: 0, main: 0 }, 'no sideways scrolling at 360 px');
    await panel.keyboard.press('Tab');
    assert.equal(await panel.evaluate(() => document.activeElement.dataset.answer), 'approve');
    const cardText = await panel.textContent('.card');
    assert.match(cardText, /Why:/);
    assert.match(cardText, /Undo:/);
    assert.match(cardText, /What will change:/);
    assert.match(await panel.textContent('#planlist'), /Save the new prices/);
    assert.equal(await panel.locator('#memlist li').count(), 2);
    await panel.keyboard.press('Enter');
    await panel.waitForSelector('text=You approved this.');
    await panel.click('button[data-undo]');
    await panel.waitForSelector('text=Put back as it was.');
    // Memory: the assistant proposes, the seller approves, then can forget it.
    await panel.fill('#goal', 'remember that I close on Sundays');
    await panel.press('#goal', 'Enter');
    await panel.waitForSelector('.card button[data-answer=approve]');
    await panel.click('.card button[data-answer=approve]');
    await panel.waitForFunction(() => document.querySelectorAll('#memlist li').length === 3);
    await panel.click('#memlist li:last-child button[data-forget]');
    await panel.waitForFunction(() => document.querySelectorAll('#memlist li').length === 2);
    // Stop keeps a waiting card waiting.
    await panel.fill('#goal', 'Reprice my cards 5% under market');
    await panel.press('#goal', 'Enter');
    await panel.waitForSelector('.card button[data-answer=deny]');
    await panel.click('#stop');
    await panel.waitForSelector('#resume:not([hidden])');
    assert.equal(await panel.isDisabled('#go'), true, 'no new goal while stopped');
    assert.equal(await panel.locator('.card button[data-answer=approve]').count(), 1, 'the card is still waiting');
    await panel.click('#resume');
    await panel.waitForSelector('#stop:not([hidden])');
    await panel.close();
    const pop = await ctx.newPage();
    await pop.goto(`chrome-extension://${extId}/src/ui/popup.html`);
    await pop.waitForSelector('#status li');
    assert.match(await pop.textContent('#status'), /Paste tracking\s*Locked/);
    await pop.close();
    // Settings at 360 px, then Clear everything (asks first; erases data, audit and the tour flag).
    const opt = await ctx.newPage();
    await opt.setViewportSize({ width: 360, height: 640 });
    opt.on('pageerror', (e) => problems.push('options: ' + e.message));
    await opt.goto(`chrome-extension://${extId}/src/ui/options.html`);
    await opt.waitForSelector('#clearAsk');
    assert.equal(await opt.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), 0, 'settings fit 360 px');
    await opt.click('#clearAsk');
    await opt.click('#clearNo');
    assert.ok(Object.keys(await opt.evaluate(() => chrome.storage.local.get(null))).length > 0, 'saying No erases nothing');
    await opt.click('#clearAsk');
    await opt.click('#clearYes');
    await opt.waitForSelector('text=Everything was erased');
    assert.deepEqual(await opt.evaluate(() => chrome.storage.local.get(null)), {}, 'settings and saved state are gone');
    const after = await opt.evaluate(() => new Promise((resolve) => { const o = indexedDB.open('tcgss_suite'); o.onsuccess = () => { const db = o.result; const count = (n) => new Promise((r) => { const q = db.transaction(n).objectStore(n).count(); q.onsuccess = () => r(q.result); }); Promise.all([count('orders'), count('trackingBatches')]).then(([orders, tracking]) => resolve({ orders, tracking })); }; }));
    assert.deepEqual(after, { orders: 0, tracking: 0 }, 'stored records are gone');
    const audit = await opt.evaluate(async () => (await chrome.runtime.sendMessage({ source: 'tcgss-panel', v: 1, id: 'a1', type: 'agent.audit' })));
    assert.equal(audit.ok, false, 'with the switch cleared the panel is off again');
    await opt.close();
    assert.deepEqual(problems, [], 'extension pages must load without errors');
  } finally {
    await ctx.close();
    server.close();
    rmSync(profile, { recursive: true, force: true });
    rmSync(extPath, { recursive: true, force: true });
  }
}

main().then(() => process.exit(0), (err) => { console.error(err); process.exit(1); });
