// The seller's own STOCK file in real Chromium: import by choosing a file, the Agent switches to it, repricing
// plans over the real stock, price changes survive a killed worker, wrong files are explained, going back,
// Clear everything, and 360 px / contrast checks on the new section. Exit 0 = pass.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const here = fileURLToPath(new URL('.', import.meta.url));
const extPath = join(here, '..');
const chromePath = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const pwPath = process.env.PLAYWRIGHT_PATH || '/opt/node22/lib/node_modules/playwright';
const { contrastProblems } = await import(pathToFileURL(join(here, 'a11y.mjs')).href);
const { makeStockCsv } = await import(pathToFileURL(join(extPath, 'test/helpers/stock-csv.js')).href);
const { makeOrderCsv } = await import(pathToFileURL(join(extPath, 'test/helpers/orders-csv.js')).href);
const { parseStockExport } = await import(pathToFileURL(join(extPath, 'src/stock/parser.js')).href);

async function main() {
  const { chromium } = createRequire(import.meta.url)(pwPath);
  const csv = makeStockCsv(300);
  const expect = parseStockExport(csv);
  const profile = mkdtempSync(join(tmpdir(), 'tcgss-stock-'));
  const ctx = await chromium.launchPersistentContext(profile, {
    executablePath: chromePath, headless: false,
    args: ['--headless=new', '--no-sandbox', '--no-proxy-server', '--disable-background-networking', '--disable-component-update', '--disable-breakpad', '--disable-sync', '--no-first-run', `--disable-extensions-except=${extPath}`, `--load-extension=${extPath}`]
  });
  try {
    let [sw] = ctx.serviceWorkers();
    sw ??= await ctx.waitForEvent('serviceworker', { timeout: 15000 });
    const extId = new URL(sw.url()).host;
    const setup = await ctx.newPage();
    await setup.goto(`chrome-extension://${extId}/src/ui/options.html`);
    await setup.evaluate(() => chrome.storage.local.set({ tcgss_flags_v1: { agentPanel: true }, tcgss_ui_v1: { tourDone: true } }));

    const panel = await ctx.newPage();
    const errors = [];
    panel.on('pageerror', (e) => errors.push(e.message));
    const cdp = await ctx.newCDPSession(panel);
    const versions = new Map();
    cdp.on('ServiceWorker.workerVersionUpdated', (e) => { for (const v of e.versions) versions.set(v.versionId, v); });
    await cdp.send('ServiceWorker.enable');
    await panel.setViewportSize({ width: 360, height: 700 });
    await panel.goto(`chrome-extension://${extId}/src/ui/sidepanel.html`);
    await panel.waitForSelector('#quick button');
    await panel.click('#tab-insights');

    const choose = async (button, file) => { const [c] = await Promise.all([panel.waitForEvent('filechooser'), panel.click(button)]); await c.setFiles(file); };
    const status = (id) => panel.waitForFunction((i) => document.getElementById(i).textContent.length > 0 && !/^Reading/.test(document.getElementById(i).textContent), id);

    // ---- a wrong file first: the order export into the stock chooser, and a stock file into the order chooser
    await choose('#chooseStock', { name: 'orders.csv', mimeType: 'text/csv', buffer: Buffer.from(makeOrderCsv(5)) });
    await status('stockStatus');
    assert.match(await panel.textContent('#stockStatus'), /product id and quantity columns/);
    assert.equal(await panel.getAttribute('#stockStatus', 'class'), 'err');
    await choose('#chooseFile', { name: 'stock.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
    await status('importStatus');
    assert.match(await panel.textContent('#importStatus'), /buyer name, address and order date columns/);
    assert.match(await panel.textContent('#practice'), /Practice mode/, 'a wrong file changed nothing');

    // ---- the real stock file
    const t0 = Date.now();
    await choose('#chooseStock', { name: 'inventory-export.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
    await panel.waitForFunction(() => /^Done\./.test(document.getElementById('stockStatus').textContent), null, { timeout: 20000 });
    console.log(`stock import: ${Date.now() - t0} ms for ${expect.items.length} rows`);
    assert.match(await panel.textContent('#stockStatus'), new RegExp(`Done\\. ${expect.items.length.toLocaleString('en-US')} stock rows for 300 cards`));
    assert.match(await panel.textContent('#practice'), /Using your .* stock rows\./);
    assert.match(await panel.textContent('#practice'), /orders and messages are still made up/);
    assert.equal(await panel.isVisible('#removeStock'), true);
    assert.equal(await panel.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), 0, 'no sideways scroll at 360 px');
    assert.deepEqual(await panel.evaluate(contrastProblems), [], 'contrast of the Insights tab with the stock section');

    // ---- repricing now plans over the REAL stock
    await panel.click('#tab-assistant');
    await panel.fill('#goal', 'Reprice my cards 5% under market');
    await panel.press('#goal', 'Enter');
    await panel.waitForSelector('.card button[data-answer=approve]');
    const cardText = await panel.textContent('.card');
    const planned = Number(/price of (\d+) cards/.exec(cardText)[1]);
    assert.ok(planned > 8 && planned <= 100, `plans over the real stock: ${planned} cards`);
    const firstFrom = /goes from (\$[\d,.]+)/.exec(cardText)[1];
    await panel.click('.card button[data-answer=approve]');
    await panel.waitForSelector('text=You approved this.');
    // the panel shows "approved" the moment the button is pressed; wait until the Agent has really finished before the kill
    await panel.waitForSelector('text=All the steps are finished.');

    // ---- kill the worker: the stock and the new prices come back
    for (const v of [...versions.values()].filter((v) => v.runningStatus === 'running' && v.scriptURL.includes(extId))) await cdp.send('ServiceWorker.stopWorker', { versionId: v.versionId });
    await panel.waitForTimeout(500);
    await panel.fill('#goal', 'Reprice my cards 5% under market');
    await panel.press('#goal', 'Enter');
    await panel.waitForFunction(() => document.querySelectorAll('.card button[data-answer=approve]').length === 1, null, { timeout: 15000 });
    const secondText = await panel.textContent('.card button[data-answer=approve] >> xpath=ancestor::div[contains(@class,"card")]');
    const secondFrom = /goes from (\$[\d,.]+)/.exec(secondText)[1];
    assert.notEqual(secondFrom, firstFrom, 'the first 100 prices stayed changed after the restart, so the next plan starts on other cards');
    const saved = await setup.evaluate(async () => Object.keys((await chrome.storage.local.get('tcgss_agent_state_v2')).tcgss_agent_state_v2.prices).length);
    assert.equal(saved, 100, 'only the 100 changed prices are saved, not the whole stock');
    assert.match(await panel.textContent('#practice'), /stock rows/, 'and the stock is still the imported one');
    await panel.click('.card button[data-answer=deny]');

    // ---- going back to the practice stock, then Clear everything removes the real one
    await panel.click('#tab-insights');
    await panel.click('#removeStock');
    await panel.waitForFunction(() => /practice stock/.test(document.getElementById('stockStatus').textContent));
    assert.match(await panel.textContent('#practice'), /Practice mode/);
    await choose('#chooseStock', { name: 'inventory-export.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
    await panel.waitForFunction(() => /^Done\./.test(document.getElementById('stockStatus').textContent), null, { timeout: 20000 });

    const opt = await ctx.newPage();
    await opt.goto(`chrome-extension://${extId}/src/ui/options.html`);
    assert.match(await opt.textContent('body'), /your imported orders and stock/);
    await opt.click('#clearAsk');
    await opt.click('#clearYes');
    await opt.waitForSelector('text=Everything was erased');
    const counts = await opt.evaluate(() => new Promise((resolve) => { const o = indexedDB.open('tcgss_suite'); o.onsuccess = () => { const db = o.result; const c = (n) => new Promise((r) => { const q = db.transaction(n).objectStore(n).count(); q.onsuccess = () => r(q.result); }); Promise.all([c('inventory'), c('printings')]).then(([inventory, printings]) => resolve({ inventory, printings })); }; }));
    assert.deepEqual(counts, { inventory: 0, printings: 0 }, 'the imported stock is gone');
    assert.deepEqual(errors, [], 'no page errors');
    console.log('stock scenario ok');
  } finally {
    await ctx.close();
    rmSync(profile, { recursive: true, force: true });
  }
}
main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
