// One-tap price rules. Values are starting points; the seller can still edit every field after choosing one.
export const PRESETS = [
  { key: 'five-under', label: '5% under market', basis: 'market', percent: -5, rounding: 'ends-99', floorCents: 25, minListCents: 25 },
  { key: 'market', label: 'At market', basis: 'market', percent: 0, rounding: 'ends-99', floorCents: 25, minListCents: 25 },
  { key: 'low', label: 'Match the lowest price', basis: 'low', percent: 0, rounding: 'cent', floorCents: 25, minListCents: 25 },
  { key: 'ten-under', label: '10% under market', basis: 'market', percent: -10, rounding: 'ends-99', floorCents: 25, minListCents: 25 },
  { key: 'bulk-skip', label: 'Skip bulk under $1', basis: 'market', percent: -5, rounding: 'ends-99', floorCents: 99, minListCents: 100 },
];

// Fill the form-field map used by the app from a preset (money in dollars as strings).
export function presetToFields(p) {
  const d = (c) => (c === undefined ? '' : (c / 100).toFixed(2));
  return { basis: p.basis, percent: String(p.percent), rounding: p.rounding, floor: d(p.floorCents), ceiling: d(p.ceilingCents), minList: d(p.minListCents) };
}
