// Hosts the REAL Agent core (vendored from suite/agent: planner, plans, memory, approval inbox, jobs,
// suggestions) for practice mode, over a made-up shop. The service worker calls handle() for panel messages
// and tick() once a minute for background jobs. Nothing here touches a network.
//
// Everything the seller would lose if the worker went to sleep is saved (persist.js) and restored:
// memory, waiting approval cards (same ids), the last plan, the stop switch, saved jobs and their reports,
// and the shop's price changes. The audit trail goes to IndexedDB through the Agent's own store.
//
// Extension-only requests (not part of the Agent protocol) all start with "ext.": the jobs list and the
// sample jobs. They are answered only for our own extension pages.
import { createRegistry } from '../vendor/agent/registry.js';
import { createAuditLog } from '../vendor/agent/audit.js';
import { createLimits } from '../vendor/agent/limits.js';
import { registerAll } from '../vendor/agent/tools/index.js';
import { createShopMemory } from '../vendor/agent/memory.js';
import { createInbox } from '../vendor/agent/inbox.js';
import { createRulePlanner } from '../vendor/agent/planner.js';
import { createAgent } from '../vendor/agent/agent.js';
import { createAutomationStore, validateSaved, parseCron } from '../vendor/agent/automations.js';
import { newJob, tickJobs } from '../vendor/agent/jobs.js';
import { createAgentService, isTrustedSender, makeResponse, makeError, makeEvent, PANEL_SOURCE, PROTOCOL_VERSION } from '../vendor/agent/protocol.js';
import { makeShop } from './shop.js';
import { memoryStatePersist, cleanState } from './persist.js';

const SAMPLE_JOBS = {
  daily: { name: 'Morning stock check (practice)', cron: '0 9 * * *', when: 'Every morning at 9:00' },
  minute: { name: 'Stock check every minute (demo)', cron: '* * * * *', when: 'Every minute (a demo, so you can watch it work)' }
};
const MAX_JOBS = 5;
const MAX_REPORTS = 30;
const STEPS = [
  { tool: 'inventory.restock', args: { windowDays: 60 } },
  { tool: 'inventory.setPrices', args: { changes: [{ printingId: 'mtg:practice:p2', condition: 'NM', finish: 'nonfoil', priceCents: 70 }] } }
];

export function createPracticeHost({ extensionId, shop = makeShop(), persist = memoryStatePersist(), auditStore, now = () => new Date(), onBadge = () => {}, loadOrders } = {}) {
  const shopNow = () => shop.now; // the made-up shop lives on a fixed day so the numbers stay sensible
  const audit = createAuditLog(auditStore ? { store: auditStore, now } : { now });
  const limits = createLimits({ now });
  const registry = createRegistry({ audit, limits });
  const memory = createShopMemory({ now });
  const automations = createAutomationStore();
  registerAll(registry, { orders: shop.orders, inventory: shop.inventory, printings: shop.printings, messages: shop.messages, memory, automations, now: shopNow });

  // ---- reports (the Agent's store has no way to load saved ones, so we keep the log)
  let repCounter = 0;
  let reportLog = [];
  const reports = {
    add(r) { const row = { id: 'rep-' + ++repCounter, ranAt: now().toISOString(), ...r }; reportLog.push(row); reportLog = reportLog.slice(-MAX_REPORTS); return structuredClone(row); },
    list: () => structuredClone(reportLog),
    get: (id) => structuredClone(reportLog.find((r) => r.id === id))
  };

  // ---- inbox with ids that stay the same across restarts
  const inner = createInbox({ registry, now });
  const ledger = new Map(); // xid -> { xid, innerId|null, status, spec, undo?, restored? }
  const xidOf = new Map(); // innerId -> xid
  let xCounter = 0;
  const entry = (xid) => { const e = ledger.get(xid); if (!e) throw new Error('no such card ' + xid); return e; };
  const synthetic = (e) => ({ id: e.xid, status: e.status, tool: e.spec.tool, args: e.spec.args, what: e.spec.tool, why: e.spec.why, expected: '', undoText: '', actor: e.spec.actor, ...(e.undo ? { undo: e.undo } : {}), ...(e.spec.planId ? { planId: e.spec.planId } : {}), ...(e.spec.stepId ? { stepId: e.spec.stepId } : {}) });
  const inbox = {
    propose(spec) {
      const card = inner.propose(spec);
      const xid = 'card-' + ++xCounter;
      ledger.set(xid, { xid, innerId: card.id, status: 'pending', spec: { tool: spec.tool, args: structuredClone(spec.args), why: spec.why, actor: spec.actor || 'agent', ...(spec.planId ? { planId: spec.planId } : {}), ...(spec.stepId ? { stepId: spec.stepId } : {}) } });
      xidOf.set(card.id, xid);
      return { ...card, id: xid };
    },
    list(opts) { return inner.list(opts).map((c) => ({ ...c, id: xidOf.get(c.id) ?? c.id })); },
    get(xid) { const e = entry(xid); return e.innerId ? { ...inner.get(e.innerId), id: xid } : synthetic(e); },
    async approve(xid, o) {
      const e = entry(xid);
      if (!e.innerId) throw new Error('card ' + xid + ' is ' + e.status + ', not pending');
      const c = await inner.approve(e.innerId, o);
      e.status = c.status;
      if (c.undo) e.undo = { tool: c.undo.tool, args: structuredClone(c.undo.args) };
      return { ...c, id: xid };
    },
    decline(xid) {
      const e = entry(xid);
      if (!e.innerId) throw new Error('card ' + xid + ' is ' + e.status + ', not pending');
      const c = inner.decline(e.innerId);
      e.status = c.status;
      return { ...c, id: xid };
    },
    async undo(xid, o = {}) {
      const e = entry(xid);
      if (e.innerId) {
        const c = await inner.undo(e.innerId, o);
        e.status = c.status;
        return { ...c, id: xid };
      }
      // A finished card from before a restart: run the saved reverse change through the registry (limits, kill switch, audit).
      if (e.status !== 'done' || !e.undo) throw new Error('this change cannot be undone automatically');
      if (registry.limits.isKilled()) throw new Error('the kill switch is on; resume first');
      const out = await registry.run(e.undo.tool, e.undo.args, { actor: 'user', approve: async () => ({ approved: true, by: (o.by || 'user') + ':undo' }) });
      if (!out.ok) throw new Error('undo failed: ' + out.error);
      e.status = 'undone';
      return synthetic(e);
    },
    pendingCount: () => inner.pendingCount()
  };

  const planner = createRulePlanner({ registry, memory, now: shopNow });
  const agent = createAgent({ registry, memory, inbox, planner, reports, now: shopNow });
  const service = createAgentService({ registry, extensionId, agent });

  // The shop's orders are made up until the seller imports their own file (kept on this device).
  const practice = { orders: shop.orders.slice(), messages: shop.messages.slice(), now: shop.now };
  let usingImported = false;
  async function applyOrders(mode) {
    if (mode === 'imported') {
      const list = loadOrders ? await loadOrders() : [];
      if (!list.length) return false;
      shop.orders.splice(0, shop.orders.length, ...list);
      shop.messages.splice(0, shop.messages.length); // buyer messages are not in an order file
      // The Agent measures "this week" up to "now": use the newest order in the file, so an older file still makes sense.
      shop.now = new Date(Math.max(...list.map((o) => Date.parse(o.orderedAt))) + 12 * 3600000).toISOString();
      usingImported = true;
    } else {
      shop.orders.splice(0, shop.orders.length, ...practice.orders);
      shop.messages.splice(0, shop.messages.length, ...practice.messages);
      shop.now = practice.now;
      usingImported = false;
    }
    return true;
  }

  let lastPlan = null; // { planId, steps: [{ text, state }] }
  let jobCounter = 0;

  const snapshot = () => ({
    memory: memory.exportJson(),
    ledger: [...ledger.values()].map(({ xid, status, spec, undo }) => ({ xid, status, spec, ...(undo ? { undo } : {}) })),
    xCounter, plan: lastPlan, killed: limits.isKilled(),
    prices: Object.fromEntries(shop.inventory.map((i) => [`${i.printingId}|${i.condition}|${i.finish}`, i.priceCents])),
    jobs: automations.list(), reports: reportLog, repCounter, jobCounter, usingImported
  });
  const save = () => persist.save(snapshot());
  const badge = () => { try { onBadge(inbox.pendingCount()); } catch { /* the badge is a nicety */ } };

  // ---- restore whatever was saved before the worker last went to sleep. Every message waits for this.
  const ready = (async () => {
    const saved = cleanState(await persist.load());
    if (!saved) {
      memory.add({ text: 'Ships on Tuesdays and Fridays (practice fact)', source: 'user' });
      memory.add({ text: 'Never lists anything under $0.25 (practice fact)', source: 'user' });
      return;
    }
    if (saved.memory) { try { memory.importJson(saved.memory); } catch { /* ignore a damaged memory; start empty */ } }
    for (const j of saved.jobs) { if (validateSaved(j).ok) automations.save(j); }
    reportLog = saved.reports; repCounter = saved.repCounter; jobCounter = saved.jobCounter;
    xCounter = saved.xCounter;
    for (const e of saved.ledger) {
      const restored = { ...e, innerId: null };
      if (e.status === 'pending') {
        try { const c = inner.propose({ ...e.spec }); restored.innerId = c.id; xidOf.set(c.id, e.xid); restored.restored = true; } catch { restored.status = 'expired'; }
      }
      ledger.set(e.xid, restored);
    }
    lastPlan = saved.plan;
    if (saved.usingImported) { try { await applyOrders('imported'); } catch { /* fall back to the practice orders */ } }
    if (saved.killed) limits.kill('restored: stopped before the worker slept');
    for (const i of shop.inventory) { const p = saved.prices[`${i.printingId}|${i.condition}|${i.finish}`]; if (p) i.priceCents = p; }
    badge();
  })();

  const cardEvent = (c) => makeEvent('agent.approval-needed', { approvalId: c.id, tool: c.tool, description: c.what, why: c.why, undo: c.undoText, expected: c.expected, args: c.args });
  const wrapEmit = (emit) => (e) => {
    if (e.event === 'agent.plan') lastPlan = { planId: e.planId, steps: e.steps.map((s) => ({ text: s.text, state: s.state })) };
    emit(e);
    save();
    badge();
  };

  // ---- extension-only requests ("ext.*")
  const when = (a) => (Object.values(SAMPLE_JOBS).find((s) => s.cron === a.trigger.value)?.when) ?? (a.trigger.type === 'cron' ? 'On a schedule' : 'When something happens');
  const jobView = (a) => ({ id: a.id, name: a.name, when: when(a), enabled: a.enabled, ...(a.lastRunAt ? { lastRunAt: a.lastRunAt } : {}) });
  const audited = (tool, args) => registry.audit.record({ actor: 'user', tool, tier: 'act', args, outcome: 'ok', approvedBy: 'user' });

  async function ext(msg, emit) {
    const p = msg.payload;
    const isId = (v) => typeof v === 'string' && /^[a-zA-Z0-9._-]{1,80}$/.test(v);
    switch (msg.type) {
      case 'ext.orders.use': {
        const mode = p && p.mode;
        if (mode !== 'imported' && mode !== 'practice') return makeError(msg.id, 'mode must be imported or practice');
        if (!(await applyOrders(mode))) return makeError(msg.id, 'There are no imported orders to use.');
        await audited('orders.use', { mode });
        await save();
        return makeResponse(msg.id, { mode, orders: shop.orders.length });
      }
      case 'ext.orders.status':
        return makeResponse(msg.id, { mode: usingImported ? 'imported' : 'practice', orders: shop.orders.length });
      case 'ext.jobs.list':
        return makeResponse(msg.id, { jobs: automations.list().map(jobView), reports: reportLog.slice(-10).map(({ id, jobId, title, text, ranAt, cardIds }) => ({ id, jobId, title, text, ranAt, cardIds })) });
      case 'ext.jobs.add': {
        const kind = p && p.kind;
        if (!SAMPLE_JOBS[kind]) return makeError(msg.id, 'kind must be one of ' + Object.keys(SAMPLE_JOBS).join(', '));
        if (automations.list().length >= MAX_JOBS) return makeError(msg.id, 'There are already ' + MAX_JOBS + ' jobs. Remove one first.');
        const s = SAMPLE_JOBS[kind];
        if (!parseCron(s.cron)) return makeError(msg.id, 'bad schedule');
        const job = newJob({ id: 'practice-job-' + ++jobCounter, name: s.name, trigger: { type: 'cron', value: s.cron }, steps: STEPS.map((x) => structuredClone(x)) });
        const v = validateSaved(job);
        if (!v.ok) return makeError(msg.id, v.errors.join('; '));
        automations.save(job);
        await audited('job.add', { id: job.id });
        await save();
        return makeResponse(msg.id, { job: jobView(job) });
      }
      case 'ext.jobs.toggle':
        if (!p || !isId(p.id) || typeof p.enabled !== 'boolean' || !automations.get(p.id)) return makeError(msg.id, 'no such job');
        automations.setEnabled(p.id, p.enabled);
        await audited('job.toggle', { id: p.id, enabled: p.enabled });
        await save();
        return makeResponse(msg.id, { ok: true });
      case 'ext.jobs.remove':
        if (!p || !isId(p.id) || !automations.get(p.id)) return makeError(msg.id, 'no such job');
        automations.remove(p.id);
        await audited('job.remove', { id: p.id });
        await save();
        return makeResponse(msg.id, { ok: true });
      default:
        return makeError(msg.id, 'unknown type');
    }
  }

  async function handle(msg, sender, emit = () => {}) {
    await ready;
    const trusted = isTrustedSender(sender, extensionId);
    const known = msg && typeof msg === 'object' && msg.source === PANEL_SOURCE && msg.v === PROTOCOL_VERSION && typeof msg.id === 'string' && msg.id.length > 0 && msg.id.length <= 80;
    if (trusted && known && typeof msg.type === 'string' && msg.type.startsWith('ext.')) return ext(msg, wrapEmit(emit));

    const out = wrapEmit(emit);
    const cardId = known && msg.type === 'agent.approve' && msg.payload ? msg.payload.approvalId : undefined;
    const wasRestored = trusted && typeof cardId === 'string' && ledger.get(cardId)?.restored === true && ledger.get(cardId).status === 'pending';
    const res = await service.handle(msg, sender, out);

    // A card that was restored after a sleep has no live plan behind it: finish the plan's last step ourselves.
    if (wasRestored && res.ok) {
      const e = ledger.get(cardId);
      e.restored = false;
      const idx = Number(String(e.spec.stepId ?? '').replace(/^s/, '')) - 1;
      if (lastPlan && lastPlan.planId === e.spec.planId && lastPlan.steps[idx]) {
        lastPlan.steps[idx].state = e.status === 'done' ? 'done' : 'skipped';
        out(makeEvent('agent.plan', { planId: lastPlan.planId, steps: lastPlan.steps }));
        if (!lastPlan.steps.some((s) => s.state === 'doing' || s.state === 'todo')) {
          out(makeEvent('agent.answer', { status: 'done', text: e.status === 'done' ? 'All the steps are finished.' : 'Finished. You declined the last step, so nothing was changed.', calls: [e.spec.tool] }));
        }
      }
    }
    // The panel asks for memory when it opens: also bring back the last plan so a fresh panel shows it.
    if (res.ok && msg.type === 'agent.memory.list' && lastPlan && !service.busy) out(makeEvent('agent.plan', { planId: lastPlan.planId, steps: lastPlan.steps }));
    await save();
    badge();
    return res;
  }

  // Once a minute (from chrome.alarms): run every job whose time has come. Act steps become waiting cards.
  async function tick(emit = () => {}) {
    await ready;
    const results = await tickJobs({ store: automations, registry, inbox, reports, now: now().toISOString() });
    const out = wrapEmit(emit);
    for (const r of results) for (const id of (r.report && r.report.cardIds) || []) out(cardEvent(inbox.get(id)));
    await save();
    badge();
    return results.map((r) => ({ ok: r.ok, skipped: r.skipped, reportId: r.report && r.report.id }));
  }

  // Erase everything the practice Agent keeps (state; the audit database is emptied by clear.js).
  async function clearAll() {
    await ready;
    await persist.clear();
    ledger.clear(); xidOf.clear(); reportLog = [];
    await applyOrders('practice');
    for (const f of memory.list()) memory.delete(f.id);
    for (const a of automations.list()) automations.remove(a.id);
    lastPlan = null;
    badge();
  }

  return { handle, tick, ready, clearAll, snapshot, registry, shop, memory, inbox, automations, reports, get busy() { return service.busy; } };
}
