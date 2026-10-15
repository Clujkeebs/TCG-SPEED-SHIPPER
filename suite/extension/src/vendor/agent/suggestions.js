// "Five things worth doing": a weekly list built only from the seller's orders and stock, each with the real
// numbers behind it and a goal the seller can tap to turn into a plan. Never invents a figure; if fewer than
// five things are worth doing it returns fewer.
export function weeklySuggestions({ run, now, memory, limit = 5 }) {
  const out = [];
  const add = (s) => out.push(s);
  const mem = (k, d) => { const v = memory ? memory.get(k) : undefined; return v === undefined ? d : v; };

  const week = run('report.weekly', { weekEnding: now });
  if (week.unshippedOverTwoDays.length) {
    add({ id: 'late-orders', score: 100 + week.unshippedOverTwoDays.length, title: `Ship ${week.unshippedOverTwoDays.length} late order${week.unshippedOverTwoDays.length > 1 ? 's' : ''}`, why: `${week.unshippedOverTwoDays.length} paid orders have waited more than 2 days (${week.unshippedOverTwoDays.slice(0, 3).join(', ')}).`, goal: 'Show orders waiting to ship' });
  }
  const restock = run('inventory.restock', { threshold: mem('restock.threshold', 2), windowDays: 60 });
  if (restock.items.length) {
    const top = restock.items[0];
    add({ id: 'restock', score: 80 + Math.min(19, restock.items.length), title: `Restock ${restock.items.length} cards that are selling out`, why: `${top.name} sold ${top.soldInWindow} in 60 days and you have ${top.inStock} left.`, goal: 'Restock what is running low' });
  }
  const percent = mem('price.percent', 5);
  const prices = run('pricing.suggestBatch', { rule: { id: 'weekly-rule', name: `${percent}% under market`, basis: 'market', percent: -percent, floorCents: 25, minListCents: 25, rounding: 'ends-99' }, onlyChanged: true, limit: 100 });
  if (prices.total >= 5) {
    add({ id: 'reprice', score: 60 + Math.min(19, prices.total), title: `Reprice ${prices.total} cards`, why: `${prices.total} of your cards are not at ${percent}% under market, the largest gap is ${prices.rows[0].name}.`, goal: `Reprice my cards ${percent}% under market` });
  }
  const mix = run('orders.stats', { since: new Date(Date.parse(now) - 90 * 86400000).toISOString() });
  if (mix.repeat.repeatBuyers > 0) {
    add({ id: 'repeat-buyers', score: 50 + Math.min(9, mix.repeat.repeatBuyers), title: 'Look after your repeat buyers', why: `${mix.repeat.repeatBuyers} of ${mix.repeat.buyers} buyers in the last 90 days ordered more than once; they are ${mix.repeat.repeatShareOfOrders}% of orders.`, goal: 'Who are my repeat customers?' });
  }
  const c = mix.cadence;
  if (c.shippedWithin2DaysPct !== null && c.shippedWithin2DaysPct < 90) {
    add({ id: 'ship-speed', score: 55, title: 'Ship faster', why: `Only ${c.shippedWithin2DaysPct}% of orders in the last 90 days shipped within 2 days.`, goal: 'How often and where do I ship?' });
  }
  const msgs = run('messages.unanswered', { hours: mem('message.hours', 24) });
  if (msgs.total) add({ id: 'messages', score: 90, title: `Answer ${msgs.total} buyer message${msgs.total > 1 ? 's' : ''}`, why: `${msgs.total} messages have waited more than ${mem('message.hours', 24)} hours without a reply.`, goal: 'Draft a reply to the oldest unanswered message' });
  const deals = run('deals.find', { minDiscountPct: 35, limit: 1 });
  if (deals.total) add({ id: 'deal', score: 30, title: `Supply deal: ${deals.deals[0].title}`, why: `${deals.deals[0].discountPct}% off (${'$' + (deals.deals[0].priceCents / 100).toFixed(2)}) at an allow-listed shop. Check the shop before buying.`, goal: `Find deals on ${deals.deals[0].category}` });
  if (memory && memory.get('restock.threshold') === undefined) add({ id: 'tell-me', score: 15, title: 'Tell me your restock level', why: 'I am using 2 as "running low". Tell me your real number and I will remember it.', goal: null });

  out.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  return { weekEnding: now, suggestions: out.slice(0, limit).map((s, i) => ({ rank: i + 1, ...s })) };
}
