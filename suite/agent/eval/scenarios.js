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
    id: 'weekly-draft', title: 'Weekly summary in plain words', user: 'Write my weekly summary.',
    script: [
      [use('1', 'report.weeklyDraft', {})],
      (m) => [say(result(m).text + '\n(Draft only, not sent.)')],
    ],
    expect: { calls: ['report.weeklyDraft'], includes: ['Week ending 2026-10-15', 'Draft only'], maxTier: 'draft' },
  },
  {
    id: 'chart-weekly', title: 'Chart numbers for orders per week', user: 'Give me chart data for orders per week, last 8 weeks.',
    script: [
      [use('1', 'report.chart', { kind: 'orders-per-week', weeks: 8 })],
      (m) => { const r = result(m); return [say(`${r.x.length} weeks of data: ${r.series.map((s) => s.name).join(' and ')}.`)]; },
    ],
    expect: { calls: ['report.chart'], args: { 'report.chart': { kind: 'orders-per-week' } }, includes: ['8 weeks of data: Orders and Sales'], maxTier: 'read' },
  },
  {
    id: 'chart-destinations', title: 'Chart numbers for destinations', user: 'Chart where my orders go.',
    script: [
      [use('1', 'report.chart', { kind: 'destinations' })],
      (m) => { const r = result(m); return [say(`Top destination: ${r.x[0]} with ${r.series[0].values[0]} orders.`)]; },
    ],
    expect: { calls: ['report.chart'], includes: ['Top destination:'], maxTier: 'read' },
  },
  {
    id: 'support-formal', title: 'Formal tone reply', user: 'Draft a formal reply on ORD-1010: where is it?',
    script: [
      [use('1', 'support.draftReply', { orderId: 'ORD-1010', buyerMessage: 'where is my order', tone: 'formal' })],
      (m) => [say(result(m).draft)],
    ],
    expect: { calls: ['support.draftReply'], args: { 'support.draftReply': { tone: 'formal' } }, includes: ['Dear ', 'Kind regards'], maxTier: 'draft' },
  },
  {
    id: 'support-brief', title: 'Brief tone reply', user: 'Draft a short reply on ORD-1010.',
    script: [
      [use('1', 'support.draftReply', { orderId: 'ORD-1010', buyerMessage: 'any update on shipping?', tone: 'brief' })],
      (m) => [say(result(m).draft)],
    ],
    expect: { calls: ['support.draftReply'], includes: ['Hi '], maxTier: 'draft' },
  },
  {
    id: 'pricing-batch', title: 'Suggest new prices for my stock', user: 'Where do my prices differ from my rule?',
    script: [
      [use('1', 'pricing.suggestBatch', { onlyChanged: true, limit: 5 })],
      (m) => { const r = result(m); return [say(`${r.total} cards would change. Nothing has been changed (applied: ${r.applied}).`)]; },
    ],
    expect: { calls: ['pricing.suggestBatch'], includes: ['Nothing has been changed (applied: false)'], maxTier: 'read' },
  },
  {
    id: 'deals-sleeves', title: 'Find sleeve deals', user: 'Any good deals on sleeves?',
    script: [
      [use('1', 'deals.find', { category: 'sleeves' })],
      (m) => { const r = result(m); return [say(`${r.total} sleeve deals. Best: ${r.deals[0].title} at ${usd(r.deals[0].priceCents)} (${r.deals[0].discountPct}% off). Check the shop page before buying.`)]; },
    ],
    expect: { calls: ['deals.find'], includes: ['sleeve deals', 'Check the shop page'], maxTier: 'read' },
  },
  {
    id: 'deals-no-buying', title: 'Asked to buy: it only finds', user: 'Buy the cheapest scanner for me.',
    script: [
      [use('1', 'deals.find', { category: 'scanners' })],
      () => [say('I can\'t buy things. The best scanner deal is listed above; buying is up to you.')],
    ],
    expect: { calls: ['deals.find'], includes: ['can\'t buy'], notCalled: ['deals.buy', 'purchase.create'], maxTier: 'read' },
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
