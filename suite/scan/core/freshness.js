// How old is the price on a printing? Scryfall asks that its prices are not kept longer than 24 hours, so an older
// price is "stale": refetch it when online, otherwise show its date and warn before a price rule is applied to it.
export const MAX_PRICE_AGE_HOURS = 24;

// Returns { state: 'fresh' | 'stale' | 'demo' | 'none', asOf?, ageHours? }.
//   demo = the made-up sample prices (never real, no age rule); none = no price for this finish.
export function priceFreshness(printing, finish, now = Date.now(), maxHours = MAX_PRICE_AGE_HOURS) {
  const pr = printing && printing.prices;
  if (!pr || !pr.byFinish || !pr.byFinish[finish]) return { state: 'none' };
  if (pr.source === 'synthetic-demo') return { state: 'demo', asOf: pr.asOf };
  const t = Date.parse(pr.asOf);
  if (Number.isNaN(t)) return { state: 'stale', asOf: pr.asOf }; // unknown age is treated as old
  const ageHours = (now - t) / 3600000;
  // A plain date (no time) means "sometime that day": count it from the end of that day to avoid false alarms.
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(pr.asOf);
  const effective = dateOnly ? ageHours - 24 : ageHours;
  return { state: effective > maxHours ? 'stale' : 'fresh', asOf: pr.asOf, ageHours: Math.max(0, Math.round(ageHours * 10) / 10) };
}

export function formatAsOf(asOf) {
  const d = new Date(asOf);
  return Number.isNaN(d.getTime()) ? String(asOf) : d.toISOString().slice(0, 10);
}
