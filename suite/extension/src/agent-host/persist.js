// Where the practice Agent keeps its state so a sleeping/restarted service worker loses nothing:
// shop memory, the approval inbox (waiting cards and recent finished ones with their undo), the last plan,
// the stop switch, saved background jobs and their reports, and the made-up shop's price changes.
// (The audit trail goes to IndexedDB through the Agent's own store.) Everything stays on this computer.
export const STATE_KEY = 'tcgss_agent_state_v2';
export const AUDIT_DB = 'tcgss-ext-audit';
const MAX_LEDGER = 60;
const MAX_REPORTS = 30;
const MAX_JOBS = 10;

export function chromeStatePersist(area = globalThis.chrome?.storage?.local) {
  return {
    async load() {
      try { return (await area.get(STATE_KEY))[STATE_KEY] ?? null; } catch { return null; }
    },
    async save(state) { await area.set({ [STATE_KEY]: state }); },
    async clear() { await area.remove(STATE_KEY); }
  };
}

export function memoryStatePersist() {
  let data = null;
  return {
    async load() { return data === null ? null : structuredClone(data); },
    async save(state) { data = structuredClone(state); },
    async clear() { data = null; },
    peek: () => data
  };
}

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const str = (v, n) => typeof v === 'string' && v.length > 0 && v.length <= n;
const tool = (v) => typeof v === 'string' && /^[a-zA-Z0-9_.-]{1,60}$/.test(v);
const clone = (v) => JSON.parse(JSON.stringify(v));

// Defensive: only accept the shape we write ourselves; anything else is treated as "no saved state".
// (Memory facts and jobs are validated again by the Agent's own code when they are loaded.)
export function cleanState(raw) {
  if (!isObj(raw)) return null;
  const out = { memory: null, ledger: [], xCounter: 0, plan: null, killed: raw.killed === true, prices: {}, jobs: [], reports: [], repCounter: 0, jobCounter: 0, usingImported: raw.usingImported === true };
  if (typeof raw.memory === 'string' && raw.memory.length <= 100000) out.memory = raw.memory;
  if (Number.isInteger(raw.xCounter) && raw.xCounter >= 0 && raw.xCounter < 1e6) out.xCounter = raw.xCounter;
  if (Number.isInteger(raw.repCounter) && raw.repCounter >= 0 && raw.repCounter < 1e6) out.repCounter = raw.repCounter;
  if (Number.isInteger(raw.jobCounter) && raw.jobCounter >= 0 && raw.jobCounter < 1e6) out.jobCounter = raw.jobCounter;
  if (Array.isArray(raw.ledger)) {
    for (const e of raw.ledger.slice(-MAX_LEDGER)) {
      if (!isObj(e) || !str(e.xid, 80) || !['pending', 'done', 'declined', 'failed', 'undone', 'expired'].includes(e.status) || !isObj(e.spec) || !tool(e.spec.tool) || !isObj(e.spec.args) || !str(e.spec.why ?? 'x', 400)) continue;
      const entry = { xid: e.xid, status: e.status, spec: { tool: e.spec.tool, args: clone(e.spec.args), why: e.spec.why, actor: e.spec.actor === 'automation' ? 'automation' : 'agent' } };
      if (str(e.spec.planId, 80)) entry.spec.planId = e.spec.planId;
      if (str(e.spec.stepId, 80)) entry.spec.stepId = e.spec.stepId;
      if (isObj(e.undo) && tool(e.undo.tool) && isObj(e.undo.args)) entry.undo = { tool: e.undo.tool, args: clone(e.undo.args) };
      out.ledger.push(entry);
    }
  }
  const p = raw.plan;
  if (isObj(p) && str(p.planId, 80) && Array.isArray(p.steps) && p.steps.length >= 1 && p.steps.length <= 12 && p.steps.every((s) => isObj(s) && str(s.text, 200) && ['todo', 'doing', 'done', 'skipped'].includes(s.state))) {
    out.plan = { planId: p.planId, steps: p.steps.map((s) => ({ text: s.text, state: s.state })) };
  }
  if (isObj(raw.prices)) for (const [k, v] of Object.entries(raw.prices)) if (str(k, 80) && Number.isInteger(v) && v > 0 && v <= 10000000) out.prices[k] = v;
  if (Array.isArray(raw.jobs)) out.jobs = raw.jobs.slice(0, MAX_JOBS).filter(isObj).map(clone);
  if (Array.isArray(raw.reports)) out.reports = raw.reports.slice(-MAX_REPORTS).filter(isObj).map(clone);
  return out;
}
