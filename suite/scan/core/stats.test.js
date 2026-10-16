import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyStats, recordScan, summarize } from './stats.js';
import { addEntry, buildResultsText, parseResultsText, MAX_ROWS } from './scanlog.js';

test('right first time counts auto (unless removed) plus taps on the first guess', () => {
  let s = emptyStats();
  assert.match(summarize(s).text, /no scanned cards yet/);
  for (const k of ['auto', 'auto', 'auto', 'tap', 'fixed']) s = recordScan(s, k);
  const m = summarize(s);
  assert.deepEqual([m.total, m.rightFirst], [5, 4]);
  assert.match(m.text, /Right first time: 4 of 5/);
  assert.match(m.text, /measured from this device/i);
  s = recordScan(s, 'autoUndone'); s = recordScan(s, 'notFound');
  const m2 = summarize(s);
  assert.equal(m2.rightFirst, 3); assert.match(m2.text, /removed after auto-add 1/); assert.match(m2.text, /not found 1/);
  assert.throws(() => recordScan(s, 'bogus'));
  assert.equal(summarize({ auto: 1, autoUndone: 5 }).rightFirst, 0); // never negative
});

test('results text: header, one JSON row per card, 60 row cap, nothing but the listed fields', () => {
  let log = [];
  for (let i = 0; i < 70; i += 1) log = addEntry(log, { g: 'mtg', t: 'Lightning Bolt' + i, n: '149/274 R\nM11 • EN', m: 'Lightning Bolt|M11|149', c: 'Lightning Bolt|M11|149', h: 'auto', s: 1, secret: 'x', image: 'data:...' });
  assert.equal(log.length, MAX_ROWS);
  assert.equal(log[0].t, 'Lightning Bolt10'); // the newest 60 stay
  const txt = buildResultsText(log, { version: 'v1', now: () => '2026-10-16T05:00:00Z' });
  const lines = txt.split('\n');
  assert.deepEqual(lines.slice(0, 4), ['#speed-scan-results v1', '#app v1', '#date 2026-10-16', '#rows 60']);
  assert.equal(lines.length, 64);
  assert.doesNotMatch(txt, /secret|data:/);
  assert.deepEqual(Object.keys(JSON.parse(lines[4])).sort(), ['c', 'g', 'h', 'm', 'n', 's', 't']);
});

test('parse reads it back and shrugs off junk', () => {
  const log = addEntry(addEntry([], { g: 'pokemon', t: 'Pikachu', n: '058/102', m: 'Pikachu|BASE1|58', c: 'Pikachu|BASE1|58', h: 'tap', s: 0.85 }), { g: 'mtg', t: '', n: '', h: 'none', s: 0 });
  const p = parseResultsText('hello\n' + buildResultsText(log, { version: 'v', now: () => '2026-10-16T00:00:00Z' }) + '\n{not json}\n{"x":1}');
  assert.equal(p.ok, true); assert.equal(p.rows.length, 2); assert.equal(p.skipped, 2);
  assert.equal(p.rows[0].c, 'Pikachu|BASE1|58'); assert.equal(p.app, 'v');
  assert.equal(parseResultsText('nothing here').ok, false);
  assert.equal(parseResultsText(null).ok, false);
});
