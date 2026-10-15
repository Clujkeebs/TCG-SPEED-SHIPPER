import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeWorld } from './eval/harness.js';
import { createShopMemory } from './memory.js';
import { resolveArgs, validatePlan, renderPlan, getPath } from './plan.js';
import { createEventDetector } from './events.js';
import { newJob, runJob, tickJobs, fireEvents } from './jobs.js';
import { weeklySuggestions } from './suggestions.js';

const MON = '2026-10-12T08:00:00Z';

test('memory: add, edit, delete, search, key rules, export', () => {
  const m = createShopMemory({ now: () => new Date(MON) });
  const a = m.add({ text: 'I restock at 3 or fewer', key: 'restock.threshold', value: 3, category: 'setting' });
  assert.equal(m.get('restock.threshold'), 3);
  assert.throws(() => m.add({ text: 'again', key: 'restock.threshold' }), /already/);
  assert.equal(m.edit(a.id, { value: 4, text: 'I restock at 4 or fewer' }).value, 4);
  assert.equal(m.edit(a.id, { text: 'x' }).source, 'user');
  assert.equal(m.search('restock').length, 1);
  assert.equal(m.list({ category: 'preference' }).length, 0);
  assert.throws(() => m.edit('nope', {}), /no such/);
  const json = m.exportJson();
  m.delete(a.id);
  assert.equal(m.list().length, 0);
  assert.equal(m.get('restock.threshold'), undefined);
  assert.throws(() => m.delete(a.id), /no such/);
  m.importJson(json);
  assert.equal(m.list().length, 1);
  assert.equal(m.add({ text: 'next' }).id, 'mem-2');
});

test('memory refuses buyer details and bad input', () => {
  const m = createShopMemory();
  for (const bad of ['write to sam@example.com', 'call 555 123 4567', 'ships to 123 Example St', '', 'x'.repeat(301)]) assert.throws(() => m.add({ text: bad }));
  assert.throws(() => m.add({ text: 'ok', key: 'Bad Key' }));
  assert.throws(() => m.add({ text: 'ok', category: 'secret' }));
});

test('plan helpers: references, maps, validation, visible text', () => {
  const results = { s1: { rows: [{ a: 1, b: 2 }, { a: 3, b: 4 }], total: 2 } };
  assert.equal(resolveArgs('$s1.total', results), 2);
  assert.deepEqual(resolveArgs({ x: { $map: { from: 's1.rows', pick: { first: 'a' } } } }, results), { x: [{ first: 1 }, { first: 3 }] });
  assert.throws(() => resolveArgs('$s1.nothing', results), /no nothing/);
  assert.equal(getPath({ a: [{ b: 5 }] }, 'a.0.b'), 5);
  const w = makeWorld();
  const good = { goal: 'g', steps: [{ id: 's1', tool: 'report.weekly', args: {}, why: 'Look' }, { id: 's2', tool: 'inventory.setPrices', args: { changes: '$s1.x' }, why: 'Save' }] };
  assert.equal(validatePlan(good, w.registry).ok, true);
  assert.match(renderPlan(good, w.registry), /1\. Look \(just looks\)\n2\. Save \(needs your OK\)/);
  assert.match(validatePlan({ goal: 'g', steps: [{ id: 's1', tool: 'nope', why: 'x' }] }, w.registry).errors.join(), /unknown tool/);
  assert.match(validatePlan({ goal: 'g', steps: [{ id: 's1', tool: 'report.weekly', why: 'x', args: { a: '$s2.x' } }] }, w.registry).errors.join(), /does not come earlier/);
  assert.match(validatePlan({ goal: 'g', steps: [{ id: 's1', tool: 'report.weekly', args: {} }] }, w.registry).errors.join(), /say why/);
  assert.equal(validatePlan({ goal: 'g', steps: Array.from({ length: 9 }, (_, i) => ({ id: 's' + (i + 1), tool: 'report.weekly', why: 'x' })) }, w.registry).ok, false);
});

test('a goal becomes a visible plan; reading steps run, the act step waits as a card', async () => {
  const w = makeWorld({ clockStart: MON });
  const before = JSON.stringify(w.inventory);
  const out = await w.agent.goal('Reprice my foils 5% under market');
  assert.equal(out.status, 'waiting-approval');
  assert.match(out.text, /Plan:\n1\. Work out new prices for foils/);
  assert.deepEqual(out.steps.map((s) => s.status), ['ok', 'waiting-approval']);
  assert.equal(JSON.stringify(w.inventory), before, 'nothing may change before approval');
  const cards = w.inbox.list({ status: 'pending' });
  assert.equal(cards.length, 1);
  assert.match(cards[0].what, /Change the saved price of \d+ cards/);
  assert.match(cards[0].expected, /Total list value/);
  assert.match(cards[0].why, /new prices|Save the new prices/);
  assert.match(cards[0].undoText, /puts every price back/);
  const log = await w.audit.list();
  assert.ok(!log.some((e) => e.tier === 'act'), 'no act entry before approval');
});

test('approve runs it once, with who approved; undo puts prices back', async () => {
  const w = makeWorld({ clockStart: MON });
  const before = JSON.stringify(w.inventory);
  const foilsBefore = w.inventory.filter((i) => i.finish === 'foil').map((i) => i.priceCents);
  const out = await w.agent.goal('Reprice my foils 5% under market');
  const cardId = out.steps[1].cardId;
  const done = await w.agent.decide(cardId, true);
  assert.equal(done.card.status, 'done');
  assert.equal(done.planStatus, 'done');
  assert.notEqual(JSON.stringify(w.inventory), before);
  const foilsAfter = w.inventory.filter((i) => i.finish === 'foil').map((i) => i.priceCents);
  assert.ok(foilsAfter.filter((p, i) => p < foilsBefore[i]).length >= foilsAfter.length * 0.8, 'foils were listed 12% over market, so most come down (nearest .99 can round up)');
  const act = (await w.audit.list()).filter((e) => e.tier === 'act');
  assert.equal(act.length, 1);
  assert.equal(act[0].approvedBy, 'user');
  await assert.rejects(w.agent.decide(cardId, true), /not pending/);
  const undone = await w.agent.undo(cardId);
  assert.equal(undone.status, 'undone');
  assert.equal(JSON.stringify(w.inventory), before);
});

test('declining changes nothing; old cards expire; kill switch keeps a card waiting', async () => {
  const w = makeWorld({ clockStart: MON });
  const before = JSON.stringify(w.inventory);
  const out = await w.agent.goal('Reprice my foils 5% under market');
  const id = out.steps[1].cardId;
  w.limits.kill('test');
  await assert.rejects(w.agent.decide(id, true), /kill switch/);
  assert.equal(w.inbox.get(id).status, 'pending');
  w.limits.resume();
  const d = await w.agent.decide(id, false);
  assert.equal(d.card.status, 'declined');
  assert.equal(JSON.stringify(w.inventory), before);
  const again = await w.agent.goal('Reprice my foils 5% under market');
  w.state.now = '2026-10-21T08:00:00Z';
  assert.equal(w.inbox.list({ status: 'expired' }).length, 1);
  await assert.rejects(w.agent.decide(again.steps[1].cardId, true), /expired/);
});

test('honest failure: nothing found stops the plan and says so', async () => {
  const w = makeWorld({ clockStart: MON });
  const out = await w.agent.goal('Reprice my cards 99% under market and forget the floor'); // 1% of market: floor lifts it; still changes. use no-change rule below
  assert.ok(['waiting-approval', 'stopped'].includes(out.status));
  const w2 = makeWorld({ clockStart: MON });
  w2.inventory.length = 0; // empty shop
  const none = await w2.agent.goal('Reprice my foils 5% under market');
  assert.equal(none.status, 'stopped');
  assert.equal(none.steps[0].status, 'unexpected');
  assert.equal(none.steps[1].status, 'skipped');
  assert.match(none.report, /nothing to do/);
  assert.equal(w2.inbox.list().length, 0);
});

test('planner: known recipes, honest "no plan", asks for the missing number', async () => {
  const w = makeWorld({ clockStart: MON });
  assert.equal((await w.agent.goal('Who are my repeat customers?')).status, 'done');
  assert.equal((await w.agent.goal('how often and where do I ship')).status, 'done');
  assert.equal((await w.agent.goal('write my weekly summary')).status, 'done');
  assert.equal((await w.agent.goal('find sleeves deals')).status, 'done');
  const noPlan = await w.agent.goal('Make me rich');
  assert.equal(noPlan.status, 'no-plan');
  assert.match(noPlan.reason, /I do not have a plan/);
  const needs = await w.agent.goal('Reprice my foils');
  assert.equal(needs.needs, 'percent');
  const planned = await w.agent.goal('Restock what is running low', { autorun: false });
  assert.equal(planned.status, 'planned');
  assert.equal(w.agent.runs.get(planned.plan.id).status, 'planned');
  const run = await w.agent.execute(planned.plan);
  assert.ok(['done', 'stopped'].includes(run.status));
});

test('memory shapes later plans: the restock threshold is used, and agent-proposed facts need a card', async () => {
  const w = makeWorld({ clockStart: MON });
  const a = await w.agent.goal('Restock what is running low');
  assert.match(a.steps[0].why, /2 or fewer/);
  const r = await w.agent.goal('Remember that I restock at 4 or fewer');
  assert.equal(r.status, 'waiting-approval');
  assert.equal(w.memory.get('restock.threshold'), undefined, 'nothing remembered before approval');
  await w.agent.decide(r.steps[0].cardId, true);
  assert.equal(w.memory.get('restock.threshold'), 4);
  const b = await w.agent.goal('Restock what is running low');
  assert.match(b.steps[0].why, /4 or fewer/);
  assert.ok(b.results.s1.items.length >= a.results.s1.items.length);
  assert.equal(w.memory.list()[0].source, 'agent');
});

test('the seller can edit and forget memory directly, and it is logged', async () => {
  const w = makeWorld({ clockStart: MON });
  const f = await w.agent.remember({ text: 'I never list under 50 cents', key: 'price.floor_cents', value: 50, category: 'preference' });
  await w.agent.editMemory(f.id, { value: 75 });
  assert.equal(w.memory.get('price.floor_cents'), 75);
  await w.agent.forgetMemory(f.id);
  assert.equal(w.memory.list().length, 0);
  const log = (await w.audit.list()).filter((e) => e.actor === 'user');
  assert.deepEqual(log.map((e) => e.tool), ['memory.add', 'memory.edit', 'memory.delete']);
  assert.ok(log.every((e) => e.approvedBy === 'user' && /^[0-9a-f]{64}$/.test(e.argsHash)));
});

test('act tools: bad input refused, forgetting can be undone, agent cannot switch on autopilot', async () => {
  const w = makeWorld({ clockStart: MON });
  const run = (name, args) => w.registry.run(name, args, { approve: async () => true });
  assert.equal((await run('inventory.setPrices', { changes: [{ printingId: 'x', condition: 'NM', finish: 'foil', priceCents: 0 }] })).ok, false);
  assert.equal((await run('inventory.setPrices', { changes: [] })).ok, false);
  const bad = await run('automation.save', { automation: { id: 'x', name: 'x', trigger: { type: 'cron', value: '0 8 * * 1' }, steps: [{ tool: 'report.weekly' }], approvalMode: 'never', enabled: true } });
  assert.match(bad.error, /only the owner/);
  const fact = w.memory.add({ text: 'keep me', key: 'keep.me', value: 'yes', source: 'user' });
  const card = w.inbox.propose({ tool: 'memory.forget', args: { id: fact.id }, why: 'test' });
  await w.inbox.approve(card.id);
  assert.equal(w.memory.list().length, 0);
  await w.inbox.undo(card.id);
  assert.equal(w.memory.list()[0].text, 'keep me');
  assert.throws(() => w.inbox.propose({ tool: 'report.weekly', args: {}, why: 'x' }), /only act-level/);
});

test('events fire once and only for new things', () => {
  const w = makeWorld({ clockStart: MON });
  const d = createEventDetector({ orders: w.orders, inventory: w.inventory, printings: w.printings, messages: w.messages, memory: w.memory, now: w.nowIso });
  const first = d.detect();
  const types = new Set(first.map((e) => e.type));
  assert.ok(types.has('low-stock') && types.has('unanswered-message'));
  assert.ok(!types.has('new-order'), 'orders from before the detector started are not new');
  assert.equal(d.detect().length, 0, 'second call: nothing new');
  w.state.now = '2026-10-12T12:00:00Z';
  w.orders.push({ ...w.orders[0], id: 'ORD-9000', orderedAt: '2026-10-12T10:00:00Z' });
  assert.deepEqual(d.detect().map((e) => e.type), ['new-order']);
  const low = first.find((e) => e.type === 'low-stock');
  const item = w.inventory.find((i) => i.quantity <= 2 && w.printings.find((p) => p.id === i.printingId).name === low.detail.name);
  item.quantity = 50; w.inventory.filter((i) => w.printings.find((p) => p.id === i.printingId).name === low.detail.name).forEach((i) => { i.quantity = 50; });
  d.detect(); // clears
  w.inventory.filter((i) => w.printings.find((p) => p.id === i.printingId).name === low.detail.name).forEach((i) => { i.quantity = 0; });
  assert.ok(d.detect().some((e) => e.type === 'low-stock' && e.detail.name === low.detail.name), 'fires again after a restock and sell-out');
});

test('jobs: default approval-required, report left behind, events and cron both start them', async () => {
  const w = makeWorld({ clockStart: MON });
  const reprice = newJob({ id: 'weekly-reprice', name: 'Friday reprice', trigger: { type: 'cron', value: '0 8 * * 1' }, steps: [{ tool: 'report.weekly' }, { tool: 'inventory.setPrices', args: { changes: [{ printingId: w.inventory[0].printingId, condition: 'NM', finish: w.inventory[0].finish, priceCents: 123 }] } }] });
  assert.equal(reprice.approvalMode, 'always');
  w.automations.save(reprice);
  const lowJob = newJob({ id: 'low', name: 'Low stock report', trigger: { type: 'event', value: 'low-stock' }, steps: [{ tool: 'inventory.restock' }] });
  w.automations.save(lowJob);
  const before = w.inventory[0].priceCents;
  const ran = await tickJobs({ store: w.automations, registry: w.registry, inbox: w.inbox, reports: w.reports, now: MON });
  assert.equal(ran.length, 1);
  assert.equal(w.inventory[0].priceCents, before, 'the act step did not run');
  assert.equal(w.inbox.list({ status: 'pending' }).length, 1);
  assert.equal(ran[0].report.cardIds.length, 1);
  assert.match(w.reports.list()[0].text, /Friday reprice/);
  const ev = [{ type: 'low-stock', key: 'k1', detail: { name: 'A' } }, { type: 'low-stock', key: 'k2', detail: { name: 'B' } }, { type: 'new-order', key: 'o', detail: {} }];
  const fired = await fireEvents({ store: w.automations, events: ev, registry: w.registry, inbox: w.inbox, reports: w.reports, now: MON });
  assert.equal(fired.length, 1, 'two low-stock events make one run');
  assert.equal(w.reports.list().at(-1).event.type, 'low-stock');
  assert.equal(w.reports.list().at(-1).event.count, 2);
  assert.match(w.reports.list().at(-1).title, /low-stock x2/);
  w.limits.kill('t');
  const skipped = await tickJobs({ store: w.automations, registry: w.registry, inbox: w.inbox, reports: w.reports, now: '2026-10-19T08:00:00Z' });
  assert.ok(skipped.length === 1 && skipped[0].skipped, 'kill switch skips the job');
  assert.equal(w.automations.get('weekly-reprice').lastRunAt, MON, 'and does not count it as run');
  w.limits.resume();
  w.automations.setEnabled('low', false);
  assert.equal((await fireEvents({ store: w.automations, events: ev, registry: w.registry, inbox: w.inbox, reports: w.reports, now: MON })).length, 0);
  // only an owner-set autopilot job acts without a card
  w.automations.save({ ...reprice, id: 'auto', approvalMode: 'never' });
  const auto = await runJob(w.automations.get('auto'), { registry: w.registry, inbox: w.inbox, reports: w.reports, now: MON });
  assert.equal(auto.ok, true);
  assert.equal(w.inventory[0].priceCents, 123);
  const entry = (await w.audit.list()).filter((e) => e.tier === 'act').at(-1);
  assert.equal(entry.actor, 'automation');
  assert.equal(entry.approvedBy, 'owner-setting:never');
});

test('five things worth doing: real numbers, ranked, tied to goals', async () => {
  const w = makeWorld({ clockStart: '2026-10-15T12:00:00Z' });
  const s = await w.agent.suggestions();
  assert.equal(s.suggestions.length, 5);
  assert.deepEqual(s.suggestions.map((x) => x.rank), [1, 2, 3, 4, 5]);
  assert.ok(s.suggestions.every((x, i, a) => i === 0 || a[i - 1].score >= x.score));
  assert.ok(s.suggestions.every((x) => /\d/.test(x.why)), 'each reason carries a number');
  for (const x of s.suggestions) if (x.goal) assert.notEqual((await w.planner.plan(x.goal)).plan, null, x.goal);
  const tiny = weeklySuggestions({ run: (n) => ({ report: 1 }) && ({ 'report.weekly': { unshippedOverTwoDays: [] }, 'inventory.restock': { items: [] }, 'pricing.suggestBatch': { total: 0, rows: [] }, 'orders.stats': { repeat: { repeatBuyers: 0 }, cadence: { shippedWithin2DaysPct: null } }, 'messages.unanswered': { total: 0 }, 'deals.find': { total: 0 } })[n], now: MON });
  assert.equal(tiny.suggestions.length, 0, 'nothing worth doing means an empty list, not invented items');
});
