// Goals and plans. A plan is a short, visible list of steps; each step names a tool, its arguments, why it is
// there, and optionally a check on the result. Running a plan:
//   - read and draft steps run now, through the registry (limits, kill switch and audit apply)
//   - act steps become approval cards in the inbox and do NOT run
//   - a failed check or an error stops everything that depends on that step, and the report says so
// Arguments can use earlier results: "$s1.rows" (a path into step s1's result) or
// { $map: { from: "s1.rows", pick: { priceCents: "suggestedCents", printingId: "printingId" } } }.
import { validateArgs } from './registry.js';

export const MAX_STEPS = 8;

export function getPath(obj, path) {
  let cur = obj;
  for (const part of String(path).split('.')) {
    if (cur === null || cur === undefined) return undefined;
    cur = cur[part];
  }
  return cur;
}

const REF = /^\$(s\d+)(?:\.(.+))?$/;

function refsIn(value, out = new Set()) {
  if (typeof value === 'string') { const m = REF.exec(value); if (m) out.add(m[1]); }
  else if (Array.isArray(value)) value.forEach((v) => refsIn(v, out));
  else if (value && typeof value === 'object') {
    if (value.$map) out.add(String(value.$map.from).split('.')[0]);
    else Object.values(value).forEach((v) => refsIn(v, out));
  }
  return out;
}

export function resolveArgs(value, results) {
  if (typeof value === 'string') {
    const m = REF.exec(value);
    if (!m) return value;
    const r = results[m[1]];
    const v = m[2] ? getPath(r, m[2]) : r;
    if (v === undefined) throw new Error('step ' + m[1] + ' has no ' + (m[2] || 'result'));
    return v;
  }
  if (Array.isArray(value)) return value.map((v) => resolveArgs(v, results));
  if (value && typeof value === 'object') {
    if (value.$map) {
      const [id, ...rest] = String(value.$map.from).split('.');
      const list = rest.length ? getPath(results[id], rest.join('.')) : results[id];
      if (!Array.isArray(list)) throw new Error('step ' + id + ' has no list at ' + value.$map.from);
      return list.map((row) => Object.fromEntries(Object.entries(value.$map.pick).map(([k, p]) => [k, getPath(row, p)])));
    }
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, resolveArgs(v, results)]));
  }
  return value;
}

export function validatePlan(plan, registry) {
  const errors = [];
  if (!plan || typeof plan !== 'object') return { ok: false, errors: ['plan must be an object'] };
  if (typeof plan.goal !== 'string' || !plan.goal.trim()) errors.push('goal is required');
  if (!Array.isArray(plan.steps) || plan.steps.length === 0) errors.push('a plan needs at least one step');
  else if (plan.steps.length > MAX_STEPS) errors.push('a plan can have at most ' + MAX_STEPS + ' steps');
  const seen = new Set();
  for (const s of Array.isArray(plan.steps) ? plan.steps : []) {
    if (!s || typeof s.id !== 'string' || !/^s\d+$/.test(s.id)) { errors.push('step ids look like s1, s2'); continue; }
    if (seen.has(s.id)) errors.push('duplicate step ' + s.id);
    const tool = registry.get(s.tool);
    if (!tool) errors.push(s.id + ': unknown tool ' + s.tool);
    if (typeof s.why !== 'string' || !s.why.trim()) errors.push(s.id + ': say why');
    if (s.args !== undefined && (typeof s.args !== 'object' || Array.isArray(s.args))) errors.push(s.id + ': args must be an object');
    for (const dep of refsIn(s.args)) if (!seen.has(dep)) errors.push(s.id + ': uses ' + dep + ' which does not come earlier');
    if (tool && !refsIn(s.args).size) for (const e of validateArgs(tool.inputSchema, s.args || {})) errors.push(s.id + ': ' + e);
    seen.add(s.id);
  }
  return { ok: errors.length === 0, errors };
}

// Plain-words plan the seller reads before anything runs.
export function renderPlan(plan, registry) {
  const lines = [`Goal: ${plan.goal}`, 'Plan:'];
  plan.steps.forEach((s, i) => {
    const t = registry.get(s.tool);
    const how = !t ? 'unknown' : t.tier === 'act' ? 'needs your OK' : t.tier === 'draft' ? 'draft only' : 'just looks';
    lines.push(`${i + 1}. ${s.why} (${how})`);
  });
  return lines.join('\n');
}

function check(step, result) {
  const c = step.check;
  if (!c) return null;
  const v = c.path ? getPath(result, c.path) : result;
  if (c.nonEmpty && !(Array.isArray(v) ? v.length > 0 : v !== undefined && v !== null && v !== '')) return c.message || `step ${step.id} found nothing at ${c.path}`;
  if (c.gt !== undefined && !(typeof v === 'number' && v > c.gt)) return c.message || `step ${step.id}: ${c.path} is not more than ${c.gt}`;
  if (c.exists && v === undefined) return c.message || `step ${step.id}: ${c.path} is missing`;
  return null;
}

const FORMAT = {
  'report.repeatCustomers': (r) => `${r.repeatBuyers} of ${r.buyers} buyers ordered more than once (${r.repeatShareOfOrders}% of orders)`,
  'report.shipping': (r) => `about ${r.cadence.perWeek} orders a week, busiest on ${r.cadence.busiestWeekday}; top state ${r.destinations[0] ? r.destinations[0].state : 'none'}`,
  'report.weekly': (r) => `${r.orders} orders last week, $${(r.revenueCents / 100).toFixed(2)}`,
  'report.weeklyDraft': (r) => r.text.split('\n').slice(0, 2).join(' / '),
  'report.chart': (r) => `chart numbers ready: ${r.title}`,
  'inventory.restock': (r) => `${r.items.length} cards low and selling${r.items[0] ? '; first: ' + r.items[0].name : ''}`,
  'inventory.search': (r) => `${r.total} stock rows`,
  'orders.search': (r) => `${r.total} orders`,
  'pricing.suggestBatch': (r) => `${r.total} cards would change price (nothing changed yet)`,
  'deals.find': (r) => `${r.total} deals found`,
  'support.draftReply': (r) => `draft ready, not sent (${r.category})`,
  'briefing.morning': (r) => `briefing ready (${r.words} words)`,
  'orders.fileInsights': (r) => `${r.summary.orders} orders read from your file`,
  'suggestions.weekly': (r) => `${r.suggestions.length} things worth doing`,
};
// The text a seller can copy out of a finished draft step: { title, text, notes?, orderId?, truncated? }.
// It still holds placeholders ({{first_name}}, {{buyer:KEY}}); the device fills the names in just before showing it.
export const MAX_COPY_CHARS = 6000;
export function copyableOf(tool, result) {
  if (!result || typeof result !== 'object') return null;
  let c = null;
  if (tool === 'support.draftReply' && typeof result.message === 'string') {
    const notes = typeof result.draft === 'string' ? result.draft.slice(result.message.length).trim() : '';
    c = { title: 'Reply to the buyer (draft, not sent)', text: result.message, ...(notes ? { notes } : {}), orderId: result.orderId };
  } else if (tool === 'report.weeklyDraft' && typeof result.text === 'string') c = { title: 'Weekly summary (draft)', text: result.text };
  else if (tool === 'briefing.morning' && typeof result.text === 'string') c = { title: 'Morning briefing', text: result.text };
  else if (tool === 'orders.fileInsights' && typeof result.draft === 'string') c = { title: 'Weekly summary from your order file (draft)', text: result.draft };
  if (!c) return null;
  if (c.text.length > MAX_COPY_CHARS) { c.text = c.text.slice(0, MAX_COPY_CHARS - 1) + '…'; c.truncated = true; }
  return c;
}

export const formatResult = (tool, result) => (FORMAT[tool] ? FORMAT[tool](result) : 'done');

export async function runPlan({ plan, registry, inbox, onEvent = () => {}, ctx = {}, actor = 'agent' }) {
  const v = validatePlan(plan, registry);
  if (!v.ok) return { status: 'invalid', errors: v.errors, steps: [], plan };
  const results = {};
  const done = [];
  const text = renderPlan(plan, registry);
  onEvent({ event: 'plan', planId: plan.id, text, steps: plan.steps.map((s) => ({ id: s.id, text: s.why, tool: s.tool })) });
  ctx.run = ctx.run || registry.limits.newRun();
  ctx.actor = actor;

  for (const step of plan.steps) {
    const rec = { id: step.id, tool: step.tool, why: step.why, status: 'pending' };
    done.push(rec);
    onEvent({ event: 'step-start', planId: plan.id, id: step.id, tool: step.tool });
    const blocked = [...refsIn(step.args)].map((d) => done.find((x) => x.id === d)).find((x) => x && x.status !== 'ok');
    if (blocked) {
      rec.status = 'skipped';
      rec.note = `skipped because ${blocked.id} ${blocked.status === 'waiting-approval' ? 'is waiting for your OK' : 'did not finish cleanly'}`;
      onEvent({ event: 'step', planId: plan.id, ...rec });
      continue;
    }
    let args;
    try { args = resolveArgs(step.args || {}, results); } catch (e) { rec.status = 'failed'; rec.note = String(e.message); onEvent({ event: 'step', planId: plan.id, ...rec }); continue; }
    const tool = registry.get(step.tool);
    if (tool.tier === 'act') {
      const problems = validateArgs(tool.inputSchema, args);
      if (tool.blockedAfterUntrusted && ctx.tainted) { rec.status = 'failed'; rec.note = 'not allowed after reading text written by someone else'; }
      else if (problems.length) { rec.status = 'failed'; rec.note = 'bad arguments: ' + problems.join('; '); }
      else {
        const card = inbox.propose({ tool: step.tool, args, why: step.why, actor, planId: plan.id, stepId: step.id, tainted: !!ctx.tainted });
        rec.status = 'waiting-approval'; rec.cardId = card.id; rec.note = 'waiting for your OK (card ' + card.id + ')';
      }
      onEvent({ event: 'step', planId: plan.id, ...rec });
      continue;
    }
    const out = await registry.run(step.tool, args, ctx);
    if (!out.ok) { rec.status = 'failed'; rec.note = out.error; }
    else {
      results[step.id] = out.result;
      const problem = check(step, out.result);
      if (problem) { rec.status = 'unexpected'; rec.note = problem; }
      else { rec.status = 'ok'; rec.note = formatResult(step.tool, out.result); const copy = copyableOf(step.tool, out.result); if (copy) rec.copy = copy; }
    }
    onEvent({ event: 'step', planId: plan.id, ...rec });
  }
  const statuses = done.map((s) => s.status);
  const status = statuses.some((s) => s === 'failed' || s === 'unexpected') ? 'stopped' : statuses.includes('waiting-approval') ? 'waiting-approval' : statuses.every((s) => s === 'ok') ? 'done' : 'stopped';
  const report = [text, '', 'What happened:', ...done.map((s, i) => `${i + 1}. ${s.status === 'ok' ? 'done' : s.status}: ${s.note || ''}`.trim())].join('\n');
  onEvent({ event: 'plan-done', planId: plan.id, status });
  return { status, plan, text, steps: done, results, report };
}
