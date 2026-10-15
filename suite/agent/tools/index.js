// First tools. Read and draft tiers only: nothing here sends a message, changes a listing or spends money.
import { DEFAULT_RULE, applyPriceRule } from '../../scan/core/pricing.js';
import { CONDITIONS, FINISHES } from '../../shared/models.js';
import * as A from '../analytics.js';
import { importInventoryCsv, diffInventory, exportInventoryCsv, TARGETS } from '../sync/csv.js';
import { draftReply, TONES } from '../support.js';
import { CHART_KINDS, chartSeries, weeklyText, weekly } from '../analytics.js';
import { findDeals, defaultFeed, CATEGORIES as DEAL_CATEGORIES, ALLOWED_SOURCES } from '../deals.js';
import { validatePriceRule } from '../../shared/models.js';
import { weeklySuggestions } from '../suggestions.js';
import { createActTools } from './acts.js';

const str = { type: 'string' };
const int = { type: 'integer', minimum: 0 };

// data: { orders, inventory, printings, rules?, now }
export function createTools(data) {
  const { orders, inventory, printings, rules = [DEFAULT_RULE], now, dealFeed = defaultFeed, messages = [], memory, automations } = data;
  const nowIso = () => (typeof now === 'function' ? now() : now);
  const printingById = new Map(printings.map((p) => [p.id, p]));
  const cap = (n, d = 20) => Math.min(n ?? d, 100);

  const tools = [
    {
      name: 'orders.search', tier: 'read',
      description: 'Find orders by buyer key, ship-to state, status, date range or item text. Never returns names or street addresses.',
      inputSchema: { type: 'object', properties: { buyerKey: str, state: str, status: str, text: str, since: str, until: str, limit: { type: 'integer', minimum: 1, maximum: 100 } } },
      handler: (a) => {
        let list = A.inRange(orders, a.since, a.until);
        if (a.buyerKey) list = list.filter((o) => o.buyerKey === a.buyerKey);
        if (a.state) list = list.filter((o) => o.shipTo.state.toLowerCase() === a.state.toLowerCase());
        if (a.status) list = list.filter((o) => o.status === a.status);
        if (a.text) list = list.filter((o) => o.items.some((i) => i.name.toLowerCase().includes(a.text.toLowerCase())));
        list = [...list].reverse();
        return { total: list.length, orders: list.slice(0, cap(a.limit)).map(A.summarizeOrder) };
      },
    },
    {
      name: 'orders.stats', tier: 'read',
      description: 'Order statistics for a date range: totals, repeat buyers, shipping cadence and destinations by state.',
      inputSchema: { type: 'object', properties: { since: str, until: str } },
      handler: (a) => {
        const list = A.inRange(orders, a.since, a.until);
        return {
          orders: list.length,
          revenueCents: list.reduce((s, o) => s + o.itemsTotalCents, 0),
          repeat: A.repeatBuyers(list),
          cadence: A.cadence(list),
          destinations: A.destinations(list).slice(0, 10),
        };
      },
    },
    {
      name: 'report.repeatCustomers', tier: 'read',
      description: 'Repeat-customer report: who orders again, how often, how much they spend. Buyer keys only.',
      inputSchema: { type: 'object', properties: { minOrders: { type: 'integer', minimum: 2 }, since: str, until: str } },
      handler: (a) => A.repeatBuyers(A.inRange(orders, a.since, a.until), { minOrders: a.minOrders }),
    },
    {
      name: 'report.shipping', tier: 'read',
      description: 'Shipping cadence (orders per week, busiest weekday, days to ship) and destinations by state.',
      inputSchema: { type: 'object', properties: { since: str, until: str } },
      handler: (a) => {
        const list = A.inRange(orders, a.since, a.until);
        return { cadence: A.cadence(list), destinations: A.destinations(list) };
      },
    },
    {
      name: 'report.weekly', tier: 'read',
      description: 'Weekly summary for the 7 days before weekEnding (default: now): orders, revenue vs last week, top items, new vs returning buyers, orders waiting to ship.',
      inputSchema: { type: 'object', properties: { weekEnding: str } },
      handler: (a) => A.weekly(orders, { weekEnding: a.weekEnding || nowIso() }),
    },
    {
      name: 'inventory.search', tier: 'read',
      description: 'Search the seller\'s inventory by card name, game, and stock level.',
      inputSchema: { type: 'object', properties: { text: str, game: str, maxQuantity: int, minQuantity: int, limit: { type: 'integer', minimum: 1, maximum: 100 } } },
      handler: (a) => {
        let list = inventory.map((i) => ({ i, p: printingById.get(i.printingId) })).filter((x) => x.p);
        if (a.text) list = list.filter((x) => (x.p.name + ' ' + (x.p.setName || '') + ' ' + x.p.setCode).toLowerCase().includes(a.text.toLowerCase()));
        if (a.game) list = list.filter((x) => x.p.game === a.game);
        if (a.maxQuantity !== undefined) list = list.filter((x) => x.i.quantity <= a.maxQuantity);
        if (a.minQuantity !== undefined) list = list.filter((x) => x.i.quantity >= a.minQuantity);
        return { total: list.length, items: list.slice(0, cap(a.limit)).map(({ i, p }) => ({ printingId: i.printingId, name: p.name, setCode: p.setCode, condition: i.condition, finish: i.finish, quantity: i.quantity, priceCents: i.priceCents, location: i.location })) };
      },
    },
    {
      name: 'inventory.restock', tier: 'draft',
      description: 'Draft a restock list: cards that are low or out of stock and have sold recently, most-needed first.',
      inputSchema: { type: 'object', properties: { threshold: int, windowDays: { type: 'integer', minimum: 7, maximum: 365 } } },
      handler: (a) => {
        const windowDays = a.windowDays ?? 60, threshold = a.threshold ?? 2;
        const end = Date.parse(nowIso());
        const sold = A.unitsSold(A.inRange(orders, new Date(end - windowDays * 86400000).toISOString(), new Date(end + 1).toISOString()));
        const stock = new Map();
        for (const i of inventory) { const p = printingById.get(i.printingId); if (p) stock.set(p.name, (stock.get(p.name) || 0) + i.quantity); }
        const list = [];
        for (const [name, qty] of stock) {
          const units = sold.get(name) || 0;
          if (units === 0 || qty > threshold) continue;
          const per30 = (units / windowDays) * 30;
          list.push({ name, inStock: qty, soldInWindow: units, soldPer30Days: Math.round(per30 * 10) / 10, suggestedBuyQty: Math.max(1, Math.ceil(per30) - qty) });
        }
        list.sort((x, y) => y.soldPer30Days - x.soldPer30Days || x.name.localeCompare(y.name));
        return { windowDays, threshold, items: list };
      },
    },
    {
      name: 'pricing.suggest', tier: 'read',
      description: 'Suggest a price for one card using a price rule (default: 5% below market). Says so when no price is known; never guesses.',
      inputSchema: { type: 'object', required: ['printingId'], properties: { printingId: str, condition: { type: 'string', enum: CONDITIONS }, finish: { type: 'string', enum: FINISHES }, ruleId: str } },
      handler: (a) => {
        const p = printingById.get(a.printingId);
        if (!p) throw new Error('unknown card ' + a.printingId);
        const rule = a.ruleId ? rules.find((r) => r.id === a.ruleId) : rules[0];
        if (!rule) throw new Error('unknown price rule ' + a.ruleId);
        const finish = a.finish || p.finishes[0];
        return { name: p.name, ruleId: rule.id, condition: a.condition || 'NM', finish, ...applyPriceRule(rule, p, { condition: a.condition || 'NM', finish }) };
      },
    },
    {
      name: 'support.draftReply', tier: 'draft',
      description: 'Draft (never send) a reply to a buyer message, using the order for context. Returns text for the seller to review.',
      inputSchema: { type: 'object', required: ['orderId', 'buyerMessage'], properties: { orderId: str, buyerMessage: str, sellerName: str, tone: { type: 'string', enum: TONES } } },
      handler: (a) => {
        const order = orders.find((o) => o.id === a.orderId);
        if (!order) throw new Error('unknown order ' + a.orderId);
        return draftReply(order, a.buyerMessage, { sellerName: a.sellerName, now: nowIso(), tone: a.tone });
      },
    },
    {
      name: 'report.chart', tier: 'read',
      description: 'Chart-ready numbers (labels and series, no drawing): ' + CHART_KINDS.join(', ') + '.',
      inputSchema: { type: 'object', required: ['kind'], properties: { kind: { type: 'string', enum: CHART_KINDS }, weeks: { type: 'integer', minimum: 2, maximum: 52 } } },
      handler: (a) => chartSeries(orders, a.kind, { now: nowIso(), weeks: a.weeks }),
    },
    {
      name: 'report.weeklyDraft', tier: 'draft',
      description: 'A weekly summary written out in plain words, ready to read or paste. Nothing is sent.',
      inputSchema: { type: 'object', properties: { weekEnding: str } },
      handler: (a) => ({ text: weeklyText(weekly(orders, { weekEnding: a.weekEnding || nowIso() })), sent: false }),
    },
    {
      name: 'pricing.rules', tier: 'read',
      description: 'List the price rules the seller has saved.',
      inputSchema: { type: 'object', properties: {} },
      handler: () => ({ rules }),
    },
    {
      name: 'pricing.suggestBatch', tier: 'read',
      description: 'Suggest prices for many inventory cards at once with a price rule, showing the change from the current price. Only suggests; changes no listing.',
      inputSchema: { type: 'object', properties: { ruleId: str, rule: { type: 'object' }, finish: { type: 'string', enum: FINISHES }, onlyChanged: { type: 'boolean' }, limit: { type: 'integer', minimum: 1, maximum: 100 } } },
      handler: (a) => {
        let rule = a.ruleId ? rules.find((r) => r.id === a.ruleId) : rules[0];
        if (a.rule) {
          const v = validatePriceRule(a.rule);
          if (!v.ok) throw new Error('bad rule: ' + v.errors.join('; '));
          rule = a.rule;
        }
        if (!rule) throw new Error('unknown price rule ' + a.ruleId);
        const rows = [];
        let missing = 0, skipped = 0;
        for (const i of inventory) {
          const p = printingById.get(i.printingId);
          if (!p || i.quantity <= 0 || (a.finish && i.finish !== a.finish)) continue;
          const r = applyPriceRule(rule, p, { condition: i.condition, finish: i.finish });
          if (r.status === 'missing') { missing += 1; continue; }
          if (r.status === 'skip') { skipped += 1; continue; }
          const change = i.priceCents === undefined ? null : r.priceCents - i.priceCents;
          if (a.onlyChanged && change === 0) continue;
          rows.push({ printingId: i.printingId, name: p.name, condition: i.condition, finish: i.finish, quantity: i.quantity, currentCents: i.priceCents, suggestedCents: r.priceCents, changeCents: change });
        }
        rows.sort((x, y) => Math.abs(y.changeCents ?? 0) - Math.abs(x.changeCents ?? 0) || x.name.localeCompare(y.name));
        return { ruleId: rule.id, total: rows.length, rows: rows.slice(0, cap(a.limit)), noPriceKnown: missing, belowMinimum: skipped, applied: false };
      },
    },
    {
      name: 'deals.find', tier: 'read',
      description: 'Find supply deals (sleeves, toploaders, boxes, shelving, monitors, scanners) in the allow-listed sources. Reads a saved feed; never browses, never buys.',
      inputSchema: { type: 'object', properties: { category: { type: 'string', enum: DEAL_CATEGORIES }, maxPriceCents: int, minDiscountPct: { type: 'number', minimum: 0, maximum: 100 }, limit: { type: 'integer', minimum: 1, maximum: 50 } } },
      handler: (a) => ({ ...findDeals(dealFeed(), a), allowedSources: ALLOWED_SOURCES.map((s) => s.name) }),
    },
    {
      name: 'messages.unanswered', tier: 'read',
      description: 'Buyer messages that have no reply yet and are older than a number of hours (default 24).',
      inputSchema: { type: 'object', properties: { hours: { type: 'integer', minimum: 0, maximum: 720 } } },
      handler: (a) => {
        const hours = a.hours ?? 24;
        const list = messages.filter((m) => !m.answered && Date.parse(nowIso()) - Date.parse(m.receivedAt) > hours * 3600000).sort((x, y) => x.receivedAt.localeCompare(y.receivedAt));
        return { total: list.length, messages: list.map((m) => ({ id: m.id, orderId: m.orderId, receivedAt: m.receivedAt, text: m.text })) };
      },
    },
    {
      name: 'sync.previewImport', tier: 'read',
      description: 'Read pasted inventory CSV text (a marketplace export) and show what was understood and what was not. Changes nothing.',
      inputSchema: { type: 'object', required: ['csv'], properties: { csv: str } },
      handler: (a) => {
        const r = importInventoryCsv(a.csv, printings);
        return { understood: r.items.length, unitsTotal: r.items.reduce((s, i) => s + i.quantity, 0), unmatched: r.unmatched, problems: r.problems };
      },
    },
    {
      name: 'sync.compare', tier: 'read',
      description: 'Compare pasted marketplace inventory CSV text with the inventory we hold: missing, extra, quantity and price differences.',
      inputSchema: { type: 'object', required: ['csv'], properties: { csv: str } },
      handler: (a) => {
        const r = importInventoryCsv(a.csv, printings);
        if (r.problems.length) return { problems: r.problems };
        return { ...diffInventory(inventory, r.items), unmatchedRows: r.unmatched.length };
      },
    },
    {
      name: 'sync.draftExport', tier: 'draft',
      description: 'Draft an upload CSV of the current inventory for ebay, whatnot or manapool. Column layout is unverified. Nothing is uploaded.',
      inputSchema: { type: 'object', required: ['target'], properties: { target: { type: 'string', enum: Object.keys(TARGETS) } } },
      handler: (a) => exportInventoryCsv(a.target, inventory, printings),
    },
  ];
  const run = (name, args) => tools.find((t) => t.name === name).handler(args || {});
  tools.push({
    name: 'suggestions.weekly', tier: 'read',
    description: 'Up to five things worth doing this week, from orders and stock, each with the numbers behind it and a goal to start.',
    inputSchema: { type: 'object', properties: { limit: { type: 'integer', minimum: 1, maximum: 10 } } },
    handler: (a) => weeklySuggestions({ run, now: nowIso(), memory, limit: a.limit }),
  });
  if (memory) tools.push(...createActTools({ inventory, printings, memory, automations }));
  return tools;
}

export function registerAll(registry, data) {
  for (const t of createTools(data)) registry.register(t);
  return registry;
}
