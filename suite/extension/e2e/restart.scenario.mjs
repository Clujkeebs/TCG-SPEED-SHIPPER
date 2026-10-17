// Forced service-worker restart in real Chromium: the Agent's state must survive. Exit 0 = pass.
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const extPath = join(fileURLToPath(import.meta.url), '..', '..');
const chromePath = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const pwPath = process.env.PLAYWRIGHT_PATH || '/opt/node22/lib/node_modules/playwright';

async function main() {
  const { chromium } = createRequire(import.meta.url)(pwPath);
  const profile = mkdtempSync(join(tmpdir(), 'tcgss-restart-'));
  const ctx = await chromium.launchPersistentContext(profile, {
    executablePath: chromePath, headless: false,
    args: ['--headless=new', '--no-sandbox', '--no-proxy-server', '--disable-background-networking', '--disable-component-update', '--disable-breakpad', '--disable-sync', '--no-first-run', `--disable-extensions-except=${extPath}`, `--load-extension=${extPath}`]
  });
  try {
    let [sw] = ctx.serviceWorkers();
    sw ??= await ctx.waitForEvent('serviceworker', { timeout: 15000 });
    const extId = new URL(sw.url()).host;
    // The PRODUCTION build must ignore pages on localhost completely (no bridge script is even injected).
    const html = readFileSync(join(extPath, 'e2e/fixtures/shipper-fixture.html'));
    const server = http.createServer((q, r) => { r.writeHead(200, { 'content-type': 'text/html' }); r.end(html); });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const local = await ctx.newPage();
    await local.goto(`http://localhost:${server.address().port}/`);
    const answer = await local.evaluate(() => Promise.race([window.tcgssSend('hello').then(() => 'answered'), new Promise((r) => setTimeout(() => r('silent'), 1500))]));
    assert.equal(answer, 'silent', 'the production build must not answer a localhost page');
    await local.close();
    server.close();
    const setup = await ctx.newPage();
    await setup.goto(`chrome-extension://${extId}/src/ui/options.html`);
    await setup.evaluate(() => chrome.storage.local.set({ tcgss_flags_v1: { agentPanel: true } }));
    await setup.close();

    const panel = await ctx.newPage();
    const cdp = await ctx.newCDPSession(panel);
    const versions = new Map();
    cdp.on('ServiceWorker.workerVersionUpdated', (e) => { for (const v of e.versions) versions.set(v.versionId, v); });
    await cdp.send('ServiceWorker.enable');
    await panel.goto(`chrome-extension://${extId}/src/ui/sidepanel.html`);
    await panel.waitForSelector('#memlist li');
    await panel.click('#tourSkip');
    const waitBadge = async (page, expected, timeout = 15000) => {
      const end = Date.now() + timeout;
      let seen;
      while (Date.now() < end) {
        seen = await page.evaluate(() => chrome.action.getBadgeText({}));
        if (seen === expected) return;
        await page.waitForTimeout(150);
      }
      assert.fail(`toolbar badge should be "${expected}" but is "${seen}"`);
    };
    const fire = (page) => page.evaluate(() => chrome.alarms.create('tcgss-tick', { when: Date.now() + 300, periodInMinutes: 1 }));
    const stopWorker = async () => {
      for (const v of [...versions.values()].filter((v) => v.runningStatus === 'running' && v.scriptURL.includes(extId))) await cdp.send('ServiceWorker.stopWorker', { versionId: v.versionId });
      await panel.waitForTimeout(500);
    };

    // 1. a background job, and a goal that stops at an approval card
    await panel.click('#addMinute');
    await panel.waitForSelector('#joblist li');
    await panel.fill('#goal', 'Reprice my cards 5% under market');
    await panel.press('#goal', 'Enter');
    await panel.waitForSelector('.card button[data-answer=approve]');
    await waitBadge(panel, '1');

    // 2. kill the service worker for real (a marker in its memory proves the new one is a fresh instance)
    await sw.evaluate(() => { globalThis.__marker = 42; });
    await stopWorker();

    // 3. a brand-new panel still shows the card, the plan, memory, suggestions and the job
    const fresh = await ctx.newPage();
    await fresh.goto(`chrome-extension://${extId}/src/ui/sidepanel.html`);
    await fresh.waitForSelector('#memlist li');
    await fresh.waitForSelector('.card button[data-answer=approve]');
    assert.equal(await fresh.locator('#memlist li').count(), 2, 'memory survived the restart');
    assert.match(await fresh.textContent('#planlist'), /Save the new prices/, 'plan survived');
    assert.ok((await fresh.locator('#suglist li').count()) >= 2, 'suggestions are back');
    assert.equal(await fresh.locator('#joblist li').count(), 1, 'the saved job survived');
    const alive = ctx.serviceWorkers().filter((w) => w.url().includes(extId));
    const markers = await Promise.all(alive.map((w) => w.evaluate(() => globalThis.__marker).catch(() => 'dead')));
    assert.ok(markers.length >= 1 && markers.every((m) => m !== 42), 'the worker that answers is a fresh one: ' + JSON.stringify(markers));

    // 4. the alarm wakes the worker and the saved job fires: a report, and a SECOND card waiting (nothing acted)
    await stopWorker();
    await fire(fresh);
    await waitBadge(fresh, '2', 15000);
    const jobs = await fresh.evaluate(async () => (await chrome.runtime.sendMessage({ source: 'tcgss-panel', v: 1, id: 'j1', type: 'ext.jobs.list' })).result);
    assert.equal(jobs.reports.length, 1, 'the job left a report: ' + JSON.stringify(jobs).slice(0, 400));
    assert.ok(jobs.jobs[0].lastRunAt, 'and was marked as run');
    await panel.waitForFunction(() => document.querySelectorAll('.card button[data-answer=approve]').length === 2, null, { timeout: 15000 });
    await fresh.close();

    // 5. approving in the ORIGINAL panel (talking to the woken worker) finishes the plan; the badge counts down
    await panel.locator('.card button[data-answer=approve]').first().click();
    await panel.waitForSelector('text=You approved this.', { timeout: 10000 });
    await waitBadge(panel, '1');

    // 6. restart again: the badge comes back by itself when the worker wakes, and approving the job's card works
    await stopWorker();
    await fire(panel);
    await waitBadge(panel, '1', 15000);
    const probe = await panel.evaluate(async () => {
      const send = (type, payload) => chrome.runtime.sendMessage({ source: 'tcgss-panel', v: 1, id: 'probe-' + type, type, ...(payload ? { payload } : {}) });
      return { audit: (await send('agent.audit')).result.entries.map((e) => `${e.tool}:${e.outcome}`), cards: (await send('agent.inbox.list')).result.cards };
    });
    assert.ok(probe.audit.includes('inventory.setPrices:ok'), 'the approved change is in the audit trail: ' + probe.audit.join(','));
    assert.equal(probe.cards.length, 1, 'one card (the job\'s) is still waiting');
    const res = await panel.evaluate((id) => chrome.runtime.sendMessage({ source: 'tcgss-panel', v: 1, id: 'ap1', type: 'agent.approve', payload: { approvalId: id, approved: true } }), probe.cards[0].approvalId);
    assert.equal(res.ok, true);
    await waitBadge(panel, '', 10000);
    const stored = await panel.evaluate(() => chrome.storage.local.get('tcgss_agent_state_v2'));
    assert.equal(stored.tcgss_agent_state_v2.prices['mtg:practice:p2|NM|nonfoil'], 70, 'the job\'s approved change was saved');

    // 6. Clear everything empties the audit database and the saved state too.
    const cleared = await panel.evaluate(async () => {
      const res = await chrome.runtime.sendMessage({ source: 'tcgss-admin', type: 'clear-everything' });
      const count = await new Promise((resolve, reject) => {
        const open = indexedDB.open('tcgss-ext-audit');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => { const q = open.result.transaction('audit').objectStore('audit').count(); q.onsuccess = () => resolve(q.result); };
      });
      return { ok: res.ok, count, storage: await chrome.storage.local.get(null), badge: await chrome.action.getBadgeText({}) };
    });
    assert.deepEqual([cleared.ok, cleared.count, cleared.storage, cleared.badge], [true, 0, {}, '']);
    console.log('restart scenario ok');
  } finally {
    await ctx.close();
    rmSync(profile, { recursive: true, force: true });
  }
}
main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
