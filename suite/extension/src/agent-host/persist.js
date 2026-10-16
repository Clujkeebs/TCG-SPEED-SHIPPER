// Where the practice Agent keeps its state so a sleeping/restarted service worker loses nothing:
// the plan, memory, a waiting approval, the stop switch and the made-up shop's price changes.
// (The audit trail goes to IndexedDB through the Agent's own store.) Everything stays on this computer.
export const STATE_KEY = 'tcgss_agent_state_v1';
export const AUDIT_DB = 'tcgss-ext-audit';

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

// Defensive: only accept the shape we write ourselves; anything else is treated as "no saved state".
export function cleanState(raw) {
  const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
  if (!isObj(raw)) return null;
  const str = (v, n) => typeof v === 'string' && v.length > 0 && v.length <= n;
  const out = { memory: [], memoryCounter: 2, plan: null, pending: null, killed: raw.killed === true, prices: {} };
  if (Array.isArray(raw.memory)) out.memory = raw.memory.filter((m) => isObj(m) && str(m.id, 80) && str(m.text, 300)).slice(0, 50).map((m) => ({ id: m.id, text: m.text }));
  if (Number.isInteger(raw.memoryCounter) && raw.memoryCounter >= 0 && raw.memoryCounter < 1e6) out.memoryCounter = raw.memoryCounter;
  if (Array.isArray(raw.plan) && raw.plan.length <= 12 && raw.plan.every((s) => isObj(s) && str(s.text, 200) && ['todo', 'doing', 'done', 'skipped'].includes(s.state))) out.plan = raw.plan.map((s) => ({ text: s.text, state: s.state }));
  const p = raw.pending;
  if (isObj(p) && str(p.approvalId, 80) && /^[a-zA-Z0-9_.-]{1,60}$/.test(p.tool ?? '') && str(p.description, 400) && isObj(p.args)) {
    out.pending = { approvalId: p.approvalId, tool: p.tool, description: p.description, args: JSON.parse(JSON.stringify(p.args)), steps: Array.isArray(p.steps) ? p.steps.filter((x) => typeof x === 'string').slice(0, 12) : [] };
  }
  if (isObj(raw.prices)) for (const [k, v] of Object.entries(raw.prices)) if (str(k, 80) && Number.isInteger(v) && v > 0 && v <= 100000) out.prices[k] = v;
  return out;
}
