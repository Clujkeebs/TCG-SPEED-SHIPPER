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

test('connect learns what the agent supports; memory view fills', async () => {
  const p = await ready();
  assert.equal(p.state.canMemory, true);
  assert.equal(p.state.memory.length, 2);
});

test('a plain goal shows a plan, progress and an answer, then is free again', async () => {
  const p = await ready();
  assert.equal(await p.start('how many orders?'), true);
  assert.equal(await p.start('second at once'), false, 'one goal at a time');
  await tick();
  assert.equal(p.state.busy, false);
  assert.deepEqual(p.state.plan.map((s) => s.state), ['done', 'done']);
  assert.deepEqual(p.state.items.map((i) => i.kind), ['user', 'progress', 'answer']);
});

test('an action waits for a click, can be answered once, and nothing changes in practice mode', async () => {
  const p = await ready();
  await p.start('please lower the price');
  await tick();
  assert.equal(p.waitingForApproval, true);
  assert.equal(p.state.busy, true);
  const card = p.state.items.find((i) => i.kind === 'approval');
  assert.deepEqual(card.rows.map((r) => r.label), ['printingId', 'newPriceCents']);
  assert.equal(await p.answer('wrong-id', true), false);
  assert.equal(await p.answer(card.id, true), true);
  assert.equal(await p.answer(card.id, false), false, 'cannot answer twice');
  await tick();
  assert.equal(card.state, 'approved');
  assert.match(p.state.items.at(-1).text, /^Done, in practice data only/);
  assert.equal(p.state.busy, false);
});

test('denying works and the plan marks the step skipped', async () => {
  const p = await ready();
  await p.start('reprice it');
  await tick();
  await p.answer(p.state.items.find((i) => i.kind === 'approval').id, false);
  await tick();
  assert.match(p.state.items.at(-1).text, /did not change anything/);
  assert.equal(p.state.plan.at(-1).state, 'skipped');
});

test('Stop works while an approval is waiting, blocks new goals, and Resume frees it', async () => {
  const p = await ready();
  await p.start('lower the price');
  await tick();
  await p.stop();
  await tick();
  assert.equal(p.state.killed, true);
  assert.equal(p.state.busy, false);
  assert.equal(p.state.items.find((i) => i.kind === 'approval').state, 'expired');
  assert.equal(await p.start('again'), false);
  assert.equal(await p.resume(), true);
  assert.equal(await p.start('how many orders?'), true);
});

test('Forget removes a memory', async () => {
  const p = await ready();
  await p.forget('m1');
  await tick();
  assert.deepEqual(p.state.memory.map((m) => m.id), ['m2']);
});

test('bad events and bad responses become notices and never create a card', async () => {
  let push;
  const p = createPanel({ request: async () => ({ nonsense: true }), onEvent(fn) { push = fn; } });
  push({ ...approval, tool: 'bad name' });
  push('<img src=x onerror=alert(1)>');
  assert.equal(await p.connect(), false);
  assert.ok(p.state.items.every((i) => i.kind === 'notice'));
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
