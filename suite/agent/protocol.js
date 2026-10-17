// Messages between the extension side panel and the Agent. Same shape as the extension bridge
// (suite/extension/src/bridge.js): { source, v, id, type, payload } in, { source, v, id, ok, result | error } out.
// Pure rules plus a small service; no chrome.* calls, so the extension can wire it to chrome.runtime and tests
// can run it here. Shapes are written up in docs/suite/DATA-MODEL.md ("Agent messages").
//
//   panel -> agent  (source 'tcgss-panel')
//     agent.hello, agent.ask, agent.approve, agent.stop, agent.resume, agent.limits, agent.audit
//     agent.memory.list, agent.memory.forget {id}, agent.inbox.list, agent.suggestions, agent.undo {approvalId}, agent.export {csv}, agent.orders {csv}, agent.voice {samples}, agent.voice.set {card}, agent.briefing   (only when the service has an agent)
//   agent -> panel  (source 'tcgss-agent'): responses, plus events
//     agent.progress {tool, ok, denied, summary}        agent.approval-needed {approvalId, tool, description, why, undo, expected?, warning?, args}
//     agent.answer {status, text, calls?, drafts?: [{title, text, notes?, truncated?}], code?, resetsAt?}   (drafts = the replies and summaries to copy)               agent.stopped
//     agent.plan {planId, steps:[{text, state: todo|doing|done|skipped, output?}]}   (output = the text of a finished draft step, names filled in on the device)       agent.memory {items:[{id, text}]}
//
// `hello.types` lists every request type this service answers AND every event it may send, so a panel can decide what
// to show. `hello.requests` and `hello.events` list them separately.
// Trust: a message counts only if the browser says it came from our own extension (sender.id).
import { runAgent } from './loop.js';
import { TAINT_WARNING } from './untrusted.js';
import { copyableOf } from './plan.js';

export const PROTOCOL_VERSION = 1;
export const PANEL_SOURCE = 'tcgss-panel';
export const AGENT_SOURCE = 'tcgss-agent';
export const MAX_TEXT = 2000;
export const MAX_ID = 80;
export const PLAN_STATES = ['todo', 'doing', 'done', 'skipped'];

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
  'agent.memory.list': empty,
  'agent.memory.forget': (p) => (isObj(p) && shortStr(p.id) && Object.keys(p).length === 1 ? null : 'id is required'),
  'agent.inbox.list': empty,
  'agent.suggestions': empty,
  'agent.export': (p) => (isObj(p) && typeof p.csv === 'string' && p.csv.trim() && p.csv.length <= 400000 && Object.keys(p).length === 1 ? null : 'csv (text, at most 400,000 characters) is required'),
  'agent.orders': (p) => (isObj(p) && typeof p.csv === 'string' && p.csv.trim() && p.csv.length <= 6000000 && Object.keys(p).length === 1 ? null : 'csv (text, at most 6,000,000 characters) is required'),
  'agent.voice': (p) => (isObj(p) && Array.isArray(p.samples) && p.samples.length >= 3 && p.samples.length <= 5 && p.samples.every((x) => typeof x === 'string' && x.length <= 4000) && Object.keys(p).length === 1 ? null : 'samples: 3 to 5 replies (text, at most 4,000 characters each)'),
  'agent.voice.set': (p) => (isObj(p) && isObj(p.card) && Object.keys(p).length === 1 ? null : 'card (the fields to change) is required'),
  'agent.briefing': empty,
  'agent.undo': (p) => (isObj(p) && shortStr(p.approvalId) && Object.keys(p).length === 1 ? null : 'approvalId is required'),
};
// MESSAGE_TYPES is the original set and does not change: panels and hosts built against it keep working.
// REQUEST_TYPES is everything this file can validate, including the types that need an agent.
export const REQUEST_TYPES = Object.keys(PAYLOADS);
const AGENT_ONLY = ['agent.memory.list', 'agent.memory.forget', 'agent.inbox.list', 'agent.suggestions', 'agent.undo', 'agent.export', 'agent.orders', 'agent.voice', 'agent.voice.set', 'agent.briefing'];
export const MESSAGE_TYPES = REQUEST_TYPES.filter((t) => !AGENT_ONLY.includes(t));
export const EVENT_TYPES = ['agent.progress', 'agent.approval-needed', 'agent.answer', 'agent.stopped', 'agent.plan', 'agent.memory'];

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
  if (!REQUEST_TYPES.includes(msg.type)) return { ok: false, error: 'unknown type' };
  if (Object.keys(msg).some((k) => !['source', 'v', 'id', 'type', 'payload'].includes(k))) return { ok: false, error: 'unexpected field' };
  const problem = PAYLOADS[msg.type](msg.payload);
  return problem ? { ok: false, error: msg.type + ': ' + problem } : { ok: true };
}

export const makeResponse = (id, result) => ({ source: AGENT_SOURCE, v: PROTOCOL_VERSION, id, ok: true, result });
export const makeError = (id, error) => ({ source: AGENT_SOURCE, v: PROTOCOL_VERSION, id: typeof id === 'string' ? id.slice(0, MAX_ID) : null, ok: false, error: String(error) });
export const makeEvent = (event, data = {}) => ({ source: AGENT_SOURCE, v: PROTOCOL_VERSION, event, ...data });

// Checks an event before it is sent or used. Returns null when fine, or a problem in words.
export function validateEvent(e) {
  if (!isObj(e) || e.source !== AGENT_SOURCE || e.v !== PROTOCOL_VERSION) return 'not an agent event';
  if (!EVENT_TYPES.includes(e.event)) return 'unknown event';
  const str = (v, max = 400) => typeof v === 'string' && v.length > 0 && v.length <= max;
  switch (e.event) {
    case 'agent.plan':
      if (!Array.isArray(e.steps) || e.steps.length === 0 || e.steps.length > 8) return 'steps must be a list of 1 to 8';
      return e.steps.every((s) => isObj(s) && str(s.text, 200) && PLAN_STATES.includes(s.state) && (s.output === undefined || (typeof s.output === 'string' && s.output.length <= 6000))) ? null : 'each step needs text and a state of ' + PLAN_STATES.join('|') + ' (and optionally output, a text of at most 6000 characters)';
    case 'agent.memory':
      return Array.isArray(e.items) && e.items.every((i) => isObj(i) && shortStr(i.id) && str(i.text, 300)) ? null : 'items must be [{id, text}]';
    case 'agent.progress':
      return str(e.tool, 80) && typeof e.ok === 'boolean' && typeof e.denied === 'boolean' && str(e.summary, 200) ? null : 'progress needs tool, ok, denied and a summary';
    case 'agent.approval-needed':
      if (e.warning !== undefined && !str(e.warning)) return 'warning must be a short text';
      return shortStr(e.approvalId) && str(e.tool, 80) && str(e.description) && str(e.why) && str(e.undo) && isObj(e.args) ? null : 'approval needs approvalId, tool, description, why, undo, args';
    case 'agent.answer':
      if (e.drafts !== undefined && !(Array.isArray(e.drafts) && e.drafts.length <= 5 && e.drafts.every((d) => isObj(d) && str(d.title, 200) && typeof d.text === 'string' && d.text.length <= 6000 && (d.notes === undefined || typeof d.notes === 'string')))) return 'drafts must be up to 5 of { title, text, notes? }';
      return typeof e.status === 'string' && typeof e.text === 'string' ? null : 'answer needs status and text';
    default:
      return null;
  }
}

const TOOL_SUMMARY = {
  'report.repeatCustomers': 'Checked who orders more than once',
  'report.shipping': 'Looked at how often and where you ship',
  'report.weekly': 'Added up last week',
  'report.weeklyDraft': 'Wrote the weekly summary (draft, not sent)',
  'report.chart': 'Prepared chart numbers',
  'inventory.restock': 'Looked for cards running low that sell',
  'inventory.search': 'Searched your stock',
  'orders.search': 'Searched your orders',
  'pricing.suggestBatch': 'Worked out new prices (nothing changed yet)',
  'pricing.suggest': 'Worked out a price',
  'support.draftReply': 'Wrote a reply (draft, not sent)',
  'messages.unanswered': 'Looked for buyer messages with no reply',
  'deals.find': 'Looked for supply deals',
  'suggestions.weekly': 'Picked the things most worth doing',
  'inventory.setPrices': 'Saved new prices in your stock list',
  'memory.remember': 'Remembered a fact about your shop',
  'memory.forget': 'Forgot a fact',
};
// A short plain-words line for the panel. Never contains arguments or buyer details.
export function summarizeCall({ tool, tier, ok, denied }) {
  if (denied) return 'Not done: it was not allowed or not approved';
  if (!ok) return 'That step did not work';
  if (TOOL_SUMMARY[tool]) return TOOL_SUMMARY[tool];
  return tier === 'act' ? 'Made a change you approved' : tier === 'draft' ? 'Wrote a draft (not sent)' : 'Looked something up';
}

// A model-door error (adapters/proxy.js) carries the server's plain words, a code, and when a limit comes back.
function answerForError(err) {
  const reason = String((err && err.message) || err);
  return { status: 'error', text: err && err.name === 'ProxyError' ? reason : '', reason, ...(err && err.code ? { code: String(err.code) } : {}), ...(err && err.resetsAt ? { resetsAt: String(err.resetsAt) } : {}) };
}

const STATE_OF = { pending: 'todo', ok: 'done', 'waiting-approval': 'doing', skipped: 'skipped', failed: 'skipped', unexpected: 'skipped' };

// The service the side panel talks to.
//   handle(msg, sender, emit) -> response message. `emit(event)` pushes events to the panel.
// With an `agent` (see agent.js) a question first becomes a visible plan; act steps become cards the panel approves
// with agent.approve (approvalId = the card id). Without a plan, and with a model, it falls back to the chat loop.
export function createAgentService({ registry, model, extensionId, system, approvalTimeoutMs = 5 * 60 * 1000, maxSteps = 8, agent }) {
  const pending = new Map(); // chat-path approvals: approvalId -> resolve
  const views = new Map(); // planId -> [{text, state, id}] for agent.plan events
  let busy = false;
  let counter = 0;

  const availableRequests = () => REQUEST_TYPES.filter((t) => agent || !AGENT_ONLY.includes(t));
  const availableEvents = () => EVENT_TYPES.filter((t) => agent || !['agent.plan', 'agent.memory'].includes(t));
  const memoryItems = () => agent.memory.list().map((f) => ({ id: f.id, text: f.text }));
  const emitMemory = (emit) => emit(makeEvent('agent.memory', { items: memoryItems() }));
  const emitPlan = (emit, planId) => emit(makeEvent('agent.plan', { planId, steps: views.get(planId).map(({ text, state, output }) => ({ text, state, ...(output ? { output } : {}) })) }));

  function denyAllPending() {
    for (const resolve of pending.values()) resolve(false);
    pending.clear();
  }
  const announceCard = (emit, card) => emit(makeEvent('agent.approval-needed', { approvalId: card.id, tool: card.tool, description: card.what, why: card.why, undo: card.undoText, expected: card.expected, args: card.args, ...(card.warning ? { warning: card.warning } : {}) }));

  async function chat(text, emit) {
    const ctx = {
      actor: 'agent',
      run: registry.limits.newRun(),
      approve: (req) => new Promise((resolve) => {
        const approvalId = 'ap-' + (++counter);
        const timer = setTimeout(() => { if (pending.delete(approvalId)) resolve(false); }, approvalTimeoutMs);
        if (timer.unref) timer.unref();
        pending.set(approvalId, (ok) => { clearTimeout(timer); resolve(ok ? { approved: true, by: 'user' } : false); });
        const t = registry.get(req.tool);
        const d = (t && typeof t.describe === 'function' && t.describe(req.args)) || {};
        emit(makeEvent('agent.approval-needed', { approvalId, tool: req.tool, description: d.what || req.description, why: 'You asked a question and the assistant wants to do this to answer it.', undo: d.undoText || 'This cannot be undone automatically.', args: req.args, ...(req.tainted ? { warning: TAINT_WARNING } : {}) }));
      }),
    };
    try {
      const copies = [];
      const out = await runAgent({
        model, registry, messages: [{ role: 'user', content: text }], ctx, maxSteps, system,
        onCall: (c, res) => {
          const copy = agent && res && res.ok ? copyableOf(c.tool, res.result) : null;
          if (copy) copies.push(copy);
          emit(makeEvent('agent.progress', { ...c, summary: summarizeCall({ ...c, tier: (registry.get(c.tool) || {}).tier }) }));
        },
      });
      // names are filled in here, on the device: the model only ever saw {{first_name}}
      const drafts = copies.slice(0, 5).map((c) => agent.fillCopy(c));
      const lastOrder = [...copies].reverse().find((c) => c.orderId);
      const answerText = agent && lastOrder ? agent.fillCopy({ text: out.text, orderId: lastOrder.orderId }).text : out.text;
      emit(makeEvent('agent.answer', { status: out.status, text: answerText, reason: out.reason, calls: out.calls.map((c) => c.name), ...(drafts.length ? { drafts } : {}) }));
    } catch (err) {
      emit(makeEvent('agent.answer', answerForError(err)));
    }
  }

  async function goal(text, emit) {
    const onEvent = (e) => {
      if (e.event === 'plan') {
        views.set(e.planId, e.steps.map((s) => ({ id: s.id, text: s.text, state: 'todo' })));
        emitPlan(emit, e.planId);
      } else if (e.event === 'step-start') {
        const s = views.get(e.planId).find((x) => x.id === e.id);
        s.state = 'doing';
        emitPlan(emit, e.planId);
      } else if (e.event === 'step') {
        const s = views.get(e.planId).find((x) => x.id === e.id);
        s.state = STATE_OF[e.status] || 'skipped';
        if (e.copy) { const c = agent.fillCopy(e.copy); s.output = c.text; } // the reply to copy, names filled in on this device only
        emitPlan(emit, e.planId);
        const tier = (registry.get(e.tool) || {}).tier;
        if (e.status !== 'waiting-approval') emit(makeEvent('agent.progress', { tool: e.tool, ok: e.status === 'ok', denied: false, summary: e.status === 'ok' ? summarizeCall({ tool: e.tool, tier, ok: true, denied: false }) : (e.note || 'That step did not work').slice(0, 200) }));
      }
    };
    const out = await agent.goal(text, { onEvent });
    if (out.status === 'no-plan' || out.status === 'invalid') return out;
    for (const s of out.steps) if (s.cardId) announceCard(emit, agent.inbox.get(s.cardId));
    const drafts = out.steps.filter((s) => s.copy).slice(0, 5).map((s) => agent.fillCopy(s.copy));
    emit(makeEvent('agent.answer', { status: out.status, text: out.report, calls: out.steps.map((s) => s.tool), ...(drafts.length ? { drafts } : {}) }));
    return out;
  }

  async function ask(text, emit) {
    busy = true;
    try {
      if (agent) {
        const out = await goal(text, emit);
        if (out.status !== 'no-plan' && out.status !== 'invalid') return;
        if (!model) { emit(makeEvent('agent.answer', { status: out.status, text: out.reason || 'I could not make a plan for that.', reason: out.reason })); return; }
      }
      await chat(text, emit);
    } catch (err) {
      emit(makeEvent('agent.answer', answerForError(err)));
    } finally {
      busy = false;
      denyAllPending();
    }
  }

  return {
    async handle(msg, sender, emit = () => {}) {
      const v = validateRequest(msg, sender, extensionId);
      if (!v.ok) return makeError(msg && msg.id, v.error);
      if (!availableRequests().includes(msg.type)) return makeError(msg.id, msg.type + ' is not available here');
      switch (msg.type) {
        case 'agent.hello':
          return makeResponse(msg.id, {
            v: PROTOCOL_VERSION,
            types: [...availableRequests(), ...availableEvents()],
            requests: availableRequests(),
            events: availableEvents(),
            tools: registry.list().map((t) => ({ name: t.name, tier: t.tier })),
            killed: registry.limits.isKilled(),
          });
        case 'agent.ask':
          if (busy) return makeError(msg.id, 'the agent is already working on something');
          if (registry.limits.isKilled()) return makeError(msg.id, 'the kill switch is on; send agent.resume first');
          ask(msg.payload.text, emit); // runs in the background; events follow
          return makeResponse(msg.id, { started: true });
        case 'agent.approve': {
          const id = msg.payload.approvalId;
          const resolve = pending.get(id);
          if (resolve) {
            pending.delete(id);
            resolve(msg.payload.approved);
            return makeResponse(msg.id, { recorded: true });
          }
          if (agent) {
            let card;
            try { card = agent.inbox.get(id); } catch { return makeError(msg.id, 'no such approval waiting'); }
            let out;
            try { out = await agent.decide(id, msg.payload.approved); } catch (err) { return makeError(msg.id, err.message); }
            const done = out.card.status === 'done';
            emit(makeEvent('agent.progress', { tool: card.tool, ok: done || out.card.status === 'declined', denied: out.card.status === 'declined', summary: done ? summarizeCall({ tool: card.tool, tier: 'act', ok: true, denied: false }) : out.card.status === 'declined' ? 'You declined this; nothing was changed' : 'That step did not work' }));
            if (out.step && card.planId && views.has(card.planId)) {
              const s = views.get(card.planId).find((x) => x.id === card.stepId);
              if (s) { s.state = STATE_OF[out.step.status] || 'skipped'; emitPlan(emit, card.planId); }
            }
            if (/^memory\./.test(card.tool)) emitMemory(emit);
            if (out.planStatus === 'done' || out.planStatus === 'stopped') emit(makeEvent('agent.answer', { status: out.planStatus, text: out.planStatus === 'done' ? 'All the steps are finished.' : 'Finished, but one step did not work.', calls: [card.tool] }));
            return makeResponse(msg.id, { recorded: true, status: out.card.status });
          }
          return makeError(msg.id, 'no such approval waiting');
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
        case 'agent.memory.list':
          emitMemory(emit);
          return makeResponse(msg.id, { items: memoryItems() });
        case 'agent.memory.forget':
          try { await agent.forgetMemory(msg.payload.id); } catch (err) { return makeError(msg.id, err.message); }
          emitMemory(emit);
          return makeResponse(msg.id, { forgotten: true });
        case 'agent.inbox.list':
          return makeResponse(msg.id, { cards: agent.inbox.list({ status: 'pending' }).map((c) => ({ approvalId: c.id, tool: c.tool, description: c.what, why: c.why, undo: c.undoText, expected: c.expected, args: c.args })) });
        case 'agent.undo': {
          let card;
          try { card = await agent.undo(msg.payload.approvalId); } catch (err) { return makeError(msg.id, err.message); }
          emit(makeEvent('agent.progress', { tool: card.tool, ok: true, denied: false, summary: 'Put things back as they were' }));
          if (/^memory\./.test(card.tool)) emitMemory(emit);
          return makeResponse(msg.id, { undone: true, status: card.status });
        }
        case 'agent.export': {
          if (registry.limits.isKilled()) return makeError(msg.id, 'the kill switch is on; send agent.resume first');
          const out = await agent.syncExport(msg.payload.csv);
          if (out.status !== 'ok') return makeError(msg.id, out.reason || (out.problems || ['could not read that file']).join(' '));
          for (const c of out.cards) announceCard(emit, c);
          return makeResponse(msg.id, { rows: out.analysis.rows, units: out.analysis.units, columns: out.analysis.columns.notes, fixes: out.analysis.fixes.map((f) => ({ rank: f.rank, title: f.title, why: f.why, ...(f.cardId ? { approvalId: f.cardId } : {}) })) });
        }
        case 'agent.orders': {
          if (registry.limits.isKilled()) return makeError(msg.id, 'the kill switch is on; send agent.resume first');
          const out = await agent.orderFile(msg.payload.csv);
          if (out.status !== 'ok') return makeError(msg.id, out.reason || 'no orders could be read from that file');
          // The draft still holds {{buyer:KEY}} placeholders; the panel fills names in locally with the names table it holds.
          return makeResponse(msg.id, { summary: out.summary, draft: agent.fillNames(out.draft), charts: out.charts });
        }
        case 'agent.voice':
        case 'agent.voice.set': {
          let out;
          try { out = msg.type === 'agent.voice' ? await agent.learnVoice(msg.payload.samples) : await agent.setVoice(msg.payload.card); } catch (err) { return makeError(msg.id, err.message); }
          emitMemory(emit);
          return makeResponse(msg.id, { card: out.card, text: out.text });
        }
        case 'agent.briefing':
          return makeResponse(msg.id, await agent.briefing());
        case 'agent.suggestions':
          return makeResponse(msg.id, await agent.suggestions());
      }
      return makeError(msg.id, 'unhandled type');
    },
    get busy() { return busy; },
  };
}
