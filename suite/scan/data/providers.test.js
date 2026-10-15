import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizePokemonCard } from './providers/pokemontcg.js';
import { normalizeYgoCard } from './providers/ygoprodeck.js';
import { normalizeOnePieceCard } from './providers/onepiece.js';
import { validatePrinting } from '../../shared/models.js';

const read = (p) => JSON.parse(readFileSync(new URL('./fixtures/' + p, import.meta.url), 'utf8'));
const asOf = '2026-10-15';

test('pokemon: variants become finishes with cents; unknown variants ignored; no product id', () => {
  const p = normalizePokemonCard(read('pokemontcg-card.json'), { asOf });
  assert.equal(validatePrinting(p).ok, true);
  assert.deepEqual(p.finishes, ['holo', 'first-edition']);
  assert.deepEqual(p.prices.byFinish.holo, { market: 1225, low: 1050, mid: 1400 });
  assert.equal(p.prices.byFinish['first-edition'].market, 9950);
  assert.equal(p.setCode, 'TST1'); assert.equal(p.number, '4');
  assert.equal('tcgplayerProductId' in p, false);
  assert.throws(() => normalizePokemonCard({}));
  assert.equal(normalizePokemonCard({ id: 'a-1', name: 'N', number: '1', set: { id: 'a' } }, { asOf }).finishes[0], 'nonfoil');
});

test('yugioh: one printing per set listing, number keeps the region prefix', () => {
  const ps = normalizeYgoCard(read('ygoprodeck-card.json'), { asOf });
  assert.equal(ps.length, 2);
  for (const p of ps) assert.equal(validatePrinting(p).ok, true, p.id);
  assert.deepEqual(ps.map((p) => [p.setCode, p.number]), [['TST', 'EN001'], ['TRP', 'EN010']]);
  assert.equal(ps[0].prices.byFinish.unlimited.market, 150);
  assert.notEqual(ps[0].id, ps[1].id);
  assert.throws(() => normalizeYgoCard({ id: 1, name: 'x', card_sets: [{ set_code: 'bad' }] }));
  assert.throws(() => normalizeYgoCard({}));
});

test('one piece: set code and number split, price optional', () => {
  const p = normalizeOnePieceCard(read('onepiece-card.json'), { asOf });
  assert.equal(validatePrinting(p).ok, true);
  assert.deepEqual([p.setCode, p.number, p.prices.byFinish.nonfoil.market], ['TS01', '016', 225]);
  assert.equal('prices' in normalizeOnePieceCard({ card_set_id: 'OP01-001', card_name: 'X' }, { asOf }), false);
  assert.throws(() => normalizeOnePieceCard({ card_set_id: 'nope', card_name: 'x' }));
});
