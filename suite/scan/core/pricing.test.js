import test from 'node:test';
import assert from 'node:assert/strict';
import { applyPriceRule, roundCents, DEFAULT_CONDITION_MULTIPLIERS } from './pricing.js';
import { validatePriceRule } from '../../shared/models.js';

const printing = (market, extra = {}) => ({
  prices: { asOf: '2026-10-15', source: 't', byFinish: { nonfoil: { market, low: extra.low, mid: extra.mid }, foil: { market: extra.foil } } },
});
const rule = (o) => ({ id: 'r', name: 'r', basis: 'market', percent: 0, rounding: 'cent', ...o });
const price = (r, p, opts) => applyPriceRule(r, p, opts);

test('rounding modes', () => {
  const rows = [
    ['cent', 123.4, 123], ['cent', 123.5, 124],
    ['nickel', 122, 120], ['nickel', 123, 125],
    ['dime', 124, 120], ['dime', 125, 130],
    ['dollar', 149, 100], ['dollar', 150, 200],
    ['ends-99', 130, 99], ['ends-99', 160, 199], ['ends-99', 199, 199], ['ends-99', 250, 299], ['ends-99', 40, 40],
    ['ends-95', 130, 95], ['ends-95', 160, 195], ['ends-95', 90, 90],
  ];
  for (const [mode, input, want] of rows) assert.equal(roundCents(input, mode), want, mode + ' ' + input);
  assert.throws(() => roundCents(1, 'bogus'));
});

test('percent below and above market', () => {
  assert.equal(price(rule({ percent: -5 }), printing(1000)).priceCents, 950);
  assert.equal(price(rule({ percent: 10 }), printing(1000)).priceCents, 1100);
  assert.equal(price(rule({ percent: 0 }), printing(333)).priceCents, 333);
  assert.equal(price(rule({ percent: -100 }), printing(333)).status, 'skip');
});

test('other bases and fixed', () => {
  const p = printing(500, { low: 400, mid: 600 });
  assert.equal(price(rule({ basis: 'low' }), p).priceCents, 400);
  assert.equal(price(rule({ basis: 'mid' }), p).priceCents, 600);
  assert.equal(price(rule({ basis: 'fixed', fixedCents: 99 }), {}).priceCents, 99);
  assert.equal(price(rule({ basis: 'fixed', fixedCents: 99, percent: 100 }), {}).priceCents, 198);
});

test('foil uses the foil price; missing prices are reported, never guessed', () => {
  const p = printing(100, { foil: 450 });
  assert.equal(price(rule(), p, { finish: 'foil' }).priceCents, 450);
  assert.equal(price(rule(), p, { finish: 'etched' }).status, 'missing');
  assert.equal(price(rule(), {}).status, 'missing');
  assert.equal(price(rule(), undefined).status, 'missing');
  assert.equal(price(rule({ basis: 'low' }), printing(100)).status, 'missing');
  assert.equal(price(rule(), printing(0)).status, 'missing');
});

test('floor and ceiling', () => {
  assert.equal(price(rule({ floorCents: 50 }), printing(30)).priceCents, 50);
  assert.equal(price(rule({ ceilingCents: 1000 }), printing(5000)).priceCents, 1000);
  assert.equal(price(rule({ floorCents: 50, ceilingCents: 60 }), printing(55)).priceCents, 55);
});

test('rounding up past the ceiling: the ceiling wins', () => {
  const r = rule({ rounding: 'ends-99', ceilingCents: 450 });
  assert.equal(price(r, printing(460)).priceCents, 450); // 460 -> 499 -> capped
  assert.equal(price(rule({ rounding: 'dollar', ceilingCents: 1000 }), printing(960)).priceCents, 1000);
});

test('rounding down below the floor: the floor wins', () => {
  assert.equal(price(rule({ rounding: 'ends-99', floorCents: 150 }), printing(130)).priceCents, 150);
});

test('minimum to list returns skip, judged before the floor lifts the price', () => {
  const r = rule({ minListCents: 100, floorCents: 150 });
  assert.deepEqual(price(r, printing(99)).status, 'skip');
  assert.equal(price(r, printing(100)).priceCents, 150);
  assert.equal(price(rule({ minListCents: 100 }), printing(100)).priceCents, 100);
});

test('condition multipliers', () => {
  const r = rule({ conditionMultipliers: DEFAULT_CONDITION_MULTIPLIERS });
  assert.equal(price(r, printing(1000), { condition: 'NM' }).priceCents, 1000);
  assert.equal(price(r, printing(1000), { condition: 'LP' }).priceCents, 900);
  assert.equal(price(r, printing(1000), { condition: 'DMG' }).priceCents, 400);
  assert.equal(price(rule(), printing(1000), { condition: 'HP' }).priceCents, 1000); // no multipliers set
  assert.throws(() => price(r, printing(1000), { condition: 'XX' }));
});

test('results are always whole cents, even with awkward numbers', () => {
  for (const base of [1, 7, 33, 199, 1234, 98765]) {
    for (const pct of [-33, -5, 7.5, 12]) {
      const out = price(rule({ percent: pct, conditionMultipliers: { LP: 0.9 } }), printing(base), { condition: 'LP' });
      if (out.status === 'priced') assert.ok(Number.isInteger(out.priceCents) && out.priceCents > 0);
    }
  }
});

test('bad rules throw', () => {
  assert.throws(() => price(undefined, printing(1)));
  assert.throws(() => price(rule({ rounding: 'x' }), printing(1)));
  assert.equal(validatePriceRule(rule({ conditionMultipliers: DEFAULT_CONDITION_MULTIPLIERS })).ok, true);
});
