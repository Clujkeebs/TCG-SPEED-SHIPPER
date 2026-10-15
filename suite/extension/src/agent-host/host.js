// Hosts the REAL Agent engine (vendored from suite/agent) for practice mode, on the made-up shop.
// The service worker calls handle(); events go back through `emit`. Nothing here talks to a network,
// and the only "act" tool changes made-up data in memory.
//
// Extra on top of the vendored protocol (PROPOSED additions, removed here once suite/agent/protocol.js
// has them): a practice plan (agent.plan) and a practice memory (agent.memory, agent.memory.list,
// agent.memory.forget). They are handled before the engine sees the message and only for a trusted sender.
import { createRegistry } from '../vendor/agent/registry.js';
import { createAuditLog } from '../vendor/agent/audit.js';
import { registerAll } from '../vendor/agent/tools/index.js';
import { createAgentService, isTrustedSender, makeResponse, makeError, makeEvent, MESSAGE_TYPES, PANEL_SOURCE, PROTOCOL_VERSION } from '../vendor/agent/protocol.js';
import { makeShop } from './shop.js';
import { createPracticeModel, routeFor, sayFor } from './practice-model.js';
import { memoryStatePersist, cleanState } from './persist.js';

const EXTRA_TYPES = ['agent.memory.list', 'agent.memory.forget'];
const MAX_MEMORY = 50;

export function createPracticeHost({ extensionId, shop = makeShop(), persist = memoryStatePersist(), auditStore } = {}) {
  const audit = createAuditLog(auditStore ? { store: auditStore } : {});
  const registry = registerAll(createRegistry({ audit }), shop);
  registry.register({
    name: 'listing.setPrice', tier: 'act',
    description: 'Change the price of one listing (practice: only changes the made-up shop)',
    inputSchema: { type: 'object', properties: { printingId: { type: 'string' }, newPriceCents: { type: 'integer', minimum: 1, maximum: 100000 } }, required: ['printingId', 'newPriceCents'] },
    handler: (a) => {
      const item = shop.inventory.find((i) => i.printingId === a.printingId);
      const printing = shop.printings.find((p) => p.id === a.printingId);
      if (!item || !printing) throw new Error('no such listing in the practice shop');
      const oldPriceCents = item.priceCents;
      item.priceCents = a.newPriceCents;
      return { name: printing.name, oldPriceCents, newPriceCents: a.newPriceCents };
    }
  });

  let memory = [{ id: 'm1', text: 'Ships on Tuesdays and Fridays (practice fact)' }, { id: 'm2', text: 'Never lists anything under $0.25 (practice fact)' }];
  let memoryCounter = 2;
  let plan = null; // last plan shown: [{ text, state }]
  let pending = null; // an approval waiting for the seller: survives the worker going to sleep
  const service = createAgentService({ registry, model: createPracticeModel(), extensionId, system: 'practice mode' });

  const snapshot = () => ({
    memory, memoryCounter, plan, pending, killed: registry.limits.isKilled(),
    prices: Object.fromEntries(shop.inventory.map((i) => [i.printingId, i.priceCents]))
  });
  const save = () => persist.save(snapshot());

  // Restore whatever was saved before the worker last went to sleep. Every message waits for this.
  const ready = (async () => {
    const saved = cleanState(await persist.load());
    if (!saved) return;
    memory = saved.memory.length || saved.memoryCounter ? saved.memory : memory;
    memoryCounter = saved.memoryCounter;
    plan = saved.plan;
    pending = saved.pending;
    if (saved.killed) registry.limits.kill('restored: stopped before the worker slept');
    for (const item of shop.inventory) if (saved.prices[item.printingId]) item.priceCents = saved.prices[item.printingId];
  })();

  const memoryEvent = () => makeEvent('agent.memory', { items: memory.map((m) => ({ ...m })) });

  async function handle(msg, sender, emit = () => {}) {
    await ready;
    const trusted = isTrustedSender(sender, extensionId);
    const known = msg && typeof msg === 'object' && msg.source === PANEL_SOURCE && msg.v === PROTOCOL_VERSION && typeof msg.id === 'string' && msg.id.length <= 80;

    if (trusted && known && EXTRA_TYPES.includes(msg.type) && !MESSAGE_TYPES.includes(msg.type)) {
      if (msg.type === 'agent.memory.list') {
        emit(memoryEvent());
        if (pending && !service.busy) { emit(makeEvent('agent.approval-needed', { approvalId: pending.approvalId, tool: pending.tool, description: pending.description, args: pending.args })); }
        if (plan && !service.busy) emit(makeEvent('agent.plan', { steps: plan }));
        return makeResponse(msg.id, { count: memory.length });
      }
      const id = msg.payload && msg.payload.id;
      if (typeof id !== 'string' || !id || id.length > 80) return makeError(msg.id, 'agent.memory.forget: id is required');
      memory = memory.filter((m) => m.id !== id);
      await save();
      emit(memoryEvent());
      return makeResponse(msg.id, { forgotten: true });
    }

    // "remember ..." is handled by the host: it stores a fact the seller can see and forget.
    if (trusted && known && msg.type === 'agent.ask' && msg.payload && typeof msg.payload.text === 'string') {
      const m = /^\s*remember(?: that)?\s+(.{3,280})$/is.exec(msg.payload.text);
      if (m && !service.busy) {
        if (memory.length >= MAX_MEMORY) return makeError(msg.id, 'memory is full; forget something first');
        memory.push({ id: 'm' + ++memoryCounter, text: m[1].trim() });
        await save();
        queueMicrotask(() => { emit(memoryEvent()); emit(makeEvent('agent.answer', { status: 'done', text: 'Got it. I will remember that.', calls: [] })); });
        return makeResponse(msg.id, { started: true });
      }
    }

    // A waiting approval whose run died with the worker: the seller's click finishes it here.
    if (trusted && known && msg.type === 'agent.approve' && pending && msg.payload && msg.payload.approvalId === pending.approvalId && !service.busy) {
      const p = pending;
      pending = null;
      const approved = msg.payload.approved === true;
      const out = await registry.run(p.tool, p.args, {
        actor: 'agent', run: registry.limits.newRun(),
        approve: async () => (approved ? { approved: true, by: 'user' } : false)
      });
      emit(makeEvent('agent.progress', { tool: p.tool, ok: out.ok, denied: !!out.denied }));
      plan = (plan ?? p.steps.map((text) => ({ text, state: 'doing' }))).map((st, i, all) => ({ text: st.text, state: i === all.length - 1 && !approved ? 'skipped' : 'done' }));
      emit(makeEvent('agent.plan', { steps: plan }));
      await save();
      emit(makeEvent('agent.answer', { status: 'done', text: sayFor(p.tool, out.ok ? out.result : { error: out.error }), calls: [p.tool] }));
      return makeResponse(msg.id, { recorded: true });
    }

    let planWrap = emit;
    if (trusted && known && msg.type === 'agent.ask' && msg.payload && typeof msg.payload.text === 'string' && !service.busy) {
      pending = null; // a new goal replaces any approval left over from before
      const steps = routeFor(msg.payload.text).plan;
      let done = 0;
      const setPlan = (doneCount, final) => {
        plan = steps.map((text, i) => ({ text, state: i < doneCount ? 'done' : i === doneCount ? 'doing' : 'todo' })).map((st, i) => (final === 'skipped' && i === steps.length - 1 ? { ...st, state: 'skipped' } : st));
        emit(makeEvent('agent.plan', { steps: plan }));
        return save();
      };
      setPlan(0);
      planWrap = (e) => {
        if (e.event === 'agent.progress') setPlan(++done);
        if (e.event === 'agent.approval-needed') {
          pending = { approvalId: e.approvalId, tool: e.tool, description: e.description, args: e.args, steps };
          save();
        }
        if (e.event === 'agent.answer') {
          const denied = e.calls.length === 0 || /did not change/.test(e.text || '');
          plan = steps.map((text, i) => ({ text, state: denied && i === steps.length - 1 && steps.length > 2 ? 'skipped' : 'done' }));
          emit(makeEvent('agent.plan', { steps: plan }));
          pending = null;
          save();
        }
        if (e.event === 'agent.stopped') { pending = null; save(); }
        emit(e);
      };
    }

    const res = await service.handle(msg, sender, planWrap);
    if (res.ok && (msg.type === 'agent.stop' || msg.type === 'agent.resume')) await save();
    if (res.ok && msg.type === 'agent.hello' && trusted) {
      res.result = { ...res.result, types: [...new Set([...res.result.types, ...EXTRA_TYPES])] };
    }
    return res;
  }

  // Erase everything the practice Agent keeps (state and audit trail). Used by "Clear everything".
  async function clearAll() {
    await ready;
    await persist.clear();
    memory = []; memoryCounter = 0; plan = null; pending = null;
  }

  return { handle, registry, shop, ready, clearAll, snapshot, get busy() { return service.busy; } };
}
