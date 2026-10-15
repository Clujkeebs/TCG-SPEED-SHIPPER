// Event triggers for automations, on fixture data: low-stock, new-order, unanswered-message.
// detect() returns only events that are NEW since the last call:
//   new-order           orders placed after the last check
//   low-stock           a card at or under the restock threshold that sold in the last 60 days; fires once until it is restocked
//   unanswered-message  a buyer message with no reply after `message.hours` (default 24)
// Reads only. The data arrays are the live ones, so a new order pushed into `orders` shows up next call.
import { unitsSold, inRange } from './analytics.js';

export function createEventDetector({ orders, inventory, printings, messages = [], memory, now }) {
  const nameOf = new Map(printings.map((p) => [p.id, p.name]));
  const seenLow = new Set();
  const seenMsg = new Set();
  let watermark = now();
  const mem = (k, d) => { const v = memory ? memory.get(k) : undefined; return v === undefined ? d : v; };

  return {
    detect() {
      const at = now();
      const events = [];
      for (const o of orders) {
        if (o.orderedAt > watermark && o.orderedAt <= at) events.push({ type: 'new-order', key: 'order:' + o.id, detail: { orderId: o.id, itemsTotalCents: o.itemsTotalCents } });
      }
      watermark = at;

      const threshold = mem('restock.threshold', 2);
      const sold = unitsSold(inRange(orders, new Date(Date.parse(at) - 60 * 86400000).toISOString(), new Date(Date.parse(at) + 1).toISOString()));
      const low = new Set();
      for (const i of inventory) {
        const name = nameOf.get(i.printingId);
        if (!name || i.quantity > threshold || !sold.get(name)) continue;
        const key = 'low:' + [i.printingId, i.condition, i.finish].join('|');
        low.add(key);
        if (!seenLow.has(key)) { seenLow.add(key); events.push({ type: 'low-stock', key, detail: { name, finish: i.finish, quantity: i.quantity } }); }
      }
      for (const k of [...seenLow]) if (!low.has(k)) seenLow.delete(k); // restocked: may fire again later

      const hours = mem('message.hours', 24);
      for (const m of messages) {
        if (m.answered || seenMsg.has(m.id)) continue;
        if (Date.parse(at) - Date.parse(m.receivedAt) > hours * 3600000) { seenMsg.add(m.id); events.push({ type: 'unanswered-message', key: 'msg:' + m.id, detail: { messageId: m.id, orderId: m.orderId } }); }
      }
      return events;
    },
  };
}
