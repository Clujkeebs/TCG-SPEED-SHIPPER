// Turns a goal in plain words into a plan. Two planners:
//   rulePlanner  works offline from a few known recipes, and says so honestly when it has none
//   modelPlanner asks a model (real or scripted) to call `submit_plan`; the plan is validated the same way
// Memory facts shape the plan (for example the restock threshold or the price rounding the seller chose).
import { validatePlan } from './plan.js';

const PRICE_AGAINST = /(\d+(?:\.\d+)?)\s*%\s*(?:under|below|less than|off)\s*(market|low|mid)/i;
const CATEGORY_WORDS = { sleeves: 'sleeves', toploader: 'toploaders', 'top loader': 'toploaders', box: 'boxes', shelv: 'shelving', monitor: 'monitors', scanner: 'scanners' };

export function createRulePlanner({ registry, memory, now }) {
  const mem = (key, fallback) => { const v = memory ? memory.get(key) : undefined; return v === undefined ? fallback : v; };

  function build(goal, steps, notes = []) {
    const plan = { id: 'plan-' + Math.abs([...goal].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7)).toString(36) + '-' + Date.parse(now()).toString(36), goal, createdAt: now(), source: 'rules', notes, steps: steps.map((s, i) => ({ id: 's' + (i + 1), ...s })) };
    return plan;
  }

  return {
    plan(goal) {
      const g = String(goal || '').trim();
      if (!g) return { plan: null, reason: 'Tell me what you want done.' };
      const low = g.toLowerCase();

      const price = PRICE_AGAINST.exec(g);
      if (/\b(reprice|re-price|change my prices|adjust (my )?prices|price my)\b/.test(low) || (price && /price|reprice/.test(low))) {
        const percent = price ? Number(price[1]) : mem('price.percent', undefined);
        const basis = price ? price[2].toLowerCase() : 'market';
        if (percent === undefined) return { plan: null, needs: 'percent', reason: 'How far under market should I price? For example "reprice my foils 5% under market". I can remember your answer.' };
        const finish = /\bfoils?\b/.test(low) ? 'foil' : undefined;
        const rule = { id: 'goal-rule', name: `${percent}% under ${basis}`, basis, percent: -Math.abs(percent), floorCents: mem('price.floorCents', 25), minListCents: mem('price.minListCents', 25), rounding: mem('price.rounding', 'ends-99') };
        return { plan: build(g, [
          { tool: 'pricing.suggestBatch', args: { rule, onlyChanged: true, limit: 100, ...(finish ? { finish } : {}) }, why: `Work out new prices${finish ? ' for foils' : ''}: ${percent}% under ${basis}, nothing below ${'$' + (rule.floorCents / 100).toFixed(2)}`, check: { path: 'rows', nonEmpty: true, message: 'No prices would change under that rule, so there is nothing to do.' } },
          { tool: 'inventory.setPrices', args: { changes: { $map: { from: 's1.rows', pick: { printingId: 'printingId', condition: 'condition', finish: 'finish', priceCents: 'suggestedCents' } } } }, why: 'Save the new prices in your stock list (you upload them yourself afterwards)' },
        ]) };
      }
      if (/\b(restock|low stock|running low|out of stock|reorder)\b/.test(low)) {
        const threshold = mem('restock.threshold', 2);
        return { plan: build(g, [
          { tool: 'inventory.restock', args: { threshold, windowDays: 60 }, why: `Find cards with ${threshold} or fewer left that sold in the last 60 days`, check: { path: 'items', nonEmpty: true, message: 'Nothing is low and selling right now.' } },
        ]) };
      }
      if (/\brepeat (buyers|customers)\b|\bregulars?\b|\bbest (buyers|customers)\b/.test(low)) {
        return { plan: build(g, [
          { tool: 'report.repeatCustomers', args: { minOrders: 2 }, why: 'List buyers who ordered more than once', check: { path: 'repeatBuyers', gt: 0, message: 'No buyer has ordered twice yet.' } },
          { tool: 'report.chart', args: { kind: 'buyer-mix' }, why: 'Prepare chart numbers: one-time vs repeat buyers' },
        ]) };
      }
      if (/\b(waiting to ship|unshipped|not shipped|late orders?)\b/.test(low)) {
        return { plan: build(g, [{ tool: 'orders.search', args: { status: 'paid', limit: 20 }, why: 'List paid orders that have not shipped', check: { path: 'total', gt: 0, message: 'Nothing is waiting to ship.' } }]) };
      }
      if (/\b(ship(ping)?|destinations?|where do (i|my)|cadence)\b/.test(low)) {
        return { plan: build(g, [
          { tool: 'report.shipping', args: {}, why: 'Work out how often and where you ship' },
          { tool: 'report.chart', args: { kind: 'destinations' }, why: 'Prepare chart numbers by state' },
        ]) };
      }
      if (/\b(weekly|week'?s?) (summary|report)\b|\bsummary\b/.test(low)) {
        return { plan: build(g, [{ tool: 'report.weeklyDraft', args: {}, why: 'Write the weekly summary from your orders' }]) };
      }
      if (/\b(deals?|cheap|closeouts?|supplies)\b/.test(low) || Object.keys(CATEGORY_WORDS).some((w) => low.includes(w))) {
        const word = Object.keys(CATEGORY_WORDS).find((w) => low.includes(w));
        return { plan: build(g, [{ tool: 'deals.find', args: { ...(word ? { category: CATEGORY_WORDS[word] } : {}), limit: 5 }, why: `Look for supply deals${word ? ' on ' + CATEGORY_WORDS[word] : ''} in the allow-listed shops`, check: { path: 'total', gt: 0, message: 'No deals in the allow-listed shops right now.' } }]) };
      }
      return { plan: null, reason: 'I do not have a plan for that yet. I can: reprice cards a set % under market, restock low cards, report repeat buyers, shipping and destinations, list orders waiting to ship, write the weekly summary, or find supply deals.' };
    },
  };
}

// The model gets one extra tool, submit_plan, and the plan it submits is validated like any other.
export function createModelPlanner({ model, registry, now }) {
  return {
    async plan(goal, memoryFacts = []) {
      const tools = [...registry.specs(), { name: 'submit_plan', description: 'Submit a short plan (at most 8 steps). Each step: tool, args, why, optional check.', input_schema: { type: 'object', properties: { steps: { type: 'array' } }, required: ['steps'] } }];
      const facts = memoryFacts.length ? '\nShop facts:\n' + memoryFacts.map((f) => '- ' + f.text).join('\n') : '';
      const reply = await model.complete([{ role: 'user', content: 'Goal: ' + goal + facts }], tools, 'Write a plan with submit_plan. Use only the listed tools. Do not act without a step that needs approval.');
      const use = (reply.content || []).find((b) => b.type === 'tool_use' && b.name === 'submit_plan');
      if (!use) return { plan: null, reason: 'The model did not return a plan.' };
      const plan = { id: 'plan-m-' + Date.parse(now()).toString(36), goal, createdAt: now(), source: 'model', steps: (use.input.steps || []).map((s, i) => ({ id: 's' + (i + 1), ...s })) };
      const v = validatePlan(plan, registry);
      return v.ok ? { plan } : { plan: null, reason: 'The plan was not valid: ' + v.errors.join('; ') };
    },
  };
}
