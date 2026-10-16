import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { analyze, failureReasons, report } from './from-results.js';
import { parseResultsText } from '../core/scanlog.js';

const text = readFileSync(new URL('./fixtures/results-sample.txt', import.meta.url), 'utf8');
const rows = parseResultsText(text).rows;

test('the fixture parses (the junk line is skipped by the reader, not a row)', () => {
  assert.equal(rows.length, 10);
});

test('accuracy numbers from the fixture', () => {
  const a = analyze(rows);
  assert.equal(a.n, 10);
  assert.equal(a.rightFirst, 5); // auto x3 + tap x2
  assert.equal(a.rightFirstPct, 50);
  assert.equal(a.autoPct, 30); assert.equal(a.tapPct, 20); assert.equal(a.fixedPct, 40); assert.equal(a.notFoundPct, 10);
  assert.equal(a.byGame.mtg.n, 4);
  assert.equal(a.byGame.pokemon.rightFirstPct, 50);
});

test('failure reasons are worked out from what the reader saw', () => {
  const by = (c) => rows.find((r) => r.c === c && r.h === 'fixed');
  assert.deepEqual(failureReasons(by('Pikachu|JU|60')), ['number-misread']); // 058 read fine, but the seller wanted number 60 (another set)
  assert.deepEqual(failureReasons(by('Dark Magician|LOB|EN005')), ['set-code-misread']); // L0B read for LOB; the number repairs to EN005
  assert.deepEqual(failureReasons(by('Birds of Paradise|M12|165')), ['number-misread', 'set-code-misread']); // only M12 was read; the name was close enough
  assert.ok(failureReasons(by('Mirror Force|MRD|EN138')).includes('number-misread'));
  assert.deepEqual(failureReasons({ g: 'x', t: '', n: '', c: '' }), ['reader-saw-nothing']);
  assert.deepEqual(failureReasons({ g: 'mtg', t: '??', n: '..', c: 'X|Y|1' }), ['no-usable-text']);
  assert.deepEqual(failureReasons({ g: 'mtg', t: 'Sol Ring', n: '259/361 CMD EN', c: '' }), ['never-resolved']);
});

test('a garbled title is a title misread', () => {
  assert.ok(failureReasons({ g: 'mtg', t: 'Zzzzz Qqqq', n: '149/274 M11 • EN', c: 'Lightning Bolt|M11|149', h: 'fixed' }).includes('title-misread'));
});

test('a card the text was fine for but several printings fit is called an ambiguous reprint', () => {
  assert.deepEqual(failureReasons({ g: 'mtg', t: 'Sol Ring', n: '259/361 U CMD • EN', m: 'Sol Ring|C21|263', c: 'Sol Ring|CMD|259', h: 'fixed' }), ['ambiguous-reprint']);
});

test('the patterns are ranked, with examples, and the printed report reads plainly', () => {
  const a = analyze(rows);
  assert.ok(a.patterns.length >= 2);
  assert.ok(a.patterns[0].count >= a.patterns[a.patterns.length - 1].count);
  assert.ok(a.patterns.every((p) => p.examples.length >= 1 && p.examples.length <= 3));
  const r = report(text);
  assert.match(r, /Right first time: 5 of 10 \(50%\)/);
  assert.match(r, /Top failure patterns/);
  assert.match(r, /By game: mtg 75% of 4/);
  assert.match(report('junk'), /Not a Speed Scan results text/);
  assert.match(report('#speed-scan-results v1\n'), /no rows/);
});
