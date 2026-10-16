// Forced service-worker restart in real Chromium: the Agent's state must survive. Exit 0 = pass.
import assert from 'node:assert/strict';
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

    await panel.fill('#goal', 'how many orders do I have?');
    await panel.click('#go');
    await panel.waitForSelector('text=Practice answer');
    // 1. a memory, and a goal that stops at an approval card
    await panel.fill('#goal', 'remember that I pack orders on Mondays');
    await panel.click('#go');
    await panel.waitForFunction(() => document.querySelectorAll('#memlist li').length === 3);
    await panel.fill('#goal', 'please lower the price');
    await panel.click('#go');
    await panel.waitForSelector('.card button[data-answer=approve]');

    // 2. kill the service worker for real (a marker in its memory proves the new one is a fresh instance)
    await sw.evaluate(() => { globalThis.__marker = 42; });
    const running = [...versions.values()].filter((v) => v.runningStatus === 'running' && v.scriptURL.includes(extId));
    assert.ok(running.length >= 1, 'found the running worker');
    for (const v of running) await cdp.send('ServiceWorker.stopWorker', { versionId: v.versionId });
    await panel.waitForTimeout(500);

    // 3. the card is still on screen (the panel page lives on); a NEW panel opened now also shows it, memory and plan intact
    const fresh = await ctx.newPage();
    await fresh.goto(`chrome-extension://${extId}/src/ui/sidepanel.html`);
    await fresh.waitForSelector('#memlist li');
    assert.equal(await fresh.locator('#memlist li').count(), 3, 'memory survived the restart');
    await fresh.waitForSelector('.card button[data-answer=approve]');
    assert.match(await fresh.textContent('#planlist'), /Ask you before changing anything/, 'plan survived');
    const alive = ctx.serviceWorkers().filter((w) => w.url().includes(extId));
    const markers = await Promise.all(alive.map((w) => w.evaluate(() => globalThis.__marker).catch(() => 'dead')));
    assert.ok(markers.length >= 1 && markers.every((m) => m !== 42), 'the worker that answers is a fresh one: ' + JSON.stringify(markers));
    await fresh.close();

    // 4. approving in the ORIGINAL panel (talking to the newly woken worker) finishes the job
    await panel.click('.card button[data-answer=approve]');
    await panel.waitForSelector('text=Done, in practice data only', { timeout: 10000 });

    // 5. restart again: the price change and the audit trail are still there
    for (const v of [...versions.values()].filter((v) => v.runningStatus === 'running' && v.scriptURL.includes(extId))) await cdp.send('ServiceWorker.stopWorker', { versionId: v.versionId });
    await panel.waitForTimeout(500);
    await panel.reload();
    await panel.waitForSelector('#memlist li');
    const probe = await panel.evaluate(async () => {
      const send = (type, payload) => chrome.runtime.sendMessage({ source: 'tcgss-panel', v: 1, id: 'probe-' + type, type, ...(payload ? { payload } : {}) });
      return { audit: (await send('agent.audit')).result.entries.map((e) => `${e.tool}:${e.outcome}`) };
    });
    assert.ok(probe.audit.includes('listing.setPrice:ok'), 'audit trail survived: ' + probe.audit.join(','));
    assert.ok(probe.audit.includes('orders.stats:ok'), 'earlier read call is still in the trail');
    const stored = await panel.evaluate(() => chrome.storage.local.get('tcgss_agent_state_v1'));
    assert.equal(stored.tcgss_agent_state_v1.prices['mtg:practice:p2'], 70, 'the practice price change was saved');
    // 6. Clear everything empties the audit database and the saved state too.
    const cleared = await panel.evaluate(async () => {
      const res = await chrome.runtime.sendMessage({ source: 'tcgss-admin', type: 'clear-everything' });
      const count = await new Promise((resolve, reject) => {
        const open = indexedDB.open('tcgss-ext-audit');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => { const q = open.result.transaction('audit').objectStore('audit').count(); q.onsuccess = () => resolve(q.result); };
      });
      return { ok: res.ok, count, storage: await chrome.storage.local.get(null) };
    });
    assert.deepEqual([cleared.ok, cleared.count, cleared.storage], [true, 0, {}]);
    console.log('restart scenario ok');
  } finally {
    await ctx.close();
    rmSync(profile, { recursive: true, force: true });
  }
}
main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
