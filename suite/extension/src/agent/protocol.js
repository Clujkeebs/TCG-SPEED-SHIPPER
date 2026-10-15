// The side panel's side of the Agent message protocol. The source of truth is suite/agent/protocol.js
// (panel -> agent: source 'tcgss-panel'; agent -> panel: source 'tcgss-agent'). An extension cannot import
// files outside its folder, so this is a checked mirror. Everything arriving is validated here before use.
//
// PROPOSED (not yet in suite/agent/protocol.js; the panel only uses them if the agent lists them in its
// hello reply): event 'agent.plan', event 'agent.memory', request types 'agent.memory.list' and
// 'agent.memory.forget'. See docs/suite/LOG.md.
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
      return plainName(m.tool) && typeof m.ok === 'boolean' && typeof m.denied === 'boolean' ? { ok: true } : bad;
    case 'agent.approval-needed':
      // summary, why and undo are PROPOSED optional plain-words fields for the approval card.
      return str(m.approvalId, MAX_ID) && plainName(m.tool) && str(m.description, 400) && isObj(m.args)
        && ['summary', 'why', 'undo'].every((k) => m[k] === undefined || str(m[k], 400)) ? { ok: true } : bad;
    case 'agent.answer':
      return ['done', 'stopped', 'step-limit', 'error'].includes(m.status) && typeof (m.text ?? '') === 'string' && String(m.text ?? '').length <= 8000 ? { ok: true } : bad;
    case 'agent.stopped':
      return { ok: true };
    case 'agent.plan':
      return Array.isArray(m.steps) && m.steps.length >= 1 && m.steps.length <= 12 && m.steps.every((s) => isObj(s) && str(s.text, 200) && ['todo', 'doing', 'done', 'skipped'].includes(s.state)) ? { ok: true } : bad;
    case 'agent.memory':
      return Array.isArray(m.items) && m.items.length <= 50 && m.items.every((i) => isObj(i) && str(i.id, MAX_ID) && str(i.text, 300)) ? { ok: true } : bad;
  }
  return bad;
}
