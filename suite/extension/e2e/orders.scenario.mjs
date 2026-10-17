// The seller's own order file in real Chromium: import 2,000 invented orders by keyboard, check time and
// memory, the Insights tab, the five quick actions, a worker restart in the middle, accessibility checks
// (keyboard, 360 px, contrast) and Clear everything. Exit 0 = pass.
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
const { makeOrderCsv, LAST_NAMES } = await import(pathToFileURL(join(extPath, 'test/helpers/orders-csv.js')).href);
const { parseOrderExport } = await import(pathToFileURL(join(extPath, 'src/orders/parser.js')).href);
const { repeatBuyers } = await import(pathToFileURL(join(extPath, 'src/vendor/agent/analytics.js')).href);

// WCAG contrast of every visible piece of text against what is behind it.
const contrastProblems = () => {
  const lum = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const parse = (c) => { const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(',').map((x) => parseFloat(x)); return { rgb: p.slice(0, 3), a: p[3] ?? 1 }; };
  const bgOf = (el) => { for (let e = el; e; e = e.parentElement) { const c = parse(getComputedStyle(e).backgroundColor); if (c && c.a > 0.9) return c.rgb; } return [255, 255, 255]; };
  const bad = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (!n.textContent.trim()) continue;
    const el = n.parentElement;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || el.closest('[hidden]') || el.disabled || el.closest(':disabled')) continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    const fg = parse(cs.color).rgb, bg = bgOf(el);
    const [a, b] = [lum(fg), lum(bg)];
    const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    const px = parseFloat(cs.fontSize), bold = parseInt(cs.fontWeight, 10) >= 700;
    const need = px >= 24 || (px >= 18.66 && bold) ? 3 : 4.5;
    if (ratio < need) bad.push(`${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''} "${n.textContent.trim().slice(0, 30)}" ${ratio.toFixed(2)} < ${need}`);
  }
  return bad;
};

async function main() {
  const { chromium } = createRequire(import.meta.url)(pwPath);
  const csv = makeOrderCsv(2000);
  const want = repeatBuyers(parseOrderExport(csv).orders);
  const profile = mkdtempSync(join(tmpdir(), 'tcgss-orders-'));
  const ctx = await chromium.launchPersistentContext(profile, {
    executablePath: chromePath, headless: false,
    args: ['--headless=new', '--no-sandbox', '--no-proxy-server', '--disable-background-networking', '--disable-component-update', '--disable-breakpad', '--disable-sync', '--no-first-run', '--enable-precise-memory-info', `--disable-extensions-except=${extPath}`, `--load-extension=${extPath}`]
  });
  try {
    let [sw] = ctx.serviceWorkers();
    sw ??= await ctx.waitForEvent('serviceworker', { timeout: 15000 });
    const extId = new URL(sw.url()).host;
    const setup = await ctx.newPage();
    await setup.goto(`chrome-extension://${extId}/src/ui/options.html`);
    await setup.evaluate(() => chrome.storage.local.set({ tcgss_flags_v1: { agentPanel: true }, tcgss_ui_v1: { tourDone: true } }));
    await setup.close();

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
    assert.equal(await panel.locator('#quick button').count(), 5, 'five big buttons');
    assert.deepEqual(await panel.locator('#quick button').allTextContents(), ['What should I do today?', 'Who are my repeat buyers?', 'Where do I ship most?', 'Write my weekly summary', 'Draft a reply']);
    assert.deepEqual(await panel.evaluate(contrastProblems), [], 'contrast on the Assistant tab');
    // the checker itself must be able to fail: a deliberately pale line is caught, then removed
    const caught = await panel.evaluate((fn) => { const e = document.createElement('p'); e.id = 'pale'; e.style.color = '#aaaaaa'; e.textContent = 'pale text'; document.getElementById('body').append(e); const out = (0, eval)('(' + fn + ')')(); e.remove(); return out; }, contrastProblems.toString());
    assert.equal(caught.length, 1, 'the contrast check catches pale text: ' + JSON.stringify(caught));

    // ---- keyboard: arrow keys move between the tabs; Enter on the drop area opens the file chooser
    await panel.focus('#tab-assistant');
    await panel.keyboard.press('ArrowRight');
    assert.equal(await panel.getAttribute('#tab-insights', 'aria-selected'), 'true');
    assert.equal(await panel.evaluate(() => document.activeElement.id), 'tab-insights');
    assert.equal(await panel.isVisible('#panel-insights'), true);
    assert.equal(await panel.isVisible('#form'), false, 'the question box belongs to the Assistant tab');
    await panel.focus('#drop');

    // ---- import 2,000 invented orders by keyboard, with time and memory
    const heap0 = await panel.evaluate(() => performance.memory.usedJSHeapSize);
    const t0 = Date.now();
    // Enter on the drop area opens the file chooser. Under a heavy machine the first key press can be too early, so try again.
    let chooser;
    for (let attempt = 1; attempt <= 3 && !chooser; attempt++) {
      await panel.focus('#drop');
      [chooser] = await Promise.all([panel.waitForEvent('filechooser', { timeout: 6000 }).catch(() => null), panel.keyboard.press('Enter')]);
    }
    assert.ok(chooser, 'Enter on the drop area opens the file chooser');
    await chooser.setFiles({ name: 'orders-export.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
    await panel.waitForFunction(() => /^Done\. 2,000 orders/.test(document.getElementById('importStatus').textContent), null, { timeout: 20000 });
    const importMs = Date.now() - t0;
    const heap1 = await panel.evaluate(() => performance.memory.usedJSHeapSize);
    console.log(`import: ${importMs} ms, heap +${((heap1 - heap0) / 1048576).toFixed(1)} MB`);
    assert.ok(importMs < 8000, `import took ${importMs} ms`);
    assert.ok(heap1 - heap0 < 100 * 1048576, 'memory grew by less than 100 MB');

    // ---- Insights: plain numbers, first name + initial only, nothing else about a buyer
    const ins = await panel.innerText('#insights');
    assert.match(ins, /overview/i);
    assert.match(ins, /2,000/);
    assert.match(ins, /latest week/i);
    assert.match(ins, /repeat buyers/i);
    assert.match(ins, /where you ship most/i);
    assert.match(ins, /busiest days/i);
    const labels = await panel.locator('#insights h2:has-text("Repeat buyers") ~ ul li span').allTextContents();
    assert.ok(labels.length === 5 && labels.every((l) => /^[A-Z][a-z]+ [A-Z]\.$/.test(l)), 'labels: ' + labels.join(' | '));
    const everything = await panel.evaluate(() => document.body.innerText);
    for (const last of LAST_NAMES) assert.ok(!everything.includes(last), 'full last name on screen: ' + last);
    assert.ok(!/Example St|62701|97201/.test(everything), 'no addresses on screen');
    assert.match(await panel.textContent('#practice'), /Using your 2,000 imported orders/);
    assert.equal(await panel.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), 0, 'no sideways scroll at 360 px (Insights)');
    assert.deepEqual(await panel.evaluate(contrastProblems), [], 'contrast on the Insights tab');

    // ---- the five quick actions, run against the imported orders
    await panel.click('#tab-assistant');
    const answers = async () => panel.locator('.msg.answer').allTextContents();
    const waitIdle = async () => { await panel.waitForFunction(() => [...document.querySelectorAll('#quick button')].every((b) => !b.disabled), null, { timeout: 15000 }); };
    const run = async (id) => { const before = (await answers()).length; await panel.click(`#quick button[data-quick=${id}]`); await panel.waitForFunction((n) => document.querySelectorAll('.msg.answer').length > n, before, { timeout: 15000 }); await waitIdle(); return (await answers()).at(-1); };
    const today = await run('today');
    assert.match(today, /^1\. /);
    const repeat = await run('repeat');
    assert.match(repeat, new RegExp(`✓ ${want.repeatBuyers} of ${want.buyers} buyers ordered more than once`));
    const ship = await run('ship');
    assert.match(ship, /✓ about [\d.]+ orders a week, busiest on \w+; top state [A-Z]{2}/);
    const weekly = await run('weekly');
    assert.match(weekly, /^✓ /);
    const reply = await run('reply');
    assert.match(reply, /Every message has a reply|No messages/i, 'an honest "nothing to do": the order file has no buyer messages');
    for (const [id, text] of Object.entries({ repeat, ship, weekly, reply })) assert.ok(!/waiting-approval|card-\d|Goal:|\bb-[a-z0-9]{4,}\b/.test(text), id + ' is plain: ' + text);
    assert.ok((await panel.locator('#planlist li').count()) >= 1, 'the plan is shown');
    assert.deepEqual(await panel.evaluate(contrastProblems), [], 'contrast after quick actions');

    // ---- restart the worker mid-way: the imported orders are still used
    for (const v of [...versions.values()].filter((v) => v.runningStatus === 'running' && v.scriptURL.includes(extId))) await cdp.send('ServiceWorker.stopWorker', { versionId: v.versionId });
    await panel.waitForTimeout(500);
    const again = await run('repeat');
    assert.match(again, new RegExp(`✓ ${want.repeatBuyers} of ${want.buyers} buyers ordered more than once`), 'same answer after the worker restarted');

    // ---- back to the practice shop, and import again
    await panel.click('#tab-insights');
    await panel.click('#removeOrders');
    await panel.waitForFunction(() => /practice shop/.test(document.getElementById('importStatus').textContent));
    assert.match(await panel.textContent('#practice'), /Practice mode/);
    assert.equal(await panel.innerText('#insights'), '');
    const chooser2 = Promise.all([panel.waitForEvent('filechooser'), panel.click('#chooseFile')]);
    await (await chooser2)[0].setFiles({ name: 'orders-export.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
    await panel.waitForFunction(() => /^Done\. 2,000 orders/.test(document.getElementById('importStatus').textContent), null, { timeout: 20000 });

    // a wrong file is explained, not crashed on
    const chooser3 = Promise.all([panel.waitForEvent('filechooser'), panel.click('#chooseFile')]);
    await (await chooser3)[0].setFiles({ name: 'pull-sheet.csv', mimeType: 'text/csv', buffer: Buffer.from('Product Name,Quantity,Set\nSome Card,2,Some Set\n') });
    await panel.waitForFunction(() => /pull sheet/.test(document.getElementById('importStatus').textContent));
    assert.equal(await panel.getAttribute('#importStatus', 'class'), 'err');
    assert.match(await panel.innerText('#insights'), /2,000/, 'the good orders are untouched by a bad file');

    // ---- Clear everything removes the orders (and says so)
    const opt = await ctx.newPage();
    await opt.setViewportSize({ width: 360, height: 700 });
    await opt.goto(`chrome-extension://${extId}/src/ui/options.html`);
    await opt.click('#clearAsk');
    assert.match(await opt.textContent('#clearQ'), /including the history/);
    assert.match(await opt.textContent('.what + #clearAsk, body'), /imported orders/);
    await opt.click('#clearYes');
    await opt.waitForSelector('text=Everything was erased');
    const left = await opt.evaluate(() => new Promise((resolve) => { const o = indexedDB.open('tcgss_suite'); o.onsuccess = () => { const q = o.result.transaction('orders').objectStore('orders').count(); q.onsuccess = () => resolve(q.result); }; }));
    assert.equal(left, 0, 'imported orders are gone');
    assert.deepEqual(await opt.evaluate(() => chrome.storage.local.get(null)), {});
    assert.deepEqual(errors, [], 'no page errors');
    console.log('orders scenario ok');
  } finally {
    await ctx.close();
    rmSync(profile, { recursive: true, force: true });
  }
}
main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
