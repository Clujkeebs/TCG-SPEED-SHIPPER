import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateEvent, validateResponse, makeRequest, argRows, AGENT_SOURCE as source, PROTOCOL_VERSION as v } from '../src/agent/protocol.js';
import { createPanel } from '../src/agent/panel-controller.js';
import { hostTransport } from './helpers/host-transport.js';

const tick = () => new Promise((r) => setTimeout(r, 40));
const ev = (event, data = {}) => ({ source, v, event, ...data });
const approval = ev('agent.approval-needed', { approvalId: 'ap-1', tool: 'listing.setPrice', description: 'Change a price', args: { card: 'X' } });

test('good events pass, malformed ones fail', () => {
  for (const e of [approval, ev('agent.progress', { tool: 'orders.stats', ok: true, denied: false }), ev('agent.answer', { status: 'done', text: 'hi' }), ev('agent.stopped'),
    ev('agent.plan', { steps: [{ text: 'a', state: 'todo' }] }), ev('agent.memory', { items: [{ id: 'm', text: 't' }] })]) assert.ok(validateEvent(e).ok, e.event);
  for (const bad of [null, 'x', [], {}, { ...approval, source: 'evil' }, { ...approval, v: 2 }, ev('nope'), ev('agent.approval-needed', { approvalId: '', tool: 'x', description: 'd', args: {} }),
    { ...approval, args: 'x' }, { ...approval, args: [] }, { ...approval, tool: 'bad name!' }, { ...approval, description: 'd'.repeat(401) },
    ev('agent.progress', { tool: 'x', ok: 'yes', denied: false }), ev('agent.answer', { status: 'weird', text: '' }), ev('agent.answer', { status: 'done', text: 'x'.repeat(9000) }),
    ev('agent.plan', { steps: [] }), ev('agent.plan', { steps: [{ text: 'a', state: 'maybe' }] }), ev('agent.memory', { items: [{ id: 'm' }] })]) {
    assert.equal(validateEvent(bad).ok, false, JSON.stringify(bad)?.slice(0, 70));
  }
});

test('responses are checked and events are not mistaken for responses', () => {
  assert.ok(validateResponse({ source, v, id: 'p-1', ok: true, result: {} }).ok);
  assert.ok(validateResponse({ source, v, id: null, ok: false, error: 'no' }).ok);
  for (const bad of [null, {}, { source, v, id: 'p-1', ok: false }, { source: 'x', v, id: 'p-1', ok: true }, ev('agent.stopped')]) assert.equal(validateResponse(bad).ok, false);
});

test('requests carry the panel source and a fresh id', () => {
  const a = makeRequest('agent.ask', { text: 'x' }), b = makeRequest('agent.hello');
  assert.equal(a.source, 'tcgss-panel');
  assert.notEqual(a.id, b.id);
  assert.ok(!('payload' in b));
});

test('approval rows show every value as text, capped', () => {
  const rows = argRows({ a: 'x', n: 5, o: { k: 1 }, long: 'y'.repeat(500) });
  assert.deepEqual(rows.slice(0, 3), [{ label: 'a', value: 'x' }, { label: 'n', value: '5' }, { label: 'o', value: '{"k":1}' }]);
  assert.equal(rows[3].value.length, 200);
  assert.equal(argRows(Object.fromEntries(Array.from({ length: 30 }, (_, i) => ['k' + i, i]))).length, 12);
  assert.deepEqual(argRows(null), []);
});

async function ready() {
  const p = createPanel(hostTransport());
  assert.equal(await p.connect(), true);
  await tick();
  return p;
}

test('connect learns what the agent supports and fills memory, suggestions and jobs', async () => {
  const p = await ready();
  assert.deepEqual([p.state.canMemory, p.state.canInbox, p.state.canSuggest, p.state.canUndo, p.state.canJobs], [true, true, true, true, true]);
  assert.equal(p.state.memory.length, 2);
  assert.ok(p.state.suggestions.length >= 2 && p.state.suggestions.length <= 5);
  assert.deepEqual(p.state.jobs, []);
});

test('a plain goal shows a plan, progress and an answer, then is free again', async () => {
  const p = await ready();
  assert.equal(await p.start('Who are my repeat customers?'), true);
  assert.equal(await p.start('second at once'), false, 'one goal at a time');
  await tick();
  assert.equal(p.state.busy, false);
  assert.ok(p.state.plan.length >= 2 && p.state.plan.every((s) => s.state === 'done'));
  assert.deepEqual([...new Set(p.state.items.map((i) => i.kind))].sort(), ['answer', 'progress', 'user']);
});

test('an action waits as a card (what, why, undo), is answered once by a click, can be undone', async () => {
  const p = await ready();
  await p.start('Reprice my cards 5% under market');
  await tick();
  assert.equal(p.waitingForApproval, true);
  const card = p.state.items.find((i) => i.kind === 'approval');
  assert.ok(card.why && card.undo && card.expected && card.rows.length >= 1);
  assert.equal(await p.answer('wrong-id', true), false);
  assert.equal(await p.answer(card.id, true), true);
  assert.equal(await p.answer(card.id, false), false, 'cannot answer twice');
  await tick();
  assert.equal(card.state, 'approved');
  assert.equal(p.waitingForApproval, false);
  assert.equal(await p.undo(card.id), true);
  assert.equal(card.state, 'undone');
});

test('denying works and the plan marks the step skipped', async () => {
  const p = await ready();
  await p.start('Reprice my cards 5% under market');
  await tick();
  await p.answer(p.state.items.find((i) => i.kind === 'approval').id, false);
  await tick();
  assert.equal(p.state.plan.at(-1).state, 'skipped');
});

test('Stop keeps a waiting card waiting; approving while stopped fails kindly and Resume fixes it', async () => {
  const p = await ready();
  await p.start('Reprice my cards 5% under market');
  await tick();
  const card = p.state.items.find((i) => i.kind === 'approval');
  await p.stop();
  await tick();
  assert.equal(p.state.killed, true);
  assert.equal(await p.start('again'), false);
  assert.equal(await p.answer(card.id, true), false);
  assert.equal(card.state, 'waiting', 'the card is still waiting');
  assert.match(p.state.items.at(-1).text, /stopped|Resume/i);
  assert.equal(await p.resume(), true);
  assert.equal(await p.answer(card.id, true), true);
});

test('Forget removes a memory; a suggestion can be started with its goal', async () => {
  const p = await ready();
  await p.forget('mem-1');
  await tick();
  assert.deepEqual(p.state.memory.map((m) => m.id), ['mem-2']);
  const withGoal = p.state.suggestions.find((x) => x.goal);
  assert.equal(await p.start(withGoal.goal), true);
});

test('jobs: add a demo job, see it listed, turn it off and remove it', async () => {
  const p = await ready();
  assert.equal(await p.addJob('minute'), true);
  assert.equal(p.state.jobs.length, 1);
  const id = p.state.jobs[0].id;
  assert.equal(await p.toggleJob(id, false), true);
  assert.equal(p.state.jobs[0].enabled, false);
  assert.equal(await p.removeJob(id), true);
  assert.equal(p.state.jobs.length, 0);
});

test('cards that appear later (from a background job) show up once, even if announced twice', async () => {
  const t = hostTransport();
  const p = createPanel(t);
  await p.connect();
  await p.addJob('minute');
  await t.host.tick((e) => t.push(e));
  await t.host.tick((e) => t.push(e)); // same minute: no second run
  await tick();
  await p.refresh();
  assert.equal(p.state.items.filter((i) => i.kind === 'approval').length, 1);
});

test('the five big buttons: four run goals, one reads the weekly list; none run while busy or stopped', async () => {
  const p = await ready();
  assert.equal(await p.quick('today'), true);
  assert.match(p.state.items.at(-1).text, /^1\. /);
  for (const id of ['repeat', 'ship', 'weekly', 'reply']) {
    assert.equal(await p.quick(id), true, id);
    await tick();
    assert.equal(p.state.busy, false, id + ' finished');
    const last = p.state.items.at(-1);
    assert.equal(last.kind, 'answer', id);
    assert.ok(!/waiting-approval|card-\d|Goal:|Plan:|\bb-[a-z0-9]{4,}\b/.test(last.text), id + ' is plain: ' + last.text);
  }
  assert.equal(await p.quick('nope'), false);
  await p.stop();
  await tick();
  assert.equal(await p.quick('repeat'), false, 'not while stopped');
});

test('the panel can switch the Agent to the seller\'s own orders and back', async () => {
  const t = hostTransport();
  const p = createPanel(t);
  await p.connect();
  assert.deepEqual(p.state.orders, { mode: 'practice', count: 60 });
  assert.equal(await p.useOrders('imported'), false, 'nothing imported yet: a plain notice, not a crash');
  assert.ok(p.state.items.at(-1).text.length > 0 && !/[{}_]/.test(p.state.items.at(-1).text));
});

test('bad events and bad responses become notices and never create a card', async () => {
  let push;
  const p = createPanel({ request: async () => ({ nonsense: true }), onEvent(fn) { push = fn; } });
  push({ ...approval, tool: 'bad name' });
  push('<img src=x onerror=alert(1)>');
  assert.equal(await p.connect(), false);
  assert.ok(p.state.items.every((i) => i.kind === 'notice'));
  assert.ok(p.state.items.every((i) => !/[{}<>_]|undefined|\[object/.test(i.text)), 'notices are plain words');
  assert.equal(p.waitingForApproval, false);
});

test('memory events are ignored unless the agent offered memory', async () => {
  let push;
  const p = createPanel({ request: async (m) => ({ source, v, id: m.id, ok: true, result: { v, types: ['agent.hello'], killed: false } }), onEvent(fn) { push = fn; } });
  await p.connect();
  push(ev('agent.memory', { items: [{ id: 'z', text: 'sneaky' }] }));
  assert.equal(p.state.memory, null);
});

test('the panel code never uses innerHTML or eval', () => {
  for (const f of ['../src/ui/sidepanel.js', '../src/agent/panel-controller.js', '../src/agent/protocol.js']) {
    assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|eval\(|new Function/.test(readFileSync(new URL(f, import.meta.url), 'utf8')), f);
  }
});
