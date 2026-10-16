// DEV script: proves the "New version ready, tap to refresh" flow in headless Chromium. It copies the app to a scratch
// folder, serves it, publishes a second service-worker version and checks the bar appears and a tap switches over.
// Usage: NODE_PATH=<playwright> node scan/dev/sw-update-check.cjs   (from suite/; needs the scan folder next to ../shared)
const { chromium } = require('playwright'); const fs = require('fs'); const os = require('os'); const path = require('path');
const { execFileSync, spawn } = require('child_process');
(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'scan-sw-'));
  const suite = path.join(__dirname, '..', '..');
  fs.cpSync(path.join(suite, 'scan'), path.join(tmp, 'scan'), { recursive: true, filter: (s) => !/vendor/.test(s) });
  fs.cpSync(path.join(suite, 'shared'), path.join(tmp, 'shared'), { recursive: true });
  const SW = path.join(tmp, 'scan', 'public', 'sw.js');
  fs.writeFileSync(SW, fs.readFileSync(SW, 'utf8').replace(/const CACHE = '[^']+'/, "const CACHE = 'check-1'"));
  const server = spawn(process.execPath, [path.join(tmp, 'scan', 'serve.js'), '8135'], { stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 800));
  let ok = false;
  try {
    const b = await chromium.launch(); const p = await (await b.newContext()).newPage();
    await p.goto('http://localhost:8135/scan/public/'); await p.waitForSelector('#q');
    await p.waitForFunction(() => navigator.serviceWorker.controller || false, null, { timeout: 15000 }).catch(() => {});
    await p.reload(); await p.waitForSelector('#q');
    const hiddenAtFirst = await p.locator('#updateBar').isHidden();
    fs.writeFileSync(SW, fs.readFileSync(SW, 'utf8').replace("'check-1'", "'check-2'"));
    await p.evaluate(async () => { const r = await navigator.serviceWorker.getRegistration(); await r.update(); });
    await p.waitForSelector('#updateBar:not([hidden])', { timeout: 15000 });
    await Promise.all([p.waitForNavigation({ timeout: 15000 }).catch(() => {}), p.click('#updateBtn')]);
    await p.waitForSelector('#q'); await p.waitForTimeout(500);
    const caches = await p.evaluate(async () => (await caches.keys()).join(','));
    ok = hiddenAtFirst && caches === 'check-2';
    console.log(ok ? 'PASS: bar hidden at first, appeared for the new version, tap switched to it (caches: ' + caches + ')' : 'FAIL: hiddenAtFirst=' + hiddenAtFirst + ' caches=' + caches);
    await b.close();
  } finally { server.kill(); fs.rmSync(tmp, { recursive: true, force: true }); }
  process.exit(ok ? 0 : 1);
})();
