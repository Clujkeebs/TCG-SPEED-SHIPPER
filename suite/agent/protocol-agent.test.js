import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAgentService, validateEvent, summarizeCall, validateRequest, MESSAGE_TYPES, REQUEST_TYPES, EVENT_TYPES, PANEL_SOURCE, AGENT_SOURCE } from './protocol.js';
import { makeWorld } from './eval/harness.js';
import { scriptedModel } from './loop.js';

const EXT = 'abcdefghijklmnopabcdefghijklmnop';
const sender = { id: EXT, url: `chrome-extension://${EXT}/panel.html` };
let n = 0;
const msg = (type, payload) => ({ source: PANEL_SOURCE, v: 1, id: 'm' + (++n), type, ...(payload === undefined ? {} : { payload }) });
const waitFor = async (cond, ms = 3000) => { const t0 = Date.now(); while (!cond()) { if (Date.now() - t0 > ms) throw new Error('timed out waiting'); await new Promise((r) => setTimeout(r, 10)); } };

function shop(opts = {}) {
  const w = makeWorld({ clockStart: '2026-10-12T08:00:00Z' });
  const svc = createAgentService({ registry: w.registry, extensionId: EXT, agent: opts.noAgent ? undefined : w.agent, model: opts.model });
  const events = [];
  const send = (type, payload) => svc.handle(msg(type, payload), sender, (e) => events.push(e));
  return { w, svc, events, send, of: (name) => events.filter((e) => e.event === name) };
}

test('hello announces the new types only when there is an agent (older panels see no change)', async () => {
  const old = shop({ noAgent: true });
  const h0 = (await old.send('agent.hello')).result;
  for (const t of ['agent.memory.list', 'agent.memory.forget', 'agent.plan', 'agent.memory']) assert.ok(!h0.types.includes(t), t);
  assert.deepEqual(h0.requests.filter((t) => t.startsWith('agent.hello')), ['agent.hello']);
  assert.match((await old.send('agent.memory.list')).error, /not available/);
  const s = shop();
  const h = (await s.send('agent.hello')).result;
  for (const t of ['agent.memory.list', 'agent.memory.forget', 'agent.plan', 'agent.memory', 'agent.progress', 'agent.approval-needed']) assert.ok(h.types.includes(t), t);
  assert.ok(h.events.includes('agent.plan') && h.requests.includes('agent.memory.forget'));
  assert.ok(!h.requests.includes('agent.plan'), 'events are not requests');
  for (const t of REQUEST_TYPES) assert.ok(!EVENT_TYPES.includes(t));
  assert.deepEqual(MESSAGE_TYPES, ['agent.hello', 'agent.ask', 'agent.approve', 'agent.stop', 'agent.resume', 'agent.limits', 'agent.audit'], 'the original set is unchanged');
});

test('a goal streams a plan whose steps move todo, doing, done; every event is well formed', async () => {
  const s = shop();
  assert.equal((await s.send('agent.ask', { text: 'Who are my repeat customers?' })).ok, true);
  await waitFor(() => s.of('agent.answer').length > 0);
  const plans = s.of('agent.plan');
  assert.deepEqual(plans[0].steps.map((x) => x.state), ['todo', 'todo']);
  assert.deepEqual(plans.at(-1).steps.map((x) => x.state), ['done', 'done']);
  assert.ok(plans.some((p) => p.steps[0].state === 'doing'));
  assert.match(plans[0].steps[0].text, /buyers who ordered more than once/);
  for (const e of s.events) assert.equal(validateEvent(e), null, JSON.stringify(e));
  const prog = s.of('agent.progress');
  assert.ok(prog.length === 2 && prog.every((p) => p.summary.length > 5 && !/\{|buyer-/.test(p.summary)));
  assert.equal(s.of('agent.answer')[0].status, 'done');
});

test('approval requests carry what, why and undo; approving runs the change and updates the plan', async () => {
  const s = shop();
  const before = JSON.stringify(s.w.inventory);
  await s.send('agent.ask', { text: 'Reprice my foils 5% under market' });
  await waitFor(() => s.of('agent.answer').length > 0);
  const ask = s.of('agent.approval-needed')[0];
  assert.equal(validateEvent(ask), null);
  assert.match(ask.description, /Change the saved price of \d+ cards/);
  assert.match(ask.why, /Save the new prices/);
  assert.match(ask.undo, /puts every price back/);
  assert.equal(ask.tool, 'inventory.setPrices');
  assert.equal(JSON.stringify(s.w.inventory), before);
  assert.deepEqual(s.of('agent.plan').at(-1).steps.map((x) => x.state), ['done', 'doing']);
  const r = await s.send('agent.approve', { approvalId: ask.approvalId, approved: true });
  assert.deepEqual(r.result, { recorded: true, status: 'done' });
  assert.notEqual(JSON.stringify(s.w.inventory), before);
  assert.deepEqual(s.of('agent.plan').at(-1).steps.map((x) => x.state), ['done', 'done']);
  assert.equal(s.of('agent.answer').at(-1).status, 'done');
  assert.equal(s.of('agent.progress').at(-1).summary, 'Saved new prices in your stock list');
  const inbox = await s.send('agent.inbox.list');
  assert.equal(inbox.result.cards.length, 0);
});

test('declining leaves the plan step skipped and changes nothing; a used or unknown id is refused', async () => {
  const s = shop();
  const before = JSON.stringify(s.w.inventory);
  await s.send('agent.ask', { text: 'Reprice my foils 5% under market' });
  await waitFor(() => s.of('agent.answer').length > 0);
  const pendingList = await s.send('agent.inbox.list');
  assert.equal(pendingList.result.cards.length, 1);
  const id = pendingList.result.cards[0].approvalId;
  await s.send('agent.approve', { approvalId: id, approved: false });
  assert.equal(JSON.stringify(s.w.inventory), before);
  assert.deepEqual(s.of('agent.plan').at(-1).steps.map((x) => x.state), ['done', 'skipped']);
  assert.equal(s.of('agent.progress').at(-1).denied, true);
  assert.equal((await s.send('agent.approve', { approvalId: id, approved: true })).ok, false);
  assert.match((await s.send('agent.approve', { approvalId: 'card-999', approved: true })).error, /no such approval/);
});

test('kill switch: stop leaves cards waiting, approving fails, resume allows it', async () => {
  const s = shop();
  await s.send('agent.ask', { text: 'Reprice my foils 5% under market' });
  await waitFor(() => s.of('agent.answer').length > 0);
  const id = s.of('agent.approval-needed')[0].approvalId;
  await s.send('agent.stop');
  assert.equal(s.w.inbox.get(id).status, 'pending');
  const refused = await s.send('agent.approve', { approvalId: id, approved: true });
  assert.match(refused.error, /kill switch/);
  assert.match((await s.send('agent.ask', { text: 'hello' })).error, /kill switch/);
  await s.send('agent.resume');
  assert.equal((await s.send('agent.approve', { approvalId: id, approved: true })).ok, true);
});

test('memory: list, forget, events, audit; an approved agent memory shows up in the panel list', async () => {
  const s = shop();
  await s.w.agent.remember({ text: 'I restock at 3 or fewer', key: 'restock.threshold', value: 3 });
  const l = await s.send('agent.memory.list');
  assert.deepEqual(l.result.items.map((i) => Object.keys(i).sort()), [['id', 'text']]);
  assert.equal(s.of('agent.memory').length, 1);
  assert.equal(validateEvent(s.of('agent.memory')[0]), null);
  await s.send('agent.ask', { text: 'Remember that I never list below 50 cents' });
  await waitFor(() => s.of('agent.approval-needed').length > 0);
  assert.equal((await s.send('agent.memory.list')).result.items.length, 1, 'not remembered until approved');
  await s.send('agent.approve', { approvalId: s.of('agent.approval-needed')[0].approvalId, approved: true });
  assert.equal(s.of('agent.memory').at(-1).items.length, 2);
  const id = l.result.items[0].id;
  assert.deepEqual((await s.send('agent.memory.forget', { id })).result, { forgotten: true });
  assert.equal(s.of('agent.memory').at(-1).items.length, 1);
  assert.equal(s.w.memory.get('restock.threshold'), undefined);
  assert.equal((await s.send('agent.memory.forget', { id })).ok, false);
  assert.ok((await s.w.audit.list()).some((e) => e.tool === 'memory.delete' && e.actor === 'user'));
  assert.equal(validateRequest(msg('agent.memory.forget', {}), sender, EXT).ok, false);
  assert.equal(validateRequest(msg('agent.memory.forget', { id: 'mem-1', extra: 1 }), sender, EXT).ok, false);
});

test('no plan for the question: honest answer without a model, chat fallback with one', async () => {
  const a = shop();
  await a.send('agent.ask', { text: 'Make me rich' });
  await waitFor(() => a.of('agent.answer').length > 0);
  assert.equal(a.of('agent.answer')[0].status, 'no-plan');
  assert.match(a.of('agent.answer')[0].text, /do not have a plan/);
  const b = shop({ model: scriptedModel([[{ type: 'tool_use', id: 't', name: 'orders.stats', input: {} }], [{ type: 'text', text: 'chatted' }]]) });
  await b.send('agent.ask', { text: 'Tell me something nice' });
  await waitFor(() => b.of('agent.answer').length > 0);
  assert.equal(b.of('agent.answer')[0].text, 'chatted');
  assert.match(b.of('agent.progress')[0].summary, /Looked something up|Searched|Checked|Added/);
});

test('chat-path approvals also carry why and undo', async () => {
  const s = shop({ model: scriptedModel([[{ type: 'tool_use', id: 't', name: 'memory.remember', input: { text: 'I like .99 endings' } }], [{ type: 'text', text: 'ok' }]]), noAgent: true });
  await s.send('agent.ask', { text: 'go' });
  await waitFor(() => s.of('agent.approval-needed').length > 0);
  const e = s.of('agent.approval-needed')[0];
  assert.equal(validateEvent(e), null);
  assert.match(e.description, /Remember: "I like \.99 endings"/);
  assert.match(e.why, /asked a question/);
  assert.match(e.undo, /forgets it/);
  await s.send('agent.approve', { approvalId: e.approvalId, approved: false });
  await waitFor(() => s.of('agent.answer').length > 0);
});

test('suggestions request and the validators reject malformed events', async () => {
  const s = shop();
  const r = await s.send('agent.suggestions');
  assert.ok(r.result.suggestions.length <= 5 && r.result.suggestions.length > 0);
  const ok = { source: AGENT_SOURCE, v: 1 };
  assert.match(validateEvent({ ...ok, event: 'agent.plan', steps: [] }), /1 to 8/);
  assert.match(validateEvent({ ...ok, event: 'agent.plan', steps: [{ text: 'x', state: 'maybe' }] }), /state/);
  assert.match(validateEvent({ ...ok, event: 'agent.memory', items: [{ id: 'm' }] }), /items/);
  assert.match(validateEvent({ ...ok, event: 'agent.progress', tool: 'a', ok: true, denied: false }), /summary/);
  assert.match(validateEvent({ ...ok, event: 'agent.approval-needed', approvalId: 'a', tool: 't', description: 'd', args: {} }), /why/);
  assert.match(validateEvent({ ...ok, event: 'agent.nope' }), /unknown/);
  assert.equal(summarizeCall({ tool: 'x', tier: 'read', ok: false, denied: false }), 'That step did not work');
  assert.match(summarizeCall({ tool: 'x', tier: 'act', ok: false, denied: true }), /not approved/);
});
