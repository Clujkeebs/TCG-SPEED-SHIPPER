import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv, readOurCsv, conditionFromLabel } from './csv-import.js';
import { buildCsv } from './csv.js';

test('csv reader: quotes, commas and breaks inside quotes, CRLF/LF/BOM, blank lines', () => {
  assert.deepEqual(parseCsv('﻿a,"b,c","d ""x"""\r\n\r\n1,2,3\n'), [['a', 'b,c', 'd "x"'], ['1', '2', '3']]);
  assert.deepEqual(parseCsv('a,"line\nbreak"\nz,y'), [['a', 'line\nbreak'], ['z', 'y']]);
  assert.deepEqual(parseCsv(''), []);
});

test('condition labels both ways', () => {
  assert.deepEqual(conditionFromLabel('Near Mint'), { condition: 'NM', foil: false });
  assert.deepEqual(conditionFromLabel('Lightly Played Foil'), { condition: 'LP', foil: true });
  assert.deepEqual(conditionFromLabel("'Damaged"), { condition: 'DMG', foil: false });
  assert.equal(conditionFromLabel('Mint'), null);
});

test('what we write, we can read back', () => {
  const P = { a: { id: 'a', name: 'A', setCode: 'T', number: '1', tcgplayerProductId: 111 }, b: { id: 'b', name: 'B', setCode: 'T', number: '2', tcgplayerProductId: 222 } };
  const drafts = [
    { id: '1', printingId: 'a', condition: 'NM', finish: 'nonfoil', language: 'en', quantity: 2, priceCents: 199 },
    { id: '2', printingId: 'b', condition: 'LP', finish: 'foil', language: 'en', quantity: 1, priceCents: 5 },
  ];
  const csv = buildCsv(drafts, (id) => P[id]).csv;
  const r = readOurCsv(csv);
  assert.deepEqual(r.problems, []);
  assert.deepEqual(r.rows, [
    { productId: 111, condition: 'NM', foil: false, quantity: 2, priceCents: 199 },
    { productId: 222, condition: 'LP', foil: true, quantity: 1, priceCents: 5 },
  ]);
});

test('columns are found by name, in any order', () => {
  const r = readOurCsv('Total Quantity,TCG Marketplace Price,TCGPlayer Id\n3,1.50,42\n');
  assert.deepEqual(r.rows, [{ productId: 42, condition: 'NM', foil: false, quantity: 3, priceCents: 150 }]);
});

test('bad rows are skipped with a plain sentence that names the line; a foreign file is refused', () => {
  const r = readOurCsv('TCGPlayer Id,Condition,Total Quantity,TCG Marketplace Price\n,Near Mint,1,1.00\n5,Near Mint,0,1.00\n6,Near Mint,1,abc\n7,Mint,1,1.00\n8,Near Mint,1,2.50\n');
  assert.equal(r.rows.length, 1); assert.equal(r.rows[0].productId, 8);
  assert.equal(r.problems.length, 4);
  assert.match(r.problems[0], /^Line 2: no TCGplayer product id/);
  assert.match(r.problems[3], /^Line 5: condition "Mint"/);
  assert.match(readOurCsv('Name,Qty\nx,1\n').problems[0], /does not look like a file from Speed Scan.*Missing column/);
  assert.match(readOurCsv('').problems[0], /empty/);
});
