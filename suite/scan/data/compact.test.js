import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { packIndex, unpackIndex, coverageReport, validateAll } from './compact.js';
import { importCards } from './import/build-index.js';
import { loadIndex } from './load.js';
import { normalizeScryfallCard } from './providers/scryfall.js';

const read = (p) => JSON.parse(readFileSync(new URL('./fixtures/' + p, import.meta.url), 'utf8'));
const asOf = '2026-10-15';

test('pack then unpack gives the same printings (with and without product id and prices)', () => {
  const ps = [normalizeScryfallCard(read('scryfall-card.json'), { asOf }), normalizeScryfallCard(read('scryfall-card-no-ids.json'), { asOf })];
  const back = unpackIndex(packIndex(ps, { game: 'mtg', asOf, source: 'scryfall' }));
  const noImg = ps.map(({ imageUrl, ...rest }) => rest); // images are deliberately not stored in the index
  assert.deepEqual(back, noImg);
  assert.equal(back[0].tcgplayerProductId, 900001);
  assert.equal('tcgplayerProductId' in back[1], false);
  assert.deepEqual(validateAll(back), []);
});

test('unpack refuses an unknown file', () => {
  assert.throws(() => unpackIndex({ version: 99, rows: [] }));
  assert.throws(() => unpackIndex(null));
});

test('importers run on tiny fixtures for every provider, skip bad rows, report coverage', () => {
  const m = importCards('scryfall', [read('scryfall-card.json'), read('scryfall-card-no-ids.json'), { junk: true }], { asOf });
  assert.equal(m.index.count, 2); assert.equal(m.skipped, 1);
  assert.deepEqual(m.coverage.mtg, { printings: 2, withProductId: 1, withPrice: 2, productIdPct: 50 });
  assert.equal(importCards('pokemontcg', { data: [read('pokemontcg-card.json')] }, { asOf }).index.game, 'pokemon');
  const y = importCards('ygoprodeck', { data: [read('ygoprodeck-card.json')] }, { asOf });
  assert.equal(y.index.count, 2); assert.equal(y.coverage.yugioh.withProductId, 0);
  assert.equal(importCards('onepiece', [read('onepiece-card.json')], { asOf }).index.count, 1);
  assert.throws(() => importCards('nope', []));
});

test('coverage report counts only real ids', () => {
  const c = coverageReport([{ game: 'mtg', tcgplayerProductId: 5 }, { game: 'mtg' }, { game: 'pokemon' }]);
  assert.deepEqual(c.mtg, { printings: 2, withProductId: 1, withPrice: 0, productIdPct: 50 });
  assert.equal(c.pokemon.productIdPct, 0);
});

test('loadIndex merges the sample with game files and tolerates missing ones', async () => {
  const mtg = importCards('scryfall', [read('scryfall-card.json')], { asOf }).index;
  const files = { 'x/sample/printings.json': read('../sample/printings.json'), 'x/index/mtg.json': mtg };
  const fetchJson = async (u) => { if (!files[u]) throw new Error('404'); return files[u]; };
  const { index, loaded } = await loadIndex(fetchJson, { base: 'x/' });
  assert.deepEqual(loaded, ['mtg']);
  assert.equal(index.search('test bolt')[0].tcgplayerProductId, 900001);
  assert.ok(index.size() > 90);
});
