import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizeScryfallCard } from './providers/scryfall.js';
import { createIndex } from './index.js';
import { validatePrinting, GAMES } from '../../shared/models.js';

const read = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url), 'utf8'));

test('scryfall: full card', () => {
  const p = normalizeScryfallCard(read('./fixtures/scryfall-card.json'), { asOf: '2026-10-15' });
  assert.deepEqual(validatePrinting(p), { ok: true, errors: [] });
  assert.equal(p.id, 'mtg:scryfall:00000000-0000-4000-8000-000000000001');
  assert.equal(p.setCode, 'TST');
  assert.equal(p.number, '149');
  assert.deepEqual(p.finishes, ['nonfoil', 'foil']);
  assert.equal(p.tcgplayerProductId, 900001);
  assert.deepEqual(p.prices.byFinish, { nonfoil: { market: 35 }, foil: { market: 120 } });
  assert.equal(p.prices.source, 'scryfall');
});

test('scryfall: no ids, odd number, face image, etched price', () => {
  const p = normalizeScryfallCard(read('./fixtures/scryfall-card-no-ids.json'), { asOf: '2026-10-15' });
  assert.equal(validatePrinting(p).ok, true);
  assert.equal('tcgplayerProductId' in p, false);
  assert.equal(p.number, '12a★');
  assert.deepEqual(p.finishes, ['etched']);
  assert.equal(p.imageUrl, 'https://example.invalid/f.jpg');
  assert.deepEqual(p.prices.byFinish, { etched: { market: 450 } });
});

test('scryfall: rejects junk and omits prices when none', () => {
  assert.throws(() => normalizeScryfallCard({}));
  assert.throws(() => normalizeScryfallCard(null));
  const p = normalizeScryfallCard({ id: 'x', name: 'N', set: 's', collector_number: '1', prices: { usd: null } });
  assert.equal('prices' in p, false);
  assert.deepEqual(p.finishes, ['nonfoil']);
});

const sample = read('./sample/printings.json');
const idx = createIndex(sample);

test('sample data: about 100 valid printings across four games, no invented product ids', () => {
  assert.ok(sample.length >= 90 && sample.length <= 110, String(sample.length));
  for (const g of ['mtg', 'pokemon', 'yugioh', 'onepiece']) assert.ok(sample.filter((p) => p.game === g).length >= 15, g);
  for (const p of sample) {
    assert.deepEqual(validatePrinting(p).errors, [], p.id);
    assert.ok(GAMES.includes(p.game));
    assert.equal('tcgplayerProductId' in p, false, p.id);
    assert.equal('imageUrl' in p, false, p.id);
    assert.equal(p.prices.source, 'synthetic-demo');
  }
  assert.equal(new Set(sample.map((p) => p.id)).size, sample.length);
  const keys = sample.map((p) => [p.game, p.setCode, p.number].join('|'));
  assert.equal(new Set(keys).size, keys.length, 'duplicate set+number');
});

test('search by name, set, number, game and accents', () => {
  assert.equal(idx.search('lightning bolt')[0].name, 'Lightning Bolt');
  assert.equal(idx.search('bolt m11')[0].setCode, 'M11');
  assert.equal(idx.search('m11 149')[0].name, 'Lightning Bolt');
  assert.equal(idx.search('charizard base1 4')[0].setCode, 'BASE1');
  assert.equal(idx.search('LIGHTNING')[0].name, 'Lightning Bolt');
  assert.deepEqual(idx.search('zzzzzz'), []);
  assert.deepEqual(idx.search(''), []);
  assert.ok(idx.search('zoro').every((p) => p.game === 'onepiece'));
  assert.ok(idx.search('pikachu', { game: 'pokemon' }).every((p) => p.game === 'pokemon'));
  assert.equal(idx.search('pikachu', { game: 'mtg' }).length, 0);
  assert.ok(idx.search('a', { limit: 3 }).length <= 3);
  assert.equal(idx.search('blue eyes en001', { game: 'yugioh' })[0].name, 'Blue-Eyes White Dragon');
  assert.equal(idx.search('op01 016')[0].name, 'Nami');
});

test('lookup by set code and printed number ignores case and leading zeros', () => {
  assert.equal(idx.findBySetNumber('op01', '16', 'onepiece')[0].name, 'Nami');
  assert.equal(idx.findBySetNumber('M11', '149')[0].name, 'Lightning Bolt');
  assert.deepEqual(idx.findBySetNumber('M11', '9999'), []);
});

test('index rejects bad printings and ignores duplicates', () => {
  const i = createIndex();
  assert.throws(() => i.add({ id: 'x' }));
  i.add(sample[0]); i.add(sample[0]);
  assert.equal(i.size(), 1);
});
