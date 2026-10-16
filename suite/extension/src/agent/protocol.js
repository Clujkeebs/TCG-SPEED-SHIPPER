// The side panel's side of the Agent message protocol. The source of truth is suite/agent/protocol.js
// (panel -> agent: source 'tcgss-panel'; agent -> panel: source 'tcgss-agent'). An extension cannot import
// files outside its folder, so this is a checked mirror. Everything arriving is validated here before use.
//
// Plan, memory, inbox, suggestions and undo are optional: the panel uses each one only if the agent lists it in
// its hello reply (hello.types). Requests starting with "ext." are extension-only (background jobs); they are
// not part of the Agent protocol and are answered by the extension's own host.
export const PROTOCOL_VERSION = 1;
export const PANEL_SOURCE = 'tcgss-panel';
export const AGENT_SOURCE = 'tcgss-agent';
export const MAX_TEXT = 2000;
export const MAX_ID = 80;
export const EVENTS = ['agent.progress', 'agent.approval-needed', 'agent.answer', 'agent.stopped', 'agent.plan', 'agent.memory'];
export const MAX_ROWS = 12;

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const str = (v, max) => typeof v === 'string' && v.length > 0 && v.length <= max;
const plainName = (v) => typeof v === 'string' && /^[a-zA-Z0-9_.-]{1,60}$/.test(v);

let counter = 0;
export function makeRequest(type, payload) {
  const m = { source: PANEL_SOURCE, v: PROTOCOL_VERSION, id: 'p-' + ++counter, type };
  if (payload !== undefined) m.payload = payload;
  return m;
}

// Turns an args object into at most MAX_ROWS short text rows for an approval card. Nothing is
// ever rendered as markup, and nested values are shown as compact text, so the owner sees it all.
export function argRows(args) {
  if (!isObj(args)) return [];
  return Object.entries(args).slice(0, MAX_ROWS).map(([k, v]) => ({
    label: String(k).slice(0, 60),
    value: (typeof v === 'string' ? v : JSON.stringify(v) ?? '').slice(0, 200)
  }));
}

// A response to one of our requests: { source, v, id, ok, result | error }.
export function validateResponse(m) {
  if (!isObj(m) || m.source !== AGENT_SOURCE || m.v !== PROTOCOL_VERSION || 'event' in m) return { ok: false };
  if (!(m.id === null || str(m.id, MAX_ID)) || typeof m.ok !== 'boolean') return { ok: false };
  return m.ok || typeof m.error === 'string' ? { ok: true } : { ok: false };
}

// An event pushed by the agent: { source, v, event, ...data }.
export function validateEvent(m) {
  const bad = { ok: false, error: 'bad event' };
  if (!isObj(m) || m.source !== AGENT_SOURCE || m.v !== PROTOCOL_VERSION || !EVENTS.includes(m.event)) return bad;
  switch (m.event) {
    case 'agent.progress':
      return plainName(m.tool) && typeof m.ok === 'boolean' && typeof m.denied === 'boolean' && (m.summary === undefined || str(m.summary, 200)) ? { ok: true } : bad;
    case 'agent.approval-needed':
      // why, undo and expected are plain-words lines for the approval card.
      return str(m.approvalId, MAX_ID) && plainName(m.tool) && str(m.description, 400) && isObj(m.args)
        && ['why', 'undo', 'expected'].every((k) => m[k] === undefined || str(m[k], 400)) ? { ok: true } : bad;
    case 'agent.answer':
      return ['done', 'stopped', 'step-limit', 'error'].includes(m.status) && typeof (m.text ?? '') === 'string' && String(m.text ?? '').length <= 8000 ? { ok: true } : bad;
    case 'agent.stopped':
      return { ok: true };
    case 'agent.plan':
      return (m.planId === undefined || str(m.planId, MAX_ID)) && Array.isArray(m.steps) && m.steps.length >= 1 && m.steps.length <= 12 && m.steps.every((s) => isObj(s) && str(s.text, 200) && ['todo', 'doing', 'done', 'skipped'].includes(s.state)) ? { ok: true } : bad;
    case 'agent.memory':
      return Array.isArray(m.items) && m.items.length <= 50 && m.items.every((i) => isObj(i) && str(i.id, MAX_ID) && str(i.text, 300)) ? { ok: true } : bad;
  }
  return bad;
}

// ---- results of optional requests (checked before they are shown)
export function cleanSuggestions(result) {
  if (!isObj(result) || !Array.isArray(result.suggestions)) return [];
  return result.suggestions.slice(0, 5).filter((x) => isObj(x) && str(x.title, 200) && str(x.why, 400) && (x.goal === null || x.goal === undefined || str(x.goal, MAX_TEXT)))
    .map((x) => ({ id: String(x.id ?? '').slice(0, 60), title: x.title, why: x.why, goal: x.goal ?? null }));
}

export function cleanCards(result) {
  if (!isObj(result) || !Array.isArray(result.cards)) return [];
  return result.cards.slice(0, 50).filter((c) => isObj(c) && str(c.approvalId, MAX_ID) && plainName(c.tool) && str(c.description, 400) && isObj(c.args))
    .map((c) => ({ approvalId: c.approvalId, tool: c.tool, description: c.description, why: str(c.why ?? '', 400) ? c.why : undefined, undo: str(c.undo ?? '', 400) ? c.undo : undefined, expected: str(c.expected ?? '', 400) ? c.expected : undefined, args: c.args }));
}

export function cleanJobs(result) {
  if (!isObj(result)) return { jobs: [], reports: [] };
  const jobs = (Array.isArray(result.jobs) ? result.jobs : []).slice(0, 10).filter((j) => isObj(j) && str(j.id, MAX_ID) && str(j.name, 100) && str(j.when, 100) && typeof j.enabled === 'boolean')
    .map((j) => ({ id: j.id, name: j.name, when: j.when, enabled: j.enabled, lastRunAt: typeof j.lastRunAt === 'string' ? j.lastRunAt.slice(0, 40) : undefined }));
  const reports = (Array.isArray(result.reports) ? result.reports : []).slice(0, 10).filter((r) => isObj(r) && str(r.id, MAX_ID) && str(r.title, 200) && typeof r.text === 'string' && r.text.length <= 4000)
    .map((r) => ({ id: r.id, title: r.title, text: r.text, ranAt: typeof r.ranAt === 'string' ? r.ranAt.slice(0, 40) : '' }));
  return { jobs, reports };
}
