// A stand-in "model" for practice mode: no network, no key, no cost. It picks tools from keywords in
// what the seller typed and then writes one plain sentence from the result. The REAL engine (planning
// loop, tool registry, approvals, audit, limits) runs around it unchanged; only the thinking is faked.
export const ROUTES = [
  { id: 'repeat', test: /repeat|loyal|regular/i, tool: 'report.repeatCustomers', input: {}, plan: ['Look at who orders more than once', 'Summarise it for you'] },
  { id: 'restock', test: /restock|low stock|stock|reorder/i, tool: 'inventory.restock', input: {}, plan: ['Check what is low or sold out', 'Work out how many to buy', 'Draft a restock list for you'] },
  { id: 'price', test: /price|reprice|cheaper|lower/i, tool: 'listing.setPrice', input: { printingId: 'mtg:practice:p2', newPriceCents: 70 }, plan: ['Look at the current price', 'Work out a new price', 'Ask you before changing anything'] },
  { id: 'stats', test: /./, tool: 'orders.stats', input: {}, plan: ['Look at your recent orders', 'Summarise it for you'] }
];

export const routeFor = (text) => ROUTES.find((r) => r.test.test(String(text)));

const sayFor = (tool, out) => {
  if (!out || out.error) return /not approve|did not/.test(String(out && out.error)) ? 'Okay, I did not change anything.' : 'I could not do that: ' + (out && out.error ? out.error : 'unknown problem') + '.';
  switch (tool) {
    case 'orders.stats': return `Practice answer: ${out.orders} orders in the made-up shop, ${out.repeat.repeatBuyers} of ${out.repeat.buyers} buyers ordered more than once.`;
    case 'report.repeatCustomers': return `Practice answer: ${out.repeatBuyers} repeat buyers out of ${out.buyers}. The top one, ${out.top[0].buyerKey}, ordered ${out.top[0].orders} times.`;
    case 'inventory.restock': return out.items.length ? `Practice answer: ${out.items.length} cards are low or sold out. Most urgent: ${out.items[0].name} (buy about ${out.items[0].suggestedBuyQty}).` : 'Practice answer: nothing is low right now.';
    case 'listing.setPrice': return `Done, in practice data only: ${out.name} is now $${(out.newPriceCents / 100).toFixed(2)} (was $${(out.oldPriceCents / 100).toFixed(2)}).`;
    default: return 'Done.';
  }
};

export function createPracticeModel() {
  return {
    async complete(messages) {
      const last = messages[messages.length - 1];
      if (typeof last.content === 'string') {
        const route = routeFor(last.content);
        return { content: [{ type: 'tool_use', id: 'tu-1', name: route.tool, input: route.input }] };
      }
      const prev = messages[messages.length - 2];
      const tool = prev.content.find((b) => b.type === 'tool_use')?.name;
      let out;
      try { out = JSON.parse(last.content[0].content); } catch { out = { error: 'unreadable result' }; }
      return { content: [{ type: 'text', text: sayFor(tool, out) }] };
    }
  };
}
