// Pure functions over Orders (shape: docs/suite/DATA-MODEL.md). No names or street addresses in any output;
// buyers are identified by their local buyerKey only.
const DAY = 86400000;
const t = (iso) => Date.parse(iso);
const round1 = (n) => Math.round(n * 10) / 10;
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function inRange(orders, since, until) {
  const lo = since ? t(since) : -Infinity;
  const hi = until ? t(until) : Infinity;
  return orders.filter((o) => t(o.orderedAt) >= lo && t(o.orderedAt) < hi);
}

export function repeatBuyers(orders, { minOrders = 2 } = {}) {
  const by = new Map();
  for (const o of orders) {
    const b = by.get(o.buyerKey) || { buyerKey: o.buyerKey, orders: 0, spendCents: 0, first: o.orderedAt, last: o.orderedAt, states: new Set() };
    b.orders += 1;
    b.spendCents += o.itemsTotalCents;
    if (o.orderedAt < b.first) b.first = o.orderedAt;
    if (o.orderedAt > b.last) b.last = o.orderedAt;
    b.states.add(o.shipTo.state);
    by.set(o.buyerKey, b);
  }
  const all = [...by.values()];
  const repeat = all.filter((b) => b.orders >= minOrders)
    .sort((a, b) => b.orders - a.orders || b.spendCents - a.spendCents || a.buyerKey.localeCompare(b.buyerKey))
    .map((b) => ({ buyerKey: b.buyerKey, orders: b.orders, spendCents: b.spendCents, firstOrderAt: b.first, lastOrderAt: b.last, daysBetweenOrders: round1((t(b.last) - t(b.first)) / DAY / (b.orders - 1)) }));
  const repeatOrders = repeat.reduce((s, b) => s + b.orders, 0);
  return {
    buyers: all.length,
    repeatBuyers: repeat.length,
    repeatShareOfBuyers: all.length ? round1((repeat.length / all.length) * 100) : 0,
    repeatShareOfOrders: orders.length ? round1((repeatOrders / orders.length) * 100) : 0,
    top: repeat.slice(0, 10),
  };
}

export function destinations(orders) {
  const by = new Map();
  for (const o of orders) {
    const s = by.get(o.shipTo.state) || { state: o.shipTo.state, orders: 0, revenueCents: 0 };
    s.orders += 1; s.revenueCents += o.itemsTotalCents;
    by.set(o.shipTo.state, s);
  }
  return [...by.values()].sort((a, b) => b.orders - a.orders || a.state.localeCompare(b.state))
    .map((s) => ({ ...s, shareOfOrders: orders.length ? round1((s.orders / orders.length) * 100) : 0 }));
}

export function cadence(orders) {
  if (!orders.length) return { orders: 0, perWeek: 0, byWeekday: {}, busiestWeekday: null, avgDaysToShip: null, shippedWithin2DaysPct: null };
  const times = orders.map((o) => t(o.orderedAt));
  const spanDays = Math.max(1, (Math.max(...times) - Math.min(...times)) / DAY);
  const byWeekday = Object.fromEntries(WEEKDAYS.map((d) => [d, 0]));
  for (const o of orders) byWeekday[WEEKDAYS[new Date(o.orderedAt).getUTCDay()]] += 1;
  const busiest = Object.entries(byWeekday).sort((a, b) => b[1] - a[1] || WEEKDAYS.indexOf(a[0]) - WEEKDAYS.indexOf(b[0]))[0][0];
  const shipped = orders.filter((o) => o.shippedAt);
  const lags = shipped.map((o) => (t(o.shippedAt) - t(o.orderedAt)) / DAY);
  return {
    orders: orders.length,
    perWeek: round1((orders.length / spanDays) * 7),
    byWeekday,
    busiestWeekday: busiest,
    avgDaysToShip: lags.length ? round1(lags.reduce((a, b) => a + b, 0) / lags.length) : null,
    shippedWithin2DaysPct: lags.length ? round1((lags.filter((d) => d <= 2).length / lags.length) * 100) : null,
  };
}

export function summarizeOrder(o) {
  return {
    id: o.id, source: o.source, orderedAt: o.orderedAt, status: o.status, buyerKey: o.buyerKey, state: o.shipTo.state,
    items: o.items.map((i) => ({ name: i.name, quantity: i.quantity, priceCents: i.priceCents })),
    itemsTotalCents: o.itemsTotalCents, shippedAt: o.shippedAt, trackingNumber: o.trackingNumber,
  };
}

// Units sold per item name in a window.
export function unitsSold(orders) {
  const by = new Map();
  for (const o of orders) for (const i of o.items) by.set(i.name, (by.get(i.name) || 0) + i.quantity);
  return by;
}

export function weekly(orders, { weekEnding }) {
  const end = t(weekEnding);
  const thisWeek = inRange(orders, new Date(end - 7 * DAY).toISOString(), new Date(end).toISOString());
  const lastWeek = inRange(orders, new Date(end - 14 * DAY).toISOString(), new Date(end - 7 * DAY).toISOString());
  const before = new Set(orders.filter((o) => t(o.orderedAt) < end - 7 * DAY).map((o) => o.buyerKey));
  const sum = (list) => list.reduce((s, o) => s + o.itemsTotalCents, 0);
  const sold = [...unitsSold(thisWeek).entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 5).map(([name, units]) => ({ name, units }));
  const buyersThisWeek = new Set(thisWeek.map((o) => o.buyerKey));
  const waiting = orders.filter((o) => o.status === 'paid' && end - t(o.orderedAt) > 2 * DAY).map((o) => o.id);
  return {
    weekEnding,
    orders: thisWeek.length,
    ordersLastWeek: lastWeek.length,
    revenueCents: sum(thisWeek),
    revenueLastWeekCents: sum(lastWeek),
    changeInRevenuePct: sum(lastWeek) ? round1(((sum(thisWeek) - sum(lastWeek)) / sum(lastWeek)) * 100) : null,
    returningBuyers: [...buyersThisWeek].filter((k) => before.has(k)).length,
    newBuyers: [...buyersThisWeek].filter((k) => !before.has(k)).length,
    topItems: sold,
    unshippedOverTwoDays: waiting,
  };
}

// Chart-ready data: plain arrays a chart library can take as is. No drawing here.
//   { kind, title, type: 'line' | 'bar', x: [labels], series: [{ name, unit, values: [numbers] }] }
export function chartSeries(orders, kind, { now, weeks = 12 } = {}) {
  if (kind === 'orders-per-week') {
    const end = t(now);
    const x = [], count = [], revenue = [];
    for (let w = weeks - 1; w >= 0; w--) {
      const lo = end - (w + 1) * 7 * DAY, hi = end - w * 7 * DAY;
      const list = orders.filter((o) => t(o.orderedAt) >= lo && t(o.orderedAt) < hi);
      x.push(new Date(lo).toISOString().slice(0, 10));
      count.push(list.length);
      revenue.push(list.reduce((s, o) => s + o.itemsTotalCents, 0));
    }
    return { kind, title: `Orders per week, last ${weeks} weeks (label = week start)`, type: 'line', x, series: [{ name: 'Orders', unit: 'orders', values: count }, { name: 'Sales', unit: 'cents', values: revenue }] };
  }
  if (kind === 'destinations') {
    const d = destinations(orders).slice(0, 10);
    return { kind, title: 'Orders by destination state (top 10)', type: 'bar', x: d.map((s) => s.state), series: [{ name: 'Orders', unit: 'orders', values: d.map((s) => s.orders) }] };
  }
  if (kind === 'weekday') {
    const c = cadence(orders);
    return { kind, title: 'Orders by weekday', type: 'bar', x: WEEKDAYS, series: [{ name: 'Orders', unit: 'orders', values: WEEKDAYS.map((d) => c.byWeekday[d] || 0) }] };
  }
  if (kind === 'buyer-mix') {
    const per = new Map();
    for (const o of orders) per.set(o.buyerKey, (per.get(o.buyerKey) || 0) + 1);
    const once = [...per.values()].filter((n) => n === 1).length;
    return { kind, title: 'Buyers: one order vs repeat', type: 'bar', x: ['One order', 'Repeat'], series: [{ name: 'Buyers', unit: 'buyers', values: [once, per.size - once] }] };
  }
  throw new Error('unknown chart ' + kind);
}
export const CHART_KINDS = ['orders-per-week', 'destinations', 'weekday', 'buyer-mix'];

const money = (c) => '$' + (c / 100).toFixed(2);
// A plain-words weekly summary written from the numbers (no model needed).
export function weeklyText(w) {
  const lines = [`Week ending ${w.weekEnding.slice(0, 10)}`];
  lines.push(`${w.orders} orders, ${money(w.revenueCents)} in sales` + (w.changeInRevenuePct === null ? '.' : ` (${w.changeInRevenuePct >= 0 ? 'up' : 'down'} ${Math.abs(w.changeInRevenuePct)}% on last week).`));
  lines.push(`${w.newBuyers} new buyers, ${w.returningBuyers} returning.`);
  if (w.topItems.length) lines.push('Best sellers: ' + w.topItems.map((i) => `${i.name} (${i.units})`).join(', ') + '.');
  lines.push(w.unshippedOverTwoDays.length ? `Needs attention: ${w.unshippedOverTwoDays.length} paid orders not shipped after 2 days (${w.unshippedOverTwoDays.join(', ')}).` : 'Nothing waiting over 2 days.');
  return lines.join('\n');
}
