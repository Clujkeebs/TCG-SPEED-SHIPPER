// Hosts the REAL Agent engine (vendored from suite/agent) for practice mode, on the made-up shop.
// The service worker calls handle(); events go back through `emit`. Nothing here talks to a network,
// and the only "act" tool changes made-up data in memory.
//
// Extra on top of the vendored protocol (PROPOSED additions, removed here once suite/agent/protocol.js
// has them): a practice plan (agent.plan) and a practice memory (agent.memory, agent.memory.list,
// agent.memory.forget). They are handled before the engine sees the message and only for a trusted sender.
import { createRegistry } from '../vendor/agent/registry.js';
import { registerAll } from '../vendor/agent/tools/index.js';
import { createAgentService, isTrustedSender, makeResponse, makeError, makeEvent, MESSAGE_TYPES, PANEL_SOURCE, PROTOCOL_VERSION } from '../vendor/agent/protocol.js';
import { makeShop } from './shop.js';
import { createPracticeModel, routeFor } from './practice-model.js';

const EXTRA_TYPES = ['agent.memory.list', 'agent.memory.forget'];
const MAX_MEMORY = 50;

export function createPracticeHost({ extensionId, shop = makeShop() } = {}) {
  const registry = registerAll(createRegistry(), shop);
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
  const service = createAgentService({ registry, model: createPracticeModel(), extensionId, system: 'practice mode' });

  const memoryEvent = () => makeEvent('agent.memory', { items: memory.map((m) => ({ ...m })) });

  async function handle(msg, sender, emit = () => {}) {
    const trusted = isTrustedSender(sender, extensionId);
    const known = msg && typeof msg === 'object' && msg.source === PANEL_SOURCE && msg.v === PROTOCOL_VERSION && typeof msg.id === 'string' && msg.id.length <= 80;

    if (trusted && known && EXTRA_TYPES.includes(msg.type) && !MESSAGE_TYPES.includes(msg.type)) {
      if (msg.type === 'agent.memory.list') { emit(memoryEvent()); return makeResponse(msg.id, { count: memory.length }); }
      const id = msg.payload && msg.payload.id;
      if (typeof id !== 'string' || !id || id.length > 80) return makeError(msg.id, 'agent.memory.forget: id is required');
      memory = memory.filter((m) => m.id !== id);
      emit(memoryEvent());
      return makeResponse(msg.id, { forgotten: true });
    }

    // "remember ..." is handled by the host: it stores a fact the seller can see and forget.
    if (trusted && known && msg.type === 'agent.ask' && msg.payload && typeof msg.payload.text === 'string') {
      const m = /^\s*remember(?: that)?\s+(.{3,280})$/is.exec(msg.payload.text);
      if (m && !service.busy) {
        if (memory.length >= MAX_MEMORY) return makeError(msg.id, 'memory is full; forget something first');
        memory.push({ id: 'm' + ++memoryCounter, text: m[1].trim() });
        queueMicrotask(() => { emit(memoryEvent()); emit(makeEvent('agent.answer', { status: 'done', text: 'Got it. I will remember that.', calls: [] })); });
        return makeResponse(msg.id, { started: true });
      }
    }

    let planWrap = emit;
    if (trusted && known && msg.type === 'agent.ask' && msg.payload && typeof msg.payload.text === 'string' && !service.busy) {
      const steps = routeFor(msg.payload.text).plan;
      let done = 0;
      const plan = (doneCount, final) => emit(makeEvent('agent.plan', { steps: steps.map((text, i) => ({ text, state: i < doneCount ? 'done' : i === doneCount ? 'doing' : 'todo' })).map((s, i) => (final === 'skipped' && i === steps.length - 1 ? { ...s, state: 'skipped' } : s)) }));
      plan(0);
      planWrap = (e) => {
        if (e.event === 'agent.progress') plan(++done);
        if (e.event === 'agent.answer') {
          const denied = e.calls.length === 0 || /did not change/.test(e.text || '');
          emit(makeEvent('agent.plan', { steps: steps.map((text, i) => ({ text, state: denied && i === steps.length - 1 && steps.length > 2 ? 'skipped' : 'done' })) }));
        }
        emit(e);
      };
    }

    const res = await service.handle(msg, sender, planWrap);
    if (res.ok && msg.type === 'agent.hello' && trusted) {
      res.result = { ...res.result, types: [...new Set([...res.result.types, ...EXTRA_TYPES])] };
    }
    return res;
  }

  return { handle, registry, shop, get busy() { return service.busy; } };
}
