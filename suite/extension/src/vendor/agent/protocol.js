// A4 groundwork: messages between the extension side panel and the Agent. Same shape as the extension
// bridge (suite/extension/src/bridge.js): { source, v, id, type, payload } in, { source, v, id, ok,
// result | error } out. Pure rules plus a small service; no chrome.* calls, so the extension session can
// wire it to chrome.runtime later and tests can run it here.
//
//   panel -> agent  (source 'tcgss-panel')   agent.hello, agent.ask, agent.approve, agent.stop, agent.resume, agent.limits, agent.audit
//   agent -> panel  (source 'tcgss-agent')   responses, plus events: agent.progress, agent.approval-needed, agent.answer, agent.stopped
//
// Trust: a message counts only if the browser says it came from our own extension (sender.id).
// Nothing a web page posts can reach this: pages talk to the bridge, and the bridge has no agent types.
import { runAgent } from './loop.js';

export const PROTOCOL_VERSION = 1;
export const PANEL_SOURCE = 'tcgss-panel';
export const AGENT_SOURCE = 'tcgss-agent';
export const MAX_TEXT = 2000;
export const MAX_ID = 80;

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const shortStr = (v) => typeof v === 'string' && v.length > 0 && v.length <= MAX_ID;
const empty = (p) => (p === undefined || (isObj(p) && Object.keys(p).length === 0) ? null : 'takes no payload');

const PAYLOADS = {
  'agent.hello': empty,
  'agent.ask': (p) => {
    if (!isObj(p) || typeof p.text !== 'string' || !p.text.trim()) return 'text is required';
    if (p.text.length > MAX_TEXT) return 'text is too long (limit ' + MAX_TEXT + ')';
    if (Object.keys(p).some((k) => !['text'].includes(k))) return 'unexpected field';
    return null;
  },
  'agent.approve': (p) => (isObj(p) && shortStr(p.approvalId) && typeof p.approved === 'boolean' ? null : 'approvalId and approved (true or false) are required'),
  'agent.stop': empty,
  'agent.resume': empty,
  'agent.limits': empty,
  'agent.audit': (p) => (p === undefined || (isObj(p) && (p.limit === undefined || (Number.isInteger(p.limit) && p.limit >= 1 && p.limit <= 200))) ? null : 'limit must be 1 to 200'),
};
export const MESSAGE_TYPES = Object.keys(PAYLOADS);

// sender = what the browser reports (chrome.runtime MessageSender); never taken from the message.
export function isTrustedSender(sender, extensionId) {
  if (!isObj(sender) || typeof extensionId !== 'string' || !extensionId) return false;
  if (sender.id !== extensionId) return false;
  return sender.url === undefined || String(sender.url).startsWith('chrome-extension://' + extensionId + '/');
}

export function validateRequest(msg, sender, extensionId) {
  if (!isTrustedSender(sender, extensionId)) return { ok: false, error: 'sender not trusted' };
  if (!isObj(msg)) return { ok: false, error: 'message must be an object' };
  if (msg.source !== PANEL_SOURCE) return { ok: false, error: 'wrong source' };
  if (msg.v !== PROTOCOL_VERSION) return { ok: false, error: 'unsupported version' };
  if (!shortStr(msg.id)) return { ok: false, error: 'id must be a short string' };
  if (!MESSAGE_TYPES.includes(msg.type)) return { ok: false, error: 'unknown type' };
  if (Object.keys(msg).some((k) => !['source', 'v', 'id', 'type', 'payload'].includes(k))) return { ok: false, error: 'unexpected field' };
  const problem = PAYLOADS[msg.type](msg.payload);
  return problem ? { ok: false, error: msg.type + ': ' + problem } : { ok: true };
}

export const makeResponse = (id, result) => ({ source: AGENT_SOURCE, v: PROTOCOL_VERSION, id, ok: true, result });
export const makeError = (id, error) => ({ source: AGENT_SOURCE, v: PROTOCOL_VERSION, id: typeof id === 'string' ? id.slice(0, MAX_ID) : null, ok: false, error: String(error) });
export const makeEvent = (event, data = {}) => ({ source: AGENT_SOURCE, v: PROTOCOL_VERSION, event, ...data });

// The service the side panel talks to. One conversation runs at a time.
//   handle(msg, sender, emit) -> response message. `emit(event)` pushes events to the panel.
export function createAgentService({ registry, model, extensionId, system, approvalTimeoutMs = 5 * 60 * 1000, maxSteps = 8 }) {
  const pending = new Map(); // approvalId -> resolve
  let busy = false;
  let counter = 0;

  function denyAllPending() {
    for (const resolve of pending.values()) resolve(false);
    pending.clear();
  }

  async function ask(text, emit) {
    busy = true;
    const ctx = {
      actor: 'agent',
      run: registry.limits.newRun(),
      approve: (req) => new Promise((resolve) => {
        const approvalId = 'ap-' + (++counter);
        const timer = setTimeout(() => { if (pending.delete(approvalId)) resolve(false); }, approvalTimeoutMs);
        if (timer.unref) timer.unref();
        pending.set(approvalId, (ok) => { clearTimeout(timer); resolve(ok ? { approved: true, by: 'user' } : false); });
        emit(makeEvent('agent.approval-needed', { approvalId, tool: req.tool, description: req.description, args: req.args }));
      }),
    };
    try {
      const out = await runAgent({ model, registry, messages: [{ role: 'user', content: text }], ctx, maxSteps, system, onCall: (c) => emit(makeEvent('agent.progress', c)) });
      emit(makeEvent('agent.answer', { status: out.status, text: out.text, reason: out.reason, calls: out.calls.map((c) => c.name) }));
    } catch (err) {
      emit(makeEvent('agent.answer', { status: 'error', text: '', reason: String((err && err.message) || err) }));
    } finally {
      busy = false;
      denyAllPending();
    }
  }

  return {
    async handle(msg, sender, emit = () => {}) {
      const v = validateRequest(msg, sender, extensionId);
      if (!v.ok) return makeError(msg && msg.id, v.error);
      switch (msg.type) {
        case 'agent.hello':
          return makeResponse(msg.id, { v: PROTOCOL_VERSION, types: MESSAGE_TYPES, tools: registry.list().map((t) => ({ name: t.name, tier: t.tier })), killed: registry.limits.isKilled() });
        case 'agent.ask':
          if (busy) return makeError(msg.id, 'the agent is already working on something');
          if (registry.limits.isKilled()) return makeError(msg.id, 'the kill switch is on; send agent.resume first');
          ask(msg.payload.text, emit); // runs in the background; events follow
          return makeResponse(msg.id, { started: true });
        case 'agent.approve': {
          const resolve = pending.get(msg.payload.approvalId);
          if (!resolve) return makeError(msg.id, 'no such approval waiting');
          pending.delete(msg.payload.approvalId);
          resolve(msg.payload.approved);
          return makeResponse(msg.id, { recorded: true });
        }
        case 'agent.stop':
          registry.limits.kill('stopped from the side panel');
          denyAllPending();
          emit(makeEvent('agent.stopped'));
          return makeResponse(msg.id, { killed: true });
        case 'agent.resume':
          registry.limits.resume();
          return makeResponse(msg.id, { killed: false });
        case 'agent.limits':
          return makeResponse(msg.id, { killed: registry.limits.isKilled(), usage: registry.limits.usage(registry.limits.newRun()).day });
        case 'agent.audit': {
          const rows = await registry.audit.list();
          return makeResponse(msg.id, { entries: rows.slice(-(msg.payload && msg.payload.limit ? msg.payload.limit : 50)) });
        }
      }
      return makeError(msg.id, 'unhandled type');
    },
    get busy() { return busy; },
  };
}
