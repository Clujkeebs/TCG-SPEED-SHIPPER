// Tool registry with permission tiers. Tiers (docs/suite/PLAN.md 4.3):
//   read      looks at data, changes nothing
//   draft     prepares something for a human; never sends or changes anything
//   act       changes something; needs an approval callback, every time
//   autopilot runs by itself, only inside an automation the owner switched on
// An act tool may also give `describe(args) -> { what, expected, undoText }` (used for its approval card)
// and `undo(args, result) -> { tool, args } | null` (how to reverse it).
import { TOOL_TIERS } from '../shared/models.js';
import { createAuditLog } from './audit.js';
import { createLimits } from './limits.js';

const TYPES = ['string', 'number', 'integer', 'boolean', 'array', 'object'];

function typeOk(type, v) {
  if (type === 'integer') return Number.isInteger(v);
  if (type === 'number') return typeof v === 'number' && Number.isFinite(v);
  if (type === 'array') return Array.isArray(v);
  if (type === 'object') return v !== null && typeof v === 'object' && !Array.isArray(v);
  return typeof v === type; // string, boolean
}

// Small subset of JSON Schema: object with typed properties, required, enum, min/max.
export function validateArgs(schema, args) {
  const errors = [];
  if (args === null || typeof args !== 'object' || Array.isArray(args)) return ['arguments must be an object'];
  const props = (schema && schema.properties) || {};
  for (const key of (schema && schema.required) || []) if (args[key] === undefined) errors.push(key + ' is required');
  for (const [key, v] of Object.entries(args)) {
    const p = props[key];
    if (!p) { errors.push('unknown argument ' + key); continue; }
    if (!typeOk(p.type, v)) { errors.push(key + ' must be a ' + p.type); continue; }
    if (p.enum && !p.enum.includes(v)) errors.push(key + ' must be one of ' + p.enum.join(', '));
    if (typeof v === 'number' && p.minimum !== undefined && v < p.minimum) errors.push(key + ' must be at least ' + p.minimum);
    if (typeof v === 'number' && p.maximum !== undefined && v > p.maximum) errors.push(key + ' must be at most ' + p.maximum);
  }
  return errors;
}

export function createRegistry({ audit = createAuditLog(), limits = createLimits() } = {}) {
  const tools = new Map();

  function register(tool) {
    const t = tool || {};
    if (typeof t.name !== 'string' || !/^[a-zA-Z0-9_.-]+$/.test(t.name)) throw new Error('tool needs a plain name');
    if (tools.has(t.name)) throw new Error('tool already registered: ' + t.name);
    if (typeof t.description !== 'string' || !t.description) throw new Error(t.name + ': description is required');
    if (!TOOL_TIERS.includes(t.tier)) throw new Error(t.name + ': tier must be one of ' + TOOL_TIERS.join(', '));
    if (typeof t.handler !== 'function') throw new Error(t.name + ': handler must be a function');
    const schema = t.inputSchema || { type: 'object', properties: {} };
    for (const p of Object.values(schema.properties || {})) if (!TYPES.includes(p.type)) throw new Error(t.name + ': bad property type ' + p.type);
    tools.set(t.name, Object.freeze({ ...t, inputSchema: schema }));
    return api;
  }

  // What the model is shown.
  function specs() {
    return [...tools.values()].map((t) => ({ name: t.name, description: '[' + t.tier + '] ' + t.description, input_schema: t.inputSchema }));
  }

  // ctx: { run, actor, approve(request) -> boolean | { approved, by }, automation: { enabled } }
  async function run(name, args = {}, ctx = {}) {
    const actor = ctx.actor || 'agent';
    const t = tools.get(name);
    const log = (tier, outcome, approvedBy) => audit.record({ actor, tool: name, tier, args, outcome, approvedBy });
    if (!t) { await log('read', 'error'); return { ok: false, error: 'unknown tool ' + name }; }
    const deny = async (error) => { await log(t.tier, 'denied'); return { ok: false, denied: true, error }; };

    const runCounters = ctx.run || (ctx.run = limits.newRun());
    const cost = typeof t.costCents === 'function' ? t.costCents(args) : t.costCents || 0;
    const gate = limits.check(runCounters, cost);
    if (!gate.ok) return deny(gate.reason);

    const problems = validateArgs(t.inputSchema, args);
    if (problems.length) { await log(t.tier, 'error'); return { ok: false, error: 'bad arguments: ' + problems.join('; ') }; }

    let approvedBy;
    if (t.tier === 'act') {
      if (typeof ctx.approve !== 'function') return deny('this tool changes things and needs an approval step; none was given');
      const answer = await ctx.approve({ tool: name, tier: t.tier, description: t.description, args });
      const approved = answer === true || (answer && answer.approved === true);
      if (!approved) return deny('the owner did not approve this');
      approvedBy = (answer && answer.by) || 'user';
    } else if (t.tier === 'autopilot') {
      if (!ctx.automation || ctx.automation.enabled !== true) return deny('autopilot tools only run inside an automation the owner switched on');
    }

    limits.record(runCounters, cost);
    try {
      const result = await t.handler(args, ctx);
      await log(t.tier, 'ok', approvedBy);
      return { ok: true, result };
    } catch (err) {
      await log(t.tier, 'error', approvedBy);
      return { ok: false, error: String((err && err.message) || err) };
    }
  }

  const api = { register, specs, run, get: (n) => tools.get(n), list: () => [...tools.values()], audit, limits };
  return api;
}
