// The side panel's brain, with no DOM so it can be tested. Rules:
//  - an approval is only ever answered by approve()/deny() (called from a button click), once per card;
//  - anything the agent sends is checked first; bad messages become a notice and change nothing;
//  - the Stop button always works, even while waiting for an approval;
//  - plan and memory views appear only if the agent says (in hello) that it supports them.
import { makeRequest, validateEvent, validateResponse, argRows, MAX_TEXT } from './protocol.js';

export function createPanel(transport) {
  const state = {
    connected: false, killed: false, busy: false, goal: '',
    items: [],       // { kind: 'progress'|'answer'|'notice'|'approval', ... } in order
    plan: [],        // [{ text, state }]
    memory: null,    // null = agent does not offer it; otherwise [{ id, text }]
    canPlan: true, canMemory: false
  };
  const listeners = new Set();
  const changed = () => listeners.forEach((f) => f());
  const notice = (text) => state.items.push({ kind: 'notice', text });

  transport.onEvent((e) => {
    const check = validateEvent(e);
    if (!check.ok) { notice('Ignored a message that did not look right.'); return changed(); }
    switch (e.event) {
      case 'agent.progress':
        state.items.push({ kind: 'progress', text: (e.denied ? 'Was not allowed to use ' : e.ok ? 'Used ' : 'Tried and failed: ') + e.tool });
        break;
      case 'agent.approval-needed':
        state.items.push({ kind: 'approval', id: e.approvalId, tool: e.tool, description: e.description, rows: argRows(e.args), why: e.why, undo: e.undo, state: 'waiting' });
        break;
      case 'agent.answer':
        state.busy = false;
        for (const c of state.items) if (c.kind === 'approval' && c.state === 'waiting') c.state = 'expired';
        state.items.push({ kind: 'answer', text: e.text || (e.status === 'error' ? 'Something went wrong: ' + (e.reason || 'unknown') : e.status === 'stopped' ? 'Stopped: ' + (e.reason || '') : 'Done.') });
        break;
      case 'agent.stopped':
        state.busy = false; state.killed = true;
        for (const c of state.items) if (c.kind === 'approval' && c.state === 'waiting') c.state = 'expired';
        notice('Stopped. Nothing else will run until you press Resume.');
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

  async function call(type, payload) {
    let res;
    try { res = await transport.request(makeRequest(type, payload)); } catch { res = null; }
    if (!res || !validateResponse(res).ok) { notice('The agent did not answer properly.'); changed(); return null; }
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
      state.canMemory = Array.isArray(r.types) && r.types.includes('agent.memory.list') && r.types.includes('agent.memory.forget');
      if (state.canMemory) await call('agent.memory.list');
      changed();
      return true;
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
      if (!r) card.state = 'expired';
      changed();
      return !!r;
    },
    async stop() { return !!(await call('agent.stop')); },
    async resume() { const r = await call('agent.resume'); if (r) { state.killed = false; changed(); } return !!r; },
    async forget(id) { return state.canMemory ? !!(await call('agent.memory.forget', { id })) : false; }
  };
}
