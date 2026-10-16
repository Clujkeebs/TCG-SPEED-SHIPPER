// The side panel's brain, with no DOM so it can be tested. Rules:
//  - an approval is only ever answered by approve()/deny() (called from a button click), once per card;
//  - anything the agent sends is checked first; bad messages become a notice and change nothing;
//  - the Stop button always works, even while waiting for an approval;
//  - plan, memory, inbox, suggestions and undo appear only if the agent says (in hello) that it supports them;
//  - waiting cards stay waiting until the seller answers them (Stop and new answers do not cancel them).
import { plainError } from './friendly.js';
import { makeRequest, validateEvent, validateResponse, argRows, cleanSuggestions, cleanCards, cleanJobs, MAX_TEXT } from './protocol.js';

export function createPanel(transport) {
  const state = {
    connected: false, killed: false, busy: false, goal: '',
    items: [],       // { kind: 'progress'|'answer'|'notice'|'approval', ... } in order
    plan: [],        // [{ text, state }]
    memory: null,    // null = agent does not offer it; otherwise [{ id, text }]
    canPlan: true, canMemory: false, canInbox: false, canSuggest: false, canUndo: false, canJobs: false,
    suggestions: [], jobs: [], reports: []
  };
  const addCard = (c) => { if (!state.items.some((i) => i.kind === 'approval' && i.id === c.approvalId)) state.items.push({ kind: 'approval', id: c.approvalId, tool: c.tool, description: c.description, rows: argRows(c.args), why: c.why, undo: c.undo, expected: c.expected, state: 'waiting' }); };
  const listeners = new Set();
  const changed = () => listeners.forEach((f) => f());
  const notice = (text, ours = false) => state.items.push({ kind: 'notice', text: ours ? text : plainError(text) });

  transport.onEvent((e) => {
    const check = validateEvent(e);
    if (!check.ok) { notice('I ignored a message that did not look right.', true); return changed(); }
    switch (e.event) {
      case 'agent.progress':
        state.items.push({ kind: 'progress', text: e.summary || ((e.denied ? 'Was not allowed to use ' : e.ok ? 'Used ' : 'Tried and failed: ') + e.tool) });
        break;
      case 'agent.approval-needed':
        addCard({ approvalId: e.approvalId, tool: e.tool, description: e.description, args: e.args, why: e.why, undo: e.undo, expected: e.expected });
        break;
      case 'agent.answer':
        state.busy = false;
        state.items.push({ kind: 'answer', text: e.text || (e.status === 'error' ? plainError(e.reason) : e.status === 'stopped' ? 'Stopped. ' + plainError(e.reason) : 'Done.') });
        break;
      case 'agent.stopped':
        state.busy = false; state.killed = true;
        notice('Stopped. Nothing else will run until you press Resume.', true);
        break;
      case 'agent.plan':
        state.plan = e.steps.map((s) => ({ text: s.text, state: s.state }));
        break;
      case 'agent.memory':
        if (state.canMemory) state.memory = e.items.map((i) => ({ id: i.id, text: i.text }));
        break;
    }
    changed();
  });

  // Like call(), but a missing/unsupported answer is not shown to the seller (used for optional extras).
  async function callQuiet(type, payload) {
    try { const res = await transport.request(makeRequest(type, payload)); return res && validateResponse(res).ok && res.ok ? res.result : null; } catch { return null; }
  }
  async function call(type, payload) {
    let res;
    try { res = await transport.request(makeRequest(type, payload)); } catch { res = null; }
    if (!res || !validateResponse(res).ok) { notice('I could not reach the assistant just now. Close and reopen this panel. If it keeps happening, switch the Agent panel off and on in Settings.', true); changed(); return null; }
    if (!res.ok) { notice(res.error.slice(0, 200)); changed(); return null; }
    return res.result;
  }

  return {
    state,
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    get waitingForApproval() { return state.items.some((i) => i.kind === 'approval' && i.state === 'waiting'); },

    async connect() {
      const r = await call('agent.hello');
      if (!r) return false;
      state.connected = true;
      state.killed = r.killed === true;
      const has = (t) => Array.isArray(r.types) && r.types.includes(t);
      state.canMemory = has('agent.memory.list') && has('agent.memory.forget');
      state.canInbox = has('agent.inbox.list');
      state.canSuggest = has('agent.suggestions');
      state.canUndo = has('agent.undo');
      if (state.canMemory) await call('agent.memory.list');
      if (state.canInbox) { const c = await call('agent.inbox.list'); for (const card of cleanCards(c)) addCard(card); }
      await this.refresh();
      changed();
      return true;
    },
    // Suggestions and jobs: read-only lookups, safe to repeat.
    async refresh() {
      if (state.canInbox) { const c = await callQuiet('agent.inbox.list'); if (c) for (const card of cleanCards(c)) addCard(card); }
      if (state.canSuggest) { const s = await call('agent.suggestions'); if (s) state.suggestions = cleanSuggestions(s); }
      const j = await callQuiet('ext.jobs.list');
      if (j) { state.canJobs = true; Object.assign(state, cleanJobs(j)); }
      changed();
    },
    async addJob(kind) { const r = await call('ext.jobs.add', { kind }); await this.refresh(); return !!r; },
    async toggleJob(id, enabled) { const r = await call('ext.jobs.toggle', { id, enabled }); await this.refresh(); return !!r; },
    async removeJob(id) { const r = await call('ext.jobs.remove', { id }); await this.refresh(); return !!r; },
    async undo(id) {
      const card = state.items.find((i) => i.kind === 'approval' && i.id === id && i.state === 'approved');
      if (!card || !state.canUndo) return false;
      const r = await call('agent.undo', { approvalId: id });
      if (r) { card.state = 'undone'; changed(); }
      return !!r;
    },
    // The goal box.
    async start(goal) {
      const g = String(goal ?? '').trim();
      if (!g || g.length > MAX_TEXT || state.busy || state.killed || !state.connected) return false;
      state.goal = g; state.plan = []; state.busy = true;
      state.items.push({ kind: 'user', text: g });
      changed();
      const r = await call('agent.ask', { text: g });
      if (!r) { state.busy = false; changed(); return false; }
      return true;
    },
    // Button clicks only.
    async answer(id, approved) {
      const card = state.items.find((i) => i.kind === 'approval' && i.id === id && i.state === 'waiting');
      if (!card) return false;
      card.state = approved ? 'approved' : 'denied';
      changed();
      const r = await call('agent.approve', { approvalId: id, approved: approved === true });
      if (!r) card.state = 'waiting'; // it did not go through (for example Stop is on): the card is still waiting
      changed();
      return !!r;
    },
    async stop() { return !!(await call('agent.stop')); },
    async resume() { const r = await call('agent.resume'); if (r) { state.killed = false; changed(); } return !!r; },
    async forget(id) { return state.canMemory ? !!(await call('agent.memory.forget', { id })) : false; }
  };
}
