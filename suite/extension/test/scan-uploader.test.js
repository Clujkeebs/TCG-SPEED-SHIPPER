import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prepareUpload, attachCsv } from '../src/modules/scan-uploader.js';

const csv = 'TCGplayer Id,Quantity,Price\n1,2,0.99\n';

test('prepareUpload accepts a plain csv and counts cards', () => {
  const r = prepareUpload({ name: 'listings 2026-10-15.csv', text: csv });
  assert.equal(r.ok, true);
  assert.equal(r.rows, 1);
});

test('prepareUpload refuses bad names, empty, header-only and huge files', () => {
  for (const name of ['evil.exe', '../x.csv', 'a/b.csv', '', 'x.csv.exe', undefined, 5]) assert.equal(prepareUpload({ name, text: csv }).ok, false, String(name));
  assert.equal(prepareUpload({ name: 'a.csv', text: '' }).ok, false);
  assert.equal(prepareUpload({ name: 'a.csv', text: 'a,b\n' }).ok, false);
  assert.equal(prepareUpload({ name: 'a.csv', text: 'a,b\n' + 'x'.repeat(6 * 1024 * 1024) }).ok, false);
  assert.equal(prepareUpload().ok, false);
});

test('attachCsv does nothing while the helper is off', async () => {
  const r = await attachCsv({ querySelector: () => null }, { name: 'a.csv', text: csv });
  assert.equal(r.ok, false);
  assert.match(r.message, /switched off/);
});

import { buildCsv } from '../src/vendor/scan/core/csv.js';

const draft = (id, over = {}) => ({ id, printingId: 'mtg:practice:p1', condition: 'NM', finish: 'nonfoil', language: 'en', quantity: 2, priceCents: 99, source: 'scan', createdAt: '2026-10-15T12:00:00Z', ...over });
const printing = { id: 'mtg:practice:p1', name: 'Ember Drake', setCode: 'PRC', number: '1', tcgplayerProductId: 12345 };

test("Scan's own CSV output is accepted, counted, and recognised as Scan format", () => {
  const out = buildCsv([draft('a'), draft('b', { condition: 'LP', quantity: 1 })], () => printing);
  const r = prepareUpload({ name: 'speed-scan-2026-10-15.csv', text: out.csv });
  assert.equal(r.ok, true);
  assert.equal(r.rows, 2);
  assert.equal(r.matchesScan, true);
  assert.equal(r.formatVerified, false, 'the TCGplayer format is still unverified upstream');
});

test('a CSV that is not from Scan is allowed but flagged', () => {
  const r = prepareUpload({ name: 'other.csv', text: 'Sku,Qty\nA,1\n' });
  assert.equal(r.ok, true);
  assert.equal(r.matchesScan, false);
});

test('rows Scan could not place (no product id) never reach the file, so the uploader sees only whole rows', () => {
  const out = buildCsv([draft('a', {}), draft('b')], (id) => ({ ...printing, tcgplayerProductId: undefined }));
  assert.equal(out.listed, 0);
  assert.equal(prepareUpload({ name: 'none.csv', text: out.csv }).ok, false, 'header only => refused');
});
