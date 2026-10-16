// Morning briefing: plain text, under 150 words, built only from the seller's data. No model, so the same data always
// gives the same text. Four parts: what to ship today, five things worth doing, low stock, what is waiting for you.
export const MAX_WORDS = 150;
const DAY = 86400000;
const words = (t) => t.split(/\s+/).filter(Boolean).length;
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;
const clip = (s, n) => (s.split(/\s+/).length > n ? s.split(/\s+/).slice(0, n).join(' ') + '…' : s);

// run(name, args) must return the tool's result (the same tools the Agent already has).
export function morningBriefing({ run, now, pendingApprovals = 0 }) {
  const d = new Date(now);
  const paid = run('orders.search', { status: 'paid', limit: 100 });
  const sug = run('suggestions.weekly', {});
  const restock = run('inventory.restock', {});
  const msgs = run('messages.unanswered', {});

  const oldest = paid.orders.length ? Math.max(...paid.orders.map((o) => Math.floor((Date.parse(now) - Date.parse(o.orderedAt)) / DAY))) : 0;
  const ship = paid.total ? `Ship today: ${plural(paid.total, 'order')}` + (oldest >= 1 ? `, the oldest ${plural(oldest, 'day')} old.` : '.') : 'Ship today: nothing is waiting.';
  const things = sug.suggestions.map((s, i) => `${i + 1}. ${clip(s.title, 7)}`);
  const lowNames = restock.items.slice(0, 3).map((i) => clip(i.name, 3));
  const low = restock.items.length ? `Low stock: ${plural(restock.items.length, 'card')} selling and nearly gone` + (lowNames.length ? ` (${lowNames.join(', ')}).` : '.') : 'Low stock: nothing selling is running out.';
  const waiting = [];
  if (pendingApprovals) waiting.push(plural(pendingApprovals, 'approval'));
  if (msgs.total) waiting.push(plural(msgs.total, 'buyer message') + ' without a reply');
  const wait = waiting.length ? `Waiting for you: ${waiting.join(', ')}.` : 'Waiting for you: nothing.';

  const parts = {
    head: `Good morning. ${WEEKDAYS[d.getUTCDay()]} ${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}.`,
    ship, thingsHead: things.length ? 'Worth doing:' : 'Worth doing: nothing stands out.', things, low, wait,
  };
  const build = () => [parts.head, parts.ship, parts.thingsHead, ...parts.things, parts.low, parts.wait].join('\n');
  // keep it under the limit: shorten names, then trim the list, never cut a sentence in half
  let text = build();
  if (words(text) > MAX_WORDS) { parts.low = low.replace(/ \(.*\)\./, '.'); text = build(); }
  while (words(text) > MAX_WORDS && parts.things.length > 3) { parts.things.pop(); text = build(); }
  if (words(text) > MAX_WORDS) { parts.things = parts.things.map((t) => clip(t, 4)); text = build(); }
  return { text, words: words(text), parts: { shipOrders: paid.total, thingsWorthDoing: parts.things.length, lowStockCards: restock.items.length, approvalsWaiting: pendingApprovals, messagesWaiting: msgs.total } };
}
