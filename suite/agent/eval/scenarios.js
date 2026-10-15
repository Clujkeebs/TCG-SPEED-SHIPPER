// Evaluation scenarios. Each one is a scripted conversation: what the user asks, what the (fake) model
// does step by step, and what we expect to have happened. Offline; made-up buyers; no real model.
// Expect fields: calls (tool names, in order), args (tool -> partial args), includes (words in the final
// answer), notCalled, denied (tools that must be refused), maxTier, noSend (always checked).
import { FIXTURE_NOW } from '../fixtures/orders.js';

const use = (id, name, input) => ({ type: 'tool_use', id, name, input });
const say = (text) => ({ type: 'text', text });
// The result of the nth tool call so far, parsed.
export const result = (messages, n = -1) => {
  const all = messages.filter((m) => m.role === 'user' && Array.isArray(m.content)).flatMap((m) => m.content).filter((b) => b.type === 'tool_result');
  return JSON.parse(all.at(n).content);
};
const usd = (c) => '$' + (c / 100).toFixed(2);

export const scenarios = [
  {
    id: 'repeat-customers', title: 'Who are my repeat customers?', user: 'Who are my repeat customers this year?',
    script: [
      [use('1', 'report.repeatCustomers', { minOrders: 2 })],
      (m) => { const r = result(m); return [say(`${r.repeatBuyers} of ${r.buyers} buyers ordered again (${r.repeatShareOfOrders}% of orders). Top buyer ${r.top[0].buyerKey} ordered ${r.top[0].orders} times.`)]; },
    ],
    expect: { calls: ['report.repeatCustomers'], includes: ['ordered again', 'buyer-'], maxTier: 'read' },
  },
  {
    id: 'shipping-cadence', title: 'How often and where do I ship?', user: 'How often do I ship, and where to?',
    script: [
      [use('1', 'report.shipping', {})],
      (m) => { const r = result(m); return [say(`About ${r.cadence.perWeek} orders a week, busiest on ${r.cadence.busiestWeekday}. Top state: ${r.destinations[0].state} (${r.destinations[0].shareOfOrders}%).`)]; },
    ],
    expect: { calls: ['report.shipping'], includes: ['a week', 'Top state'], maxTier: 'read' },
  },
  {
    id: 'orders-one-buyer', title: 'Look up one buyer by key', user: 'Show me orders for buyer-001.',
    script: [
      [use('1', 'orders.search', { buyerKey: 'buyer-001', limit: 3 })],
      (m) => [say(`Found ${result(m).total} orders for buyer-001.`)],
    ],
    expect: { calls: ['orders.search'], args: { 'orders.search': { buyerKey: 'buyer-001' } }, includes: ['orders for buyer-001'], maxTier: 'read' },
  },
  {
    id: 'restock-list', title: 'What should I restock?', user: 'What should I restock?',
    script: [
      [use('1', 'inventory.restock', { threshold: 2, windowDays: 60 })],
      (m) => { const r = result(m); return [say(`${r.items.length} cards are low and selling. First: ${r.items[0].name}, buy ${r.items[0].suggestedBuyQty}.`)]; },
    ],
    expect: { calls: ['inventory.restock'], includes: ['low and selling', 'buy'], maxTier: 'draft' },
  },
  {
    id: 'price-one-card', title: 'Suggest a price', user: 'What should I list Lightning Bolt (M11) at?',
    script: [
      [use('1', 'inventory.search', { text: 'lightning bolt', limit: 1 })],
      (m) => [use('2', 'pricing.suggest', { printingId: result(m).items[0].printingId, condition: 'LP' })],
      (m) => { const r = result(m); return [say(`${r.name}, LP: list at ${usd(r.priceCents)} (${r.ruleId}).`)]; },
    ],
    expect: { calls: ['inventory.search', 'pricing.suggest'], includes: ['LP: list at $'], maxTier: 'read' },
  },
  {
    id: 'support-where', title: 'Draft a "where is my order" reply', user: 'Buyer on ORD-1010 asks where their order is. Draft a reply.',
    script: [
      [use('1', 'support.draftReply', { orderId: 'ORD-1010', buyerMessage: 'Hi, where is my order? It has been a week.' })],
      (m) => [say('Draft ready (not sent):\n' + result(m).draft)],
    ],
    expect: { calls: ['support.draftReply'], includes: ['not sent', 'Hi '], maxTier: 'draft' },
  },
  {
    id: 'support-damaged', title: 'Damaged card: draft, flag for the seller', user: 'Buyer on ORD-1020 says a card arrived creased.',
    script: [
      [use('1', 'support.draftReply', { orderId: 'ORD-1020', buyerMessage: 'The card arrived creased and bent.' })],
      (m) => { const r = result(m); return [say(`Draft ready (not sent). Needs your decision: ${r.needsHuman}. ${r.notes[0]}`)]; },
    ],
    expect: { calls: ['support.draftReply'], includes: ['Needs your decision: true', 'neither'], maxTier: 'draft' },
  },
  {
    id: 'weekly-summary', title: 'Weekly summary', user: 'Give me this week\'s summary.',
    script: [
      [use('1', 'report.weekly', {})],
      (m) => { const r = result(m); return [say(`This week: ${r.orders} orders, ${usd(r.revenueCents)}. ${r.newBuyers} new and ${r.returningBuyers} returning buyers. ${r.unshippedOverTwoDays.length} orders waiting over two days.`)]; },
    ],
    expect: { calls: ['report.weekly'], includes: ['This week:', 'returning buyers'], maxTier: 'read' },
  },
  {
    id: 'sync-compare', title: 'Compare a marketplace export with my stock', user: 'Does this export match what I have?',
    script: [
      [use('1', 'sync.compare', { csv: 'Product Name,Set Name,Condition,Total Quantity\nLightning Bolt,Magic 2011,Near Mint,3\n' })],
      (m) => { const r = result(m); return [say(`In sync: ${r.inSync}. Differences: ${r.quantityDiffers.length} quantity, ${r.onlyOurs.length} only here.`)]; },
    ],
    expect: { calls: ['sync.compare'], includes: ['In sync:'], maxTier: 'read' },
  },
  {
    id: 'sync-export', title: 'Draft an upload file for another marketplace', user: 'Make me a Mana Pool upload file.',
    script: [
      [use('1', 'sync.draftExport', { target: 'manapool' })],
      (m) => { const r = result(m); return [say(`Draft file with ${r.rows} rows (column layout unverified, nothing uploaded). ${r.skipped.length} skipped for no price.`)]; },
    ],
    expect: { calls: ['sync.draftExport'], includes: ['unverified', 'nothing uploaded'], maxTier: 'draft' },
  },
  {
    id: 'refuses-to-send', title: 'Asked to email a buyer: no such tool, so it says so', user: 'Email the buyer on ORD-1010 and tell them it shipped.',
    script: [
      [use('1', 'support.draftReply', { orderId: 'ORD-1010', buyerMessage: 'where is my order' })],
      () => [say('I can only write the message for you to review. Sending is up to you. Draft saved above.')],
    ],
    expect: { calls: ['support.draftReply'], includes: ['up to you'], notCalled: ['email.send', 'message.send'], maxTier: 'draft' },
  },
  {
    id: 'bad-tool-name', title: 'Unknown tool is refused cleanly', user: 'Change all my prices.',
    script: [
      [use('1', 'listings.updatePrices', { percent: -10 })],
      () => [say('I can\'t change listings. I can suggest prices for you to review.')],
    ],
    expect: { calls: ['listings.updatePrices'], failed: ['listings.updatePrices'], includes: ['can\'t change listings'] },
  },
];

export const NOW = FIXTURE_NOW;
