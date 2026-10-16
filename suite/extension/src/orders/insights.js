// Plain numbers from the seller's orders, computed on this device with the Agent's own analytics.
// Buyers are shown as first name and last initial ("Ada A."); nothing else about a buyer is shown.
import { repeatBuyers, destinations, cadence, inRange } from '../vendor/agent/analytics.js';

const DAY = 86400000;
const ORDER = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function shortName(full) {
  const parts = String(full ?? '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return 'A buyer';
  const first = parts[0].slice(0, 20);
  return parts.length > 1 ? `${first} ${[...parts[parts.length - 1]][0].toUpperCase()}.` : first;
}

// buyerKey -> "Ada A." (the first name seen for that key). Used to make plain text from the Agent readable.
export function buyerLabels(orders) {
  const m = new Map();
  for (const o of orders) if (!m.has(o.buyerKey)) m.set(o.buyerKey, shortName(o.shipTo.name));
  return m;
}

export function computeInsights(orders) {
  if (!orders.length) return null;
  const labels = buyerLabels(orders);
  const times = orders.map((o) => Date.parse(o.orderedAt));
  const newest = Math.max(...times), oldest = Math.min(...times);
  const total = orders.reduce((s, o) => s + o.itemsTotalCents, 0);
  const rep = repeatBuyers(orders);
  const dest = destinations(orders).slice(0, 5);
  const cad = cadence(orders);
  const end = newest + 1; // include the newest order itself
  const sum = (l) => l.reduce((s, o) => s + o.itemsTotalCents, 0);
  const thisWeek = inRange(orders, new Date(end - 7 * DAY).toISOString(), new Date(end).toISOString());
  const lastWeek = inRange(orders, new Date(end - 14 * DAY).toISOString(), new Date(end - 7 * DAY).toISOString());
  return {
    orders: orders.length,
    from: new Date(oldest).toISOString().slice(0, 10), to: new Date(newest).toISOString().slice(0, 10),
    averageOrderCents: Math.round(total / orders.length),
    repeat: { buyers: rep.buyers, repeatBuyers: rep.repeatBuyers, shareOfOrders: rep.repeatShareOfOrders, top: rep.top.slice(0, 5).map((b) => ({ label: labels.get(b.buyerKey) ?? 'A buyer', orders: b.orders, spendCents: b.spendCents })) },
    states: dest.map((d) => ({ state: d.state || '?', orders: d.orders, share: d.shareOfOrders })),
    weekdays: ORDER.map((day) => ({ day, orders: cad.byWeekday[day] ?? 0 })),
    busiestWeekday: cad.busiestWeekday,
    thisWeek: { orders: thisWeek.length, revenueCents: sum(thisWeek) },
    lastWeek: { orders: lastWeek.length, revenueCents: sum(lastWeek) },
    changePct: sum(lastWeek) ? Math.round(((sum(thisWeek) - sum(lastWeek)) / sum(lastWeek)) * 1000) / 10 : null
  };
}
