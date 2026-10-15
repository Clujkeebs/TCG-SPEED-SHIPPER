import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseCardText } from './parse.js';
import { resolveClues, similarity } from './resolve.js';
import { identifyFrame, identifyText } from './pipeline.js';
import { createIndex } from '../data/index.js';
import { decide, makeFeedback } from '../core/rapid.js';

const index = createIndex(JSON.parse(readFileSync(new URL('../data/sample/printings.json', import.meta.url), 'utf8')));

test('parse: each game layout', () => {
  assert.deepEqual(parseCardText('Lightning Bolt\n149/274 R\nM11 • EN', 'mtg'), { game: 'mtg', setCode: 'M11', number: '149', name: 'Lightning Bolt' });
  assert.deepEqual(parseCardText('Blue-Eyes White Dragon\nLOB-EN001', 'yugioh'), { game: 'yugioh', setCode: 'LOB', number: 'EN001', name: 'Blue-Eyes White Dragon' });
  assert.deepEqual(parseCardText('Nami\nOP01-016', 'onepiece'), { game: 'onepiece', setCode: 'OP01', number: '016', name: 'Nami' });
  const p = parseCardText('Charizard\n004/102', 'pokemon');
  assert.equal(p.number, '004'); assert.equal(p.setCode, undefined);
});

test('parse: reading slips inside numbers are repaired, names are left alone', () => {
  assert.equal(parseCardText('Nami\nOP0I-O16', 'onepiece').number, '016');
  assert.equal(parseCardText('Nami\nOP0I-O16', 'onepiece').setCode, 'OP01');
  assert.equal(parseCardText('X\nI49/274', 'mtg').number, '149');
  assert.deepEqual(parseCardText('', 'mtg'), { game: 'mtg', setCode: undefined, number: undefined, name: undefined });
  assert.equal(parseCardText(null).name, undefined);
});

test('similarity', () => {
  assert.equal(similarity('Nami', 'nami'), 1);
  assert.ok(similarity('Lightnng Bolt', 'Lightning Bolt') > 0.9);
  assert.ok(similarity('abc', 'xyz') < 0.1);
  assert.equal(similarity('', 'x'), 0);
});

test('resolve: exact set+number, number+name, and name only', () => {
  const a = resolveClues({ game: 'mtg', setCode: 'M11', number: '149', name: 'Lightning Bolt' }, index);
  assert.equal(a[0].printing.name, 'Lightning Bolt'); assert.ok(a[0].score >= 0.9);
  const b = resolveClues({ game: 'pokemon', number: '004', name: 'Charizard' }, index);
  assert.equal(b[0].printing.setCode, 'BASE1'); assert.ok(b[0].score >= 0.7 && b[0].score < 0.9);
  const c = resolveClues({ name: 'Pikachu' }, index);
  assert.ok(c.length >= 2 && c.every((x) => x.score <= 0.5));
  assert.deepEqual(resolveClues({}, index), []);
});

test('decide: auto-accept only when clear', () => {
  const p = (id, score) => ({ printing: { id }, score });
  assert.equal(decide([p('a', 1), p('b', 0.5)]).action, 'accept');
  assert.equal(decide([p('a', 0.95), p('b', 0.9)]).action, 'choose');
  assert.equal(decide([p('a', 0.6)]).action, 'choose');
  assert.equal(decide([]).action, 'none');
  assert.equal(decide([p('a', 1), p('b', 0.4), p('c', 0.3), p('d', 0.2)]).options.length, 3);
});

test('feedback calls the injected buzzers', () => {
  const calls = [];
  const f = makeFeedback({ vibrate: (p) => calls.push(['v', p]), beep: (hz) => calls.push(['b', hz]) });
  f.accepted(); f.needsTap(); f.miss();
  assert.equal(calls.length, 6);
  makeFeedback().accepted(); // silent defaults do not throw
});

test('identifyText: clean text accepts, a name-only reprint asks', () => {
  assert.equal(identifyText('Nami\nOP01-016', { index, game: 'onepiece' }).decision.action, 'accept');
  assert.equal(identifyText('Pikachu', { index, game: 'pokemon' }).decision.action, 'choose');
});

test('identifyFrame: crops the card, reads two strips, resolves', async () => {
  const W = 320, H = 240, data = new Uint8ClampedArray(W * H * 4).fill(255);
  for (let i = 0; i < W * H; i += 1) data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = 40;
  for (let y = 20; y < 196; y += 1) for (let x = 60; x < 186; x += 1) { const p = (y * W + x) * 4; data[p] = data[p + 1] = data[p + 2] = 200; }
  const seen = [];
  const engine = { async recognize(img, { region }) { seen.push([region, img.width, img.height]); return region === 'title' ? 'Sol Ring' : '259/302\nCMD • EN'; } };
  const r = await identifyFrame({ width: W, height: H, data }, { engine, index, game: 'mtg' });
  assert.equal(r.ok, true);
  assert.deepEqual(seen.map((s) => s[0]), ['title', 'bottom']);
  assert.equal(r.candidates[0].printing.name, 'Sol Ring');
  assert.equal(r.decision.action, 'accept');
  const none = await identifyFrame({ width: W, height: H, data: new Uint8ClampedArray(W * H * 4).fill(50) }, { engine, index });
  assert.deepEqual([none.ok, none.reason], [false, 'no-card']);
});
