import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCsv, escapeCell, safeText, FORMAT, conditionLabel } from './csv.js';

const P = {
  a: { id: 'a', name: 'Known', setCode: 'TST', number: '1', tcgplayerProductId: 111 },
  b: { id: 'b', name: 'No Id', setCode: 'TST', number: '2' },
  c: { id: 'c', name: '=cmd|calc', setCode: 'TST', number: '3', tcgplayerProductId: 333 },
};
const get = (id) => P[id];
const draft = (printingId, o = {}) => ({ id: 'd-' + printingId, printingId, condition: 'NM', finish: 'nonfoil', language: 'en', quantity: 2, priceCents: 199, ...o });

test('format is flagged unverified and the price column exists', () => {
  assert.equal(FORMAT.verified, false);
  assert.ok(FORMAT.columns.some((c) => c.header === 'TCG Marketplace Price'));
  assert.ok(FORMAT.columns.some((c) => c.header === 'TCGPlayer Id'));
  assert.ok(FORMAT.columns.some((c) => c.header === 'Total Quantity'));
});

test('writes header and rows with CRLF, dollars with two decimals', () => {
  const out = buildCsv([draft('a'), draft('a', { condition: 'LP', finish: 'foil', quantity: 1, priceCents: 5 })], get);
  const lines = out.csv.split('\r\n');
  assert.equal(lines[0], 'TCGPlayer Id,Condition,Total Quantity,TCG Marketplace Price');
  assert.equal(lines[1], '111,Near Mint,2,1.99');
  assert.equal(lines[2], '111,Lightly Played Foil,1,0.05');
  assert.equal(out.listed, 2);
  assert.equal(out.cards, 3);
  assert.equal(out.formatVerified, false);
});

test('rows without a product id are listed separately, never guessed', () => {
  const out = buildCsv([draft('a'), draft('b')], get);
  assert.equal(out.listed, 1);
  assert.equal(out.missingId.length, 1);
  assert.match(out.missingId[0].label, /No Id/);
  assert.ok(!out.csv.includes('No Id'));
});

test('a product id typed by the seller is used', () => {
  const out = buildCsv([draft('b', { tcgplayerProductId: 222 })], get);
  assert.equal(out.missingId.length, 0);
  assert.match(out.csv, /\r\n222,/);
});

test('rows without a price are held back', () => {
  const out = buildCsv([draft('a', { priceCents: 0 })], get);
  assert.equal(out.listed, 0);
  assert.equal(out.missingPrice.length, 1);
});

test('unknown printing goes to missingId', () => {
  assert.equal(buildCsv([draft('zzz')], get).missingId.length, 1);
});

test('formula injection is neutralised and quoting works', () => {
  for (const bad of ['=1+1', '+1', '-1', '@SUM(A1)', '\tx', '\rx']) assert.ok(safeText(bad).startsWith("'"), bad);
  assert.equal(safeText('Plain'), 'Plain');
  assert.equal(escapeCell('a,b'), '"a,b"');
  assert.equal(escapeCell('say "hi"'), '"say ""hi"""');
  assert.equal(escapeCell('=HYPERLINK("x")'), '"\'=HYPERLINK(""x"")"');
  const evil = { ...FORMAT, columns: [{ header: 'Name', value: (r) => r.name }] };
  const out = buildCsv([draft('c')], (id) => P[id], { format: { ...evil, columns: [{ header: 'Name', value: () => P.c.name }] } });
  assert.match(out.csv, /\r\n'=cmd\|calc\r\n/);
});

test('condition labels', () => {
  assert.equal(conditionLabel('NM', 'nonfoil'), 'Near Mint');
  assert.equal(conditionLabel('DMG', 'etched'), 'Damaged Foil');
});
