import test from 'node:test';
import assert from 'node:assert/strict';
import { PRESETS, presetToFields } from './presets.js';
import { applyPriceRule } from './pricing.js';
import { validatePriceRule } from '../../shared/models.js';

const P = { prices: { asOf: '2026-10-15', source: 't', byFinish: { nonfoil: { market: 1000, low: 900 } } } };

test('every preset is a valid price rule and prices a card', () => {
  for (const p of PRESETS) {
    const rule = { id: p.key, name: p.label, basis: p.basis, percent: p.percent, rounding: p.rounding, floorCents: p.floorCents, minListCents: p.minListCents };
    assert.deepEqual(validatePriceRule(rule).errors, [], p.key);
    assert.equal(applyPriceRule(rule, P).status, 'priced', p.key);
  }
});

test('5% under market on $10.00 is $9.50, which rounds to the nearest .99: $9.99', () => {
  const p = PRESETS.find((x) => x.key === 'five-under');
  const out = applyPriceRule({ id: 'a', name: 'a', ...p }, P);
  assert.equal(out.priceCents, 999);
});

test('bulk preset skips cheap cards', () => {
  const p = PRESETS.find((x) => x.key === 'bulk-skip');
  const cheap = { prices: { asOf: '2026-10-15', source: 't', byFinish: { nonfoil: { market: 50 } } } };
  assert.equal(applyPriceRule({ id: 'a', name: 'a', ...p }, cheap).status, 'skip');
});

test('presetToFields gives dollar strings', () => {
  assert.deepEqual(presetToFields(PRESETS[0]), { basis: 'market', percent: '-5', rounding: 'ends-99', floor: '0.25', ceiling: '', minList: '0.25' });
});
