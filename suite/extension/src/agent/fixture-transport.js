// A practice Agent connection on made-up data. Nothing here is real and nothing changes anything.
// transport.request(msg) -> Promise<response>; transport.onEvent(fn) registers the event listener.
// It follows the real protocol (suite/agent/protocol.js) including the proposed plan and memory parts.
import { PANEL_SOURCE, AGENT_SOURCE, PROTOCOL_VERSION as v } from './protocol.js';

export function createFixtureTransport({ delay = 0 } = {}) {
  let listener = () => {};
  let pending = null;
  let busy = false;
  let killed = false;
  let memory = [
    { id: 'm1', text: 'Ships on Tuesdays and Fridays (practice fact)' },
    { id: 'm2', text: 'Never lists anything under $0.25 (practice fact)' }
  ];
  const later = (fn) => setTimeout(fn, delay);
  const emit = (event, data = {}) => later(() => listener({ source: AGENT_SOURCE, v, event, ...data }));
  const ok = (id, result) => ({ source: AGENT_SOURCE, v, id, ok: true, result });
  const err = (id, error) => ({ source: AGENT_SOURCE, v, id, ok: false, error });
  const plan = (states) => emit('agent.plan', { steps: ['Look at recent orders', 'Work out the change', 'Ask you before changing anything'].map((text, i) => ({ text, state: states[i] })) });

  async function request(m) {
    if (!m || m.source !== PANEL_SOURCE || m.v !== v || typeof m.id !== 'string') return err(m && m.id, 'bad request');
    switch (m.type) {
      case 'agent.hello':
        return ok(m.id, { v, types: ['agent.hello', 'agent.ask', 'agent.approve', 'agent.stop', 'agent.resume', 'agent.limits', 'agent.audit', 'agent.memory.list', 'agent.memory.forget'], tools: [{ name: 'orders.stats', tier: 'read' }, { name: 'listing.setPrice', tier: 'act' }], killed });
      case 'agent.ask': {
        if (killed) return err(m.id, 'the kill switch is on; send agent.resume first');
        if (busy) return err(m.id, 'the agent is already working on something');
        busy = true;
        const wantsChange = /price|reprice|cheaper/i.test(m.payload.text);
        plan(['doing', 'todo', 'todo']);
        emit('agent.progress', { tool: 'orders.stats', ok: true, denied: false });
        if (wantsChange) {
          plan(['done', 'doing', 'todo']);
          pending = 'ap-1';
          emit('agent.approval-needed', { approvalId: pending, tool: 'listing.setPrice', description: 'Change one listing price (practice only: nothing is changed)', args: { card: 'Sample Card A', oldPriceCents: 150, newPriceCents: 135 } });
        } else {
          plan(['done', 'done', 'done']);
          emit('agent.answer', { status: 'done', text: 'Practice answer: 42 orders shipped in the last 30 days, 9 to repeat buyers. (Made-up numbers.)', calls: ['orders.stats'] });
          busy = false;
        }
        return ok(m.id, { started: true });
      }
      case 'agent.approve': {
        if (m.payload.approvalId !== pending) return err(m.id, 'no such approval waiting');
        pending = null;
        busy = false;
        plan(['done', 'done', m.payload.approved ? 'done' : 'skipped']);
        emit('agent.answer', { status: 'done', text: m.payload.approved ? 'Approved. In practice mode nothing was changed.' : 'Okay, I did not change anything.', calls: ['orders.stats'] });
        return ok(m.id, { recorded: true });
      }
      case 'agent.stop':
        killed = true; pending = null; busy = false;
        emit('agent.stopped');
        return ok(m.id, { killed: true });
      case 'agent.resume':
        killed = false;
        return ok(m.id, { killed: false });
      case 'agent.memory.list':
        emit('agent.memory', { items: memory });
        return ok(m.id, { count: memory.length });
      case 'agent.memory.forget':
        memory = memory.filter((i) => i.id !== m.payload.id);
        emit('agent.memory', { items: memory });
        return ok(m.id, { forgotten: true });
      default:
        return err(m.id, 'unknown type');
    }
  }
  return { request, onEvent: (fn) => { listener = fn; } };
}
