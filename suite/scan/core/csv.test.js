import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildCsv, escapeCell, safeText, FORMAT, FORMATS, RULES, getFormat, DEFAULT_FORMAT_KEY, conditionLabel } from './csv.js';

const P = {
  a: { id: 'a', name: 'Known', setCode: 'TST', number: '1', tcgplayerProductId: 111 },
  b: { id: 'b', name: 'No Id', setCode: 'TST', number: '2' },
  c: { id: 'c', name: '=cmd|calc', setCode: 'TST', number: '3', tcgplayerProductId: 333 },
};
const get = (id) => P[id];
const draft = (printingId, o = {}) => ({ id: 'd-' + printingId, printingId, condition: 'NM', finish: 'nonfoil', language: 'en', quantity: 2, priceCents: 199, ...o });

const golden = (name) => readFileSync(new URL('./fixtures/' + name, import.meta.url), 'utf8');
const TWO = [draft('a'), draft('a', { id: 'd2', condition: 'LP', finish: 'foil', quantity: 1, priceCents: 5 })];
const getTwo = (id) => ({ a: { id: 'a', name: 'Known', setCode: 'TST', number: '1', tcgplayerProductId: 111 } })[id];
// the second row is a different card on purpose
const TWO_CARDS = [draft('a'), draft('b2', { id: 'd2', condition: 'LP', finish: 'foil', quantity: 1, priceCents: 5 })];
const getCards = (id) => ({ a: { id: 'a', name: 'A', setCode: 'T', number: '1', tcgplayerProductId: 111 }, b2: { id: 'b2', name: 'B', setCode: 'T', number: '2', tcgplayerProductId: 222 } })[id];

test('the default is the SAFE choice: add to stock, no Total Quantity column at all', () => {
  assert.equal(DEFAULT_FORMAT_KEY, 'tcgplayer-add');
  assert.equal(FORMAT, FORMATS['tcgplayer-add']);
  const headers = FORMAT.columns.map((c) => c.header);
  assert.ok(headers.includes('Add to Quantity'));
  assert.ok(!headers.includes('Total Quantity'));
  assert.ok(headers.includes('TCG Marketplace Price'));
  assert.equal(buildCsv(TWO_CARDS, getCards).formatKey, 'tcgplayer-add');
});

test('each format writes exactly its columns (golden files)', () => {
  assert.equal(buildCsv(TWO_CARDS, getCards, { format: 'tcgplayer-add' }).csv, golden('csv-tcgplayer-add.csv'));
  assert.equal(buildCsv(TWO_CARDS, getCards, { format: 'tcgplayer-set' }).csv, golden('csv-tcgplayer-set.csv'));
  assert.equal(buildCsv(TWO_CARDS, getCards, { format: 'manapool' }).csv, golden('csv-manapool.csv'));
});

test('"set my stock" and only that one warns about lowering counts; only Mana Pool spells the id column its own way', () => {
  assert.match(FORMATS['tcgplayer-set'].warning, /SETS your stock.*20.*1/);
  assert.equal(FORMATS['tcgplayer-add'].warning, '');
  assert.equal(FORMATS.manapool.columns[0].header, 'TCGPlayer Id');
  assert.equal(FORMATS['tcgplayer-add'].columns[0].header, 'TCGplayer Id');
  assert.ok(!FORMATS.manapool.columns.some((c) => c.header === 'Add to Quantity')); // Mana Pool ignores it
});

test('nothing is claimed as verified that was not read from a source; the first-import advice is there', () => {
  for (const f of Object.values(FORMATS)) assert.equal(f.verified, false, f.key); // no real export has been checked
  assert.ok(RULES.verifiedFromSource.length >= 4 && RULES.unverified.length >= 4);
  assert.match(RULES.firstImportAdvice, /3 cards.*Staged inventory/);
  assert.match(RULES.unverified.join(' '), /Add to Quantity.*NO "Total Quantity"/);
  assert.equal(getFormat('nope'), FORMAT); // an unknown key falls back to the safe default
  assert.equal(getFormat(FORMATS.manapool), FORMATS.manapool);
});

test('writes header and rows with CRLF, dollars with two decimals; counts go in the right column', () => {
  const out = buildCsv([draft('a'), draft('a', { condition: 'LP', finish: 'foil', quantity: 1, priceCents: 5 })], get);
  const lines = out.csv.split('\r\n');
  assert.equal(lines[0], 'TCGplayer Id,Condition,Add to Quantity,TCG Marketplace Price');
  assert.equal(lines[1], '111,Near Mint,2,1.99');
  assert.equal(lines[2], '111,Lightly Played Foil,1,0.05');
  assert.equal(out.listed, 2); assert.equal(out.cards, 3);
  assert.equal(out.formatVerified, false);
  assert.match(buildCsv([draft('a')], get, { format: 'tcgplayer-set' }).csv, /\r\n111,Near Mint,2,1\.99\r\n/);
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

import { checkHeader, splitHeader } from './csv-format.js';

test('header check: same, different spelling, missing, extra', () => {
  assert.equal(checkHeader('TCGplayer Id,Condition,Add to Quantity,TCG Marketplace Price').ok, true);
  const sp = checkHeader('TCGPlayer Id,Condition,Add to Quantity,TCG Marketplace Price');
  assert.equal(sp.ok, false); assert.deepEqual(sp.spelling, [{ ours: 'TCGplayer Id', theirs: 'TCGPlayer Id' }]);
  assert.equal(checkHeader('TCGPlayer Id,Condition,Total Quantity,TCG Marketplace Price', FORMATS.manapool).ok, true);
  assert.deepEqual(checkHeader('TCGplayer Id,Condition,Total Quantity,TCG Marketplace Price').missing, ['Add to Quantity']);
  const real = checkHeader('"TCGplayer Id","Product Line","Set Name","Product Name","Number","Condition","Total Quantity","Add to Quantity","TCG Marketplace Price"');
  assert.deepEqual(real.unused, ['Product Line', 'Set Name', 'Product Name', 'Number', 'Total Quantity']);
  assert.equal(real.ok, true);
  assert.match(checkHeader('Id,Qty').notes.join(' '), /no column with that name/);
  assert.equal(checkHeader('').ok, false);
  assert.deepEqual(splitHeader('a,"b,c","d ""x"""'), ['a', 'b,c', 'd "x"']);
  assert.equal(checkHeader('\uFEFFTCGplayer Id,Condition,Add to Quantity,TCG Marketplace Price\r\n1,2').ok, true);
});
