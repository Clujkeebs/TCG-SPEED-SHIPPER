// Apply a PriceRule (docs/suite/DATA-MODEL.md) to a printing's prices. Whole cents only.
// Order of work: basis -> percent -> condition multiplier -> rounding -> minimum-to-list -> floor/ceiling.
//   * Rounding happens before the floor and ceiling, so a hard limit always wins over a pretty ending
//     (a ceiling of $4.50 with ends-99 gives $4.50, not $4.99).
//   * "Minimum to list" looks at the rounded price before the floor lifts it, so a floor never
//     turns bulk into a listing.
import { PRICE_BASES, ROUNDINGS, CONDITIONS } from '../../shared/models.js';

// A starting point sellers can edit. LP 90% / MP 75% / HP 55% / DMG 40% of Near Mint.
export const DEFAULT_CONDITION_MULTIPLIERS = { NM: 1, LP: 0.9, MP: 0.75, HP: 0.55, DMG: 0.4 };

export const DEFAULT_RULE = {
  id: 'default',
  name: '5% below market',
  basis: 'market',
  percent: -5,
  floorCents: 25,
  minListCents: 25,
  rounding: 'ends-99',
  conditionMultipliers: DEFAULT_CONDITION_MULTIPLIERS,
};

// Round to the nearest price that ends in `ending` cents (99 or 95). Below the first such price
// there is nothing to round to, so cents are kept as they are.
function roundEnding(cents, ending) {
  if (cents < ending) return cents;
  const dollars = Math.round((cents - ending) / 100);
  return dollars * 100 + ending;
}

export function roundCents(cents, rounding) {
  switch (rounding) {
    case 'cent': return Math.round(cents);
    case 'nickel': return Math.round(cents / 5) * 5;
    case 'dime': return Math.round(cents / 10) * 10;
    case 'dollar': return Math.round(cents / 100) * 100;
    case 'ends-99': return roundEnding(Math.round(cents), 99);
    case 'ends-95': return roundEnding(Math.round(cents), 95);
    default: throw new Error('unknown rounding: ' + rounding);
  }
}

function basePrice(rule, printing, finish) {
  if (rule.basis === 'fixed') return Number.isInteger(rule.fixedCents) ? rule.fixedCents : undefined;
  const row = printing && printing.prices && printing.prices.byFinish && printing.prices.byFinish[finish];
  const v = row && row[rule.basis];
  return Number.isInteger(v) && v > 0 ? v : undefined;
}

// Returns { status: 'priced', priceCents } | { status: 'skip', reason } | { status: 'missing', reason }.
//   skip    = the rule says do not list this card (under the minimum).
//   missing = no price is known for this condition/finish; the seller must type one. Never guessed.
export function applyPriceRule(rule, printing, { condition = 'NM', finish = 'nonfoil' } = {}) {
  if (!rule || !PRICE_BASES.includes(rule.basis)) throw new Error('a price rule with a known basis is required');
  if (!ROUNDINGS.includes(rule.rounding)) throw new Error('unknown rounding: ' + rule.rounding);
  if (!CONDITIONS.includes(condition)) throw new Error('unknown condition: ' + condition);

  const base = basePrice(rule, printing, finish);
  if (base === undefined) {
    return { status: 'missing', reason: 'No ' + rule.basis + ' price for ' + finish + '.' };
  }
  const multiplier = (rule.conditionMultipliers && rule.conditionMultipliers[condition]) ?? 1;
  const raw = (base * multiplier * (100 + rule.percent)) / 100;
  let cents = roundCents(raw + 1e-9, rule.rounding);

  if (cents < 1) return { status: 'skip', reason: 'Price works out to under one cent.' };
  if (Number.isInteger(rule.minListCents) && cents < rule.minListCents) {
    return { status: 'skip', reason: 'Under the minimum to list.' };
  }
  if (Number.isInteger(rule.floorCents) && cents < rule.floorCents) cents = rule.floorCents;
  if (Number.isInteger(rule.ceilingCents) && cents > rule.ceilingCents) cents = rule.ceilingCents;
  return { status: 'priced', priceCents: cents };
}
