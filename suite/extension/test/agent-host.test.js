import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPracticeHost } from '../src/agent-host/host.js';
import { makeShop } from '../src/agent-host/shop.js';
import { memoryStatePersist, cleanState } from '../src/agent-host/persist.js';
import { createMemoryStore } from '../src/vendor/agent/audit.js';
import { validateEvent } from '../src/agent/protocol.js';

const ID = 'ext-test-id';
const sender = { id: ID, url: `chrome-extension://${ID}/src/ui/sidepanel.html` };
const stranger = { id: 'other', url: 'https://tcgspeedshipper.com/' };
let n = 0;
const req = (type, payload) => ({ source: 'tcgss-panel', v: 1, id: 'q' + ++n, type, ...(payload ? { payload } : {}) });
const P2 = 'mtg:practice:p2|NM|nonfoil';

// A "worker": a host that shares only what is saved (state + audit store) with earlier ones.
function world() {
  const persist = memoryStatePersist();
  const auditStore = createMemoryStore();
  const clock = { ms: Date.parse('2026-10-16T09:00:30Z') };
  const badges = [];
  const boot = () => {
    const host = createPracticeHost({ extensionId: ID, persist, auditStore, now: () => new Date(clock.ms), onBadge: (c) => badges.push(c) });
    const events = [];
    const emit = (e) => events.push(e);
    const wait = async (event, from = 0) => { for (let i = 0; i < 300; i++) { const e = events.slice(from).find((x) => x.event === event); if (e) return e; await new Promise((r) => setTimeout(r, 5)); } throw new Error('timed out waiting for ' + event); };
    const price = () => host.shop.inventory.find((i) => `${i.printingId}|${i.condition}|${i.finish}` === P2).priceCents;
    return { host, events, wait, price, send: (t, p, s = sender) => host.handle(req(t, p), s, emit), tick: () => host.tick(emit) };
  };
  return { boot, persist, auditStore, clock, badges };
}
const settle = () => new Promise((r) => setTimeout(r, 30));

test('the made-up shop is valid and has no real data', () => {
  const shop = makeShop();
  assert.ok(shop.orders.length >= 50 && shop.printings.length === 8 && shop.messages.length === 3);
  assert.ok(shop.orders.every((o) => o.id.startsWith('PRC-')));
});

test('hello announces plan, memory, inbox, suggestions and undo', async () => {
  const a = world().boot();
  const r = await a.send('agent.hello');
  for (const t of ['agent.plan', 'agent.memory', 'agent.memory.list', 'agent.memory.forget', 'agent.inbox.list', 'agent.suggestions', 'agent.undo']) assert.ok(r.result.types.includes(t), t);
  assert.ok(r.result.tools.some((t) => t.tier === 'act'));
});

test('a goal becomes a visible plan with plain progress lines, and an audit trail', async () => {
  const w = world(); const a = w.boot();
  await a.send('agent.ask', { text: 'Who are my repeat customers?' });
  const answer = await a.wait('agent.answer');
  assert.equal(answer.status, 'done');
  const plans = a.events.filter((e) => e.event === 'agent.plan');
  assert.ok(plans.length >= 3 && plans.at(-1).steps.every((s) => s.state === 'done'));
  assert.ok(a.events.some((e) => e.event === 'agent.progress' && e.summary));
  assert.ok((await w.auditStore.list()).length >= 1);
  assert.ok(a.events.every((e) => validateEvent(e).ok), 'the panel accepts every event');
});

test('a price goal waits as a card with what, why, undo; approve changes the shop; undo puts it back', async () => {
  const a = world().boot();
  const before = a.price();
  await a.send('agent.ask', { text: 'Reprice my cards 5% under market' });
  const card = await a.wait('agent.approval-needed');
  assert.ok(card.description && card.why && card.undo && card.expected);
  assert.equal(a.price(), before, 'nothing changed before the click');
  assert.equal((await a.send('agent.approve', { approvalId: card.approvalId, approved: true })).result.status, 'done');
  assert.notEqual(a.price(), before);
  assert.equal((await a.send('agent.approve', { approvalId: card.approvalId, approved: true })).ok, false, 'answers once');
  assert.equal((await a.send('agent.undo', { approvalId: card.approvalId })).ok, true);
  assert.equal(a.price(), before, 'undo restored the price');
  const log = await a.host.registry.audit.list();
  assert.ok(log.some((e) => e.tool === 'inventory.setPrices' && e.tier === 'act' && e.outcome === 'ok' && e.approvedBy === 'user'));
});

test('declining changes nothing; Stop keeps the card waiting and blocks approval until Resume', async () => {
  const a = world().boot();
  const before = a.price();
  await a.send('agent.ask', { text: 'Reprice my cards 5% under market' });
  const card = await a.wait('agent.approval-needed');
  await a.send('agent.stop');
  const blocked = await a.send('agent.approve', { approvalId: card.approvalId, approved: true });
  assert.equal(blocked.ok, false);
  assert.match(blocked.error, /kill switch/);
  assert.equal(a.price(), before);
  await a.send('agent.resume');
  assert.equal((await a.send('agent.approve', { approvalId: card.approvalId, approved: false })).result.status, 'declined');
  assert.equal(a.price(), before);
});

test('memory: "remember" is a card; forgetting is immediate; only the extension itself may ask', async () => {
  const a = world().boot();
  await a.send('agent.ask', { text: 'remember that I close on Sundays' });
  const card = await a.wait('agent.approval-needed');
  await a.send('agent.approve', { approvalId: card.approvalId, approved: true });
  const mem = await a.wait('agent.memory');
  const fact = mem.items.find((m) => /Sundays/.test(m.text));
  assert.ok(fact);
  assert.equal((await a.send('agent.memory.forget', { id: fact.id })).ok, true);
  assert.ok(!(await a.send('agent.memory.list')).result.items.some((m) => m.id === fact.id));
  assert.equal((await a.send('agent.memory.list', undefined, stranger)).ok, false);
  assert.equal((await a.send('agent.ask', { text: 'x' }, stranger)).ok, false);
  assert.equal((await a.send('ext.jobs.list', undefined, stranger)).ok, false);
});

test('"five things worth doing" come from the shop and carry a goal to tap', async () => {
  const a = world().boot();
  const r = await a.send('agent.suggestions');
  assert.ok(r.result.suggestions.length >= 2 && r.result.suggestions.length <= 5);
  assert.ok(r.result.suggestions.every((s) => s.title && s.why));
  assert.ok(r.result.suggestions.some((s) => typeof s.goal === 'string'));
});

test('restart: a waiting card keeps its id, finishes the plan when approved, and the change survives another restart', async () => {
  const w = world();
  const a = w.boot();
  const before = a.price();
  await a.send('agent.ask', { text: 'Reprice my cards 5% under market' });
  const card = await a.wait('agent.approval-needed');

  const b = w.boot(); // the worker slept
  const inbox = await b.send('agent.inbox.list');
  assert.deepEqual(inbox.result.cards.map((c) => c.approvalId), [card.approvalId], 'same card, same id');
  await b.send('agent.memory.list');
  assert.ok(b.events.some((e) => e.event === 'agent.plan'), 'the last plan comes back');
  assert.equal(b.price(), before);
  assert.equal((await b.send('agent.approve', { approvalId: card.approvalId, approved: true })).ok, true);
  const plan = b.events.filter((e) => e.event === 'agent.plan').at(-1);
  assert.ok(plan.steps.every((s) => s.state === 'done'), 'the plan is finished');
  assert.equal((await b.wait('agent.answer')).status, 'done');
  const changed = b.price();
  assert.notEqual(changed, before);

  const c = w.boot(); // and again: price survived, and so does Undo for the finished card
  await c.host.ready;
  assert.equal(c.price(), changed);
  assert.equal((await c.send('agent.undo', { approvalId: card.approvalId })).ok, true);
  assert.equal(c.price(), before);
  assert.ok((await w.auditStore.list()).filter((e) => e.tool === 'inventory.setPrices').length >= 2, 'approve and undo are both in the trail');
});

test('restart: memory and the stop switch survive; a restored card can be declined', async () => {
  const w = world();
  const a = w.boot();
  await a.send('agent.ask', { text: 'remember that I pack on Mondays' });
  const c1 = await a.wait('agent.approval-needed');
  await a.send('agent.approve', { approvalId: c1.approvalId, approved: true });
  await a.send('agent.ask', { text: 'Reprice my cards 5% under market' });
  const c2 = await a.wait('agent.approval-needed', a.events.findIndex((e) => e === c1) + 1);
  await a.send('agent.stop');
  const b = w.boot();
  assert.ok((await b.send('agent.memory.list')).result.items.some((m) => /Mondays/.test(m.text)));
  assert.equal((await b.send('agent.ask', { text: 'x' })).ok, false, 'still stopped');
  await b.send('agent.resume');
  assert.equal((await b.send('agent.approve', { approvalId: c2.approvalId, approved: false })).result.status, 'declined');
});

test('badge: counts waiting cards and clears when they are answered', async () => {
  const w = world(); const a = w.boot();
  await a.send('agent.ask', { text: 'Reprice my cards 5% under market' });
  const card = await a.wait('agent.approval-needed');
  assert.equal(w.badges.at(-1), 1);
  await a.send('agent.approve', { approvalId: card.approvalId, approved: true });
  assert.equal(w.badges.at(-1), 0);
});

test('background jobs: a saved job runs on schedule, leaves a report, queues a card; nothing changes without approval', async () => {
  const w = world(); const a = w.boot();
  const before = a.price();
  const added = await a.send('ext.jobs.add', { kind: 'minute' });
  assert.equal(added.ok, true);
  const ran = await a.tick();
  assert.equal(ran.length, 1);
  assert.equal(ran[0].ok, true);
  const list = (await a.send('ext.jobs.list')).result;
  assert.equal(list.reports.length, 1);
  assert.match(list.reports[0].text, /inventory\.restock/);
  const card = a.events.find((e) => e.event === 'agent.approval-needed');
  assert.ok(card && /Scheduled job/.test(card.why));
  assert.equal(a.price(), before, 'the job did not act on its own');
  assert.equal(w.badges.at(-1), 1);
  assert.equal((await a.tick()).length, 0, 'never twice in the same minute');
  w.clock.ms += 60000;
  assert.equal((await a.tick()).length, 1, 'next minute it runs again');
  assert.equal((await a.send('agent.approve', { approvalId: card.approvalId, approved: true })).result.status, 'done');
  assert.equal(a.price(), 70);
  const log = await a.host.registry.audit.list();
  assert.ok(log.some((e) => e.actor === 'automation'), 'job steps are audited as automation');
});

test('background jobs: a job fires after a restart (jobs are saved), a switched-off job does not, and Stop pauses jobs', async () => {
  const w = world();
  const a = w.boot();
  await a.send('ext.jobs.add', { kind: 'minute' });
  const b = w.boot(); // restart
  w.clock.ms += 60000;
  assert.equal((await b.tick()).length, 1, 'the saved job still fires');
  const id = (await b.send('ext.jobs.list')).result.jobs[0].id;
  await b.send('ext.jobs.toggle', { id, enabled: false });
  w.clock.ms += 60000;
  assert.equal((await b.tick()).length, 0, 'off means off');
  await b.send('ext.jobs.toggle', { id, enabled: true });
  await b.send('agent.stop');
  w.clock.ms += 60000;
  const skipped = await b.tick();
  assert.equal(skipped[0].skipped, 'kill switch is on');
  const reportsBefore = (await b.send('ext.jobs.list')).result.reports.length;
  assert.equal(reportsBefore, 1, 'no report while stopped');
  await b.send('ext.jobs.remove', { id });
  assert.equal((await b.send('ext.jobs.list')).result.jobs.length, 0);
});

test('jobs: bad requests are refused', async () => {
  const a = world().boot();
  assert.equal((await a.send('ext.jobs.add', { kind: 'every-second' })).ok, false);
  assert.equal((await a.send('ext.jobs.add')).ok, false);
  assert.equal((await a.send('ext.jobs.toggle', { id: 'nope', enabled: true })).ok, false);
  assert.equal((await a.send('ext.jobs.remove', { id: '../x' })).ok, false);
  assert.equal((await a.send('ext.jobs.nothing')).ok, false);
  for (let i = 0; i < 5; i++) await a.send('ext.jobs.add', { kind: 'daily' });
  assert.equal((await a.send('ext.jobs.add', { kind: 'daily' })).ok, false, 'at most 5 jobs');
});

test('saved state that has been tampered with is cleaned or ignored', () => {
  assert.equal(cleanState(null), null);
  assert.equal(cleanState('x'), null);
  const c = cleanState({ memory: 5, ledger: [{ xid: 'card-1', status: 'pending', spec: { tool: 'bad name', args: {} } }, { xid: 'c', status: 'weird', spec: { tool: 'a.b', args: {} } }, 7], xCounter: -1, plan: { planId: 'p', steps: [] }, prices: { p: -5, q: 100 }, killed: 'yes', jobs: 'x', reports: [1, { id: 'r' }] });
  assert.equal(c.memory, null);
  assert.deepEqual(c.ledger, []);
  assert.equal(c.plan, null);
  assert.deepEqual(c.prices, { q: 100 });
  assert.equal(c.killed, false);
  assert.deepEqual(c.jobs, []);
  assert.equal(c.reports.length, 1);
});
