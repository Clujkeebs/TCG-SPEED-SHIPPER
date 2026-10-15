// Serves src/ and test/fixtures/ on localhost and drives the adapters in Chromium. Exit 0 = pass.
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { join, extname } from 'node:path';

const root = join(fileURLToPath(import.meta.url), '..', '..');
const chromePath = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const pwPath = process.env.PLAYWRIGHT_PATH || '/opt/node22/lib/node_modules/playwright';
const types = { '.html': 'text/html', '.js': 'text/javascript' };

async function main() {
  const { chromium } = createRequire(import.meta.url)(pwPath);
  const server = http.createServer((req, res) => {
    const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const file = p.startsWith('/src/') ? join(root, p) : join(root, 'test/fixtures', p);
    if (!file.startsWith(root) || p.includes('..') || !existsSync(file)) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'content-type': types[extname(file)] || 'text/plain' });
    res.end(readFileSync(file));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://localhost:${server.address().port}`;
  const browser = await chromium.launch({ executablePath: chromePath, args: ['--no-sandbox', '--no-proxy-server', '--disable-background-networking', '--disable-breakpad'] });
  try {
    const page = await browser.newPage();
    const load = (name) => page.goto(`${base}/${name}`);
    const mod = `import('${base}/src/adapters/index.js')`;

    // --- orders page ---
    await load('orders.html');
    const r1 = await page.evaluate(async (m) => {
      const { createAdapter } = await eval(m);
      const a = createAdapter(document);
      const read = a.readOrders();
      return { page: a.detectPage(), self: a.selfTest(), read, imp: a.openImport(), dry: a.dryRun, urlAfter: location.pathname };
    }, mod);
    assert.equal(r1.page, 'orders');
    assert.equal(r1.dry, true);
    assert.equal(r1.read.orders.length, 2, 'two good rows');
    assert.equal(r1.read.problems.length, 1, 'bad row reported, not silently dropped');
    assert.equal(r1.read.problems[0].id, 'SYN-BAD');
    const o = r1.read.orders[0];
    assert.deepEqual([o.id, o.itemsTotalCents, o.shippingPaidCents, o.items[0].priceCents, o.items[0].quantity], ['SYN-1001', 725, 99, 150, 2]);
    assert.equal(o.shipTo.address2, 'Apt 2');
    assert.equal(r1.read.orders[1].shipTo.address2, undefined);
    assert.match(o.buyerKey, /^b-/);
    assert.equal(r1.imp.href, '/import.html');
    assert.equal(r1.urlAfter, '/orders.html', 'dry run does not navigate');
    // the self-test lists selectors that match nothing on this page (fixture has no mark-shipped parts)
    assert.deepEqual(r1.self.missing, [], 'orders page selectors all match: ' + JSON.stringify(r1.self.missing));

    // --- mark-shipped: dry run leaves the page alone, real fill fills but never submits ---
    await load('ship.html');
    const r2 = await page.evaluate(async (m) => {
      const { createAdapter } = await eval(m);
      const map = { 'SYN-1001': { trackingNumber: '9400 1000 0000 0000 0000 00', carrier: 'USPS' }, 'SYN-NOPE': { trackingNumber: '1' }, 'SYN-1002': { trackingNumber: '  ' } };
      const dry = createAdapter(document);
      const dryRes = dry.fillTracking(map);
      const afterDry = [...document.querySelectorAll('input.tracking')].map((i) => i.value);
      const live = createAdapter(document, { dryRun: false });
      const liveRes = live.fillTracking(map);
      return { dryRes, afterDry, liveRes, values: [...document.querySelectorAll('input.tracking')].map((i) => i.value), carrier: document.querySelector('select.carrier').value, title: document.title, dryActions: dry.actions, page: dry.detectPage() };
    }, mod);
    assert.equal(r2.page, 'markShipped');
    assert.deepEqual(r2.afterDry, ['', ''], 'dry run changes nothing');
    assert.deepEqual(r2.dryRes.done, ['SYN-1001']);
    assert.deepEqual(r2.dryRes.notFound.sort(), ['SYN-1002', 'SYN-NOPE']);
    assert.deepEqual(r2.values, ['9400 1000 0000 0000 0000 00', '']);
    assert.equal(r2.carrier, 'USPS');
    assert.ok(!r2.title.includes('SUBMITTED'), 'the adapter never submits the form');
    assert.ok(r2.dryActions.every((a) => a.type === 'fill'));
    assert.ok(!JSON.stringify(r2.dryActions).includes('9400'), 'the log does not contain the tracking number itself');

    // --- self-test notices a changed page ---
    await load('ship-changed.html');
    const r3 = await page.evaluate(async (m) => {
      const { createAdapter } = await eval(m);
      return createAdapter(document).selfTest();
    }, mod);
    assert.equal(r3.ok, false);
    assert.deepEqual(r3.missing.map((x) => x.key).sort(), ['submit', 'tracking']);

    // --- import page: attach, never upload ---
    await load('import.html');
    const r4 = await page.evaluate(async (m) => {
      const { createAdapter } = await eval(m);
      const csv = new File(['a,b\n1,2\n'], 'listings.csv', { type: 'text/csv' });
      const dry = createAdapter(document);
      const dryRes = dry.attachFile(csv);
      const filesAfterDry = document.querySelector('#csv-file').files.length;
      const bad = createAdapter(document, { dryRun: false }).attachFile(new File(['x'], 'evil.exe'));
      const live = createAdapter(document, { dryRun: false });
      const liveRes = live.attachFile(csv);
      return { dryRes, filesAfterDry, bad, liveRes, files: document.querySelector('#csv-file').files.length, name: document.querySelector('#csv-file').files[0]?.name, title: document.title, page: live.detectPage() };
    }, mod);
    assert.equal(r4.page, 'import');
    assert.equal(r4.filesAfterDry, 0);
    assert.equal(r4.bad.attached, false);
    assert.deepEqual([r4.liveRes.attached, r4.files, r4.name], [true, 1, 'listings.csv']);
    assert.ok(!r4.title.includes('UPLOADED'), 'the adapter never clicks Upload');

    // --- the guard: off by default, so no adapter at all ---
    const r5 = await page.evaluate(async (m) => {
      const { guardedAdapter } = await eval(m);
      return { off: await guardedAdapter('pasteTracking', document), flagOnTosClosed: null };
    }, mod);
    assert.equal(r5.off, null);
    // --- Scan uploader module on the import page (flag on + gate opened for the test only) ---
    await load('import.html');
    const r6 = await page.evaluate(async (b) => {
      const { attachCsv } = await import(b + '/src/modules/scan-uploader.js');
      const flags = await import(b + '/src/flags.js');
      const area = flags.memoryArea();
      const csv = { name: 'listings.csv', text: 'TCGplayer Id,Quantity,Price\n1,2,0.99\n' };
      const off = await attachCsv(document, csv, { flagOptions: { area, tosOk: true } });
      await flags.setFlag('uploadToTcgplayer', true, area);
      const dry = await attachCsv(document, csv, { flagOptions: { area, tosOk: true } });
      const filesAfterDry = document.querySelector('#csv-file').files.length;
      const closed = await attachCsv(document, csv, { dryRun: false, flagOptions: { area } });
      const live = await attachCsv(document, csv, { dryRun: false, flagOptions: { area, tosOk: true } });
      return { off, dry, filesAfterDry, closed, live, files: document.querySelector('#csv-file').files.length, title: document.title };
    }, base);
    assert.match(r6.off.message, /switched off/);
    assert.equal(r6.dry.ok, true);
    assert.match(r6.dry.message, /Practice run/);
    assert.equal(r6.filesAfterDry, 0);
    assert.match(r6.closed.message, /switched off/, 'TOS gate closed => nothing, even with the flag on');
    assert.equal(r6.live.ok, true);
    assert.equal(r6.files, 1);
    assert.ok(!r6.title.includes('UPLOADED'), 'never presses Upload');
    console.log('adapter scenario ok');
  } finally {
    await browser.close();
    server.close();
  }
}
main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
