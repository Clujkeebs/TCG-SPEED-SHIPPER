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
