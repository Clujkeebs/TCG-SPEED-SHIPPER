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

test('agent.export: a dropped file becomes at most a few cards, announced like any approval; bad files are refused', async () => {
  const { makeSellerExport } = await import('./fixtures/export.js');
  const s = shop();
  const csv = makeSellerExport({ printings: s.w.printings, inventory: s.w.inventory });
  const before = JSON.stringify(s.w.inventory);
  const r = await s.send('agent.export', { csv });
  assert.equal(r.ok, true);
  assert.ok(r.result.fixes.length >= 3 && r.result.fixes.length <= 5);
  assert.ok(r.result.fixes.some((f) => f.approvalId));
  const asks = s.of('agent.approval-needed');
  assert.ok(asks.length >= 1 && asks.every((e) => validateEvent(e) === null));
  assert.equal(JSON.stringify(s.w.inventory), before, 'nothing applied until approved');
  assert.equal((await s.send('agent.approve', { approvalId: asks[0].approvalId, approved: true })).ok, true);
  assert.notEqual(JSON.stringify(s.w.inventory), before);
  assert.equal((await s.send('agent.export', { csv: 'nonsense' })).ok, false);
  assert.equal(validateRequest(msg('agent.export', { csv: 'x'.repeat(400001) }), sender, EXT).ok, false);
  assert.equal(validateRequest(msg('agent.export', { csv: 'a', extra: 1 }), sender, EXT).ok, false);
  const old = shop({ noAgent: true });
  assert.match((await old.send('agent.export', { csv })).error, /not available/);
  await s.send('agent.stop');
  assert.match((await s.send('agent.export', { csv })).error, /kill switch/);
});

test('an approval asked for after reading untrusted text carries a warning', async () => {
  const s = shop({ noAgent: true, model: scriptedModel([[{ type: 'tool_use', id: 'a', name: 'messages.unanswered', input: {} }], [{ type: 'tool_use', id: 'b', name: 'inventory.setPrices', input: { changes: [{ printingId: 'x', condition: 'NM', finish: 'foil', priceCents: 5 }] } }], [{ type: 'text', text: 'ok' }]]) });
  await s.send('agent.ask', { text: 'check messages' });
  await waitFor(() => s.of('agent.approval-needed').length > 0);
  const e = s.of('agent.approval-needed')[0];
  assert.equal(validateEvent(e), null);
  assert.match(e.warning, /text written by someone else/);
  await s.send('agent.approve', { approvalId: e.approvalId, approved: false });
  await waitFor(() => s.of('agent.answer').length > 0);
});

test('a drafted reply reaches the panel as text to copy, with the first name filled in on the device only', async () => {
  const s = shop();
  const order = s.w.orders.find((o) => o.id === 'ORD-1010');
  const first = order.shipTo.name.split(' ')[0], full = order.shipTo.name;
  await s.send('agent.ask', { text: 'Draft a reply to the oldest unanswered message' });
  await waitFor(() => s.of('agent.answer').length > 0);
  const ans = s.of('agent.answer')[0];
  assert.equal(ans.status, 'done');
  assert.equal(validateEvent(ans), null);
  assert.equal(ans.drafts.length, 1);
  const d = ans.drafts[0];
  assert.equal(d.title, 'Reply to the buyer (draft, not sent)');
  assert.ok(d.text.startsWith(`Hi ${first},`), d.text);
  assert.ok(!d.text.includes('{{'), 'no placeholder left on screen');
  assert.match(d.notes, /LOST-1.*check TCGplayer's current article/s);
  assert.ok(!d.text.includes('For you, not the buyer'), 'the seller-only notes are separate from the reply');
  // the plan event for that step carries the same text
  const withOutput = s.of('agent.plan').flatMap((p) => p.steps).filter((st) => st.output);
  assert.ok(withOutput.length >= 1 && withOutput.at(-1).output === d.text);
  s.of('agent.plan').forEach((p) => assert.equal(validateEvent(p), null));
  // ...but the name is nowhere the model or the record could see it
  const audit = await s.w.audit.exportJsonl();
  assert.ok(!audit.includes(full) && !new RegExp('\\b' + first + '\\b').test(audit));
  const saved = JSON.stringify([...s.w.agent.runs.entries()]);
  assert.ok(saved.includes('{{first_name}}') && !saved.includes(full), 'the saved plan keeps the placeholder');
  assert.equal(s.of('agent.progress').every((p) => !p.summary.includes(first)), true);
});

test('weekly summary and briefing steps carry their text too', async () => {
  const s = shop();
  await s.send('agent.ask', { text: 'Write my weekly summary' });
  await waitFor(() => s.of('agent.answer').length > 0);
  assert.equal(s.of('agent.answer')[0].drafts[0].title, 'Weekly summary (draft)');
  assert.match(s.of('agent.answer')[0].drafts[0].text, /^Week ending /);
});

test('when a model writes the answer, the name is still filled in on the device, never sent to the model', async () => {
  let seenByModel = '';
  const w0 = makeWorld({ clockStart: '2026-10-12T08:00:00Z' });
  const order = w0.orders.find((o) => o.id === 'ORD-1020');
  const first = order.shipTo.name.split(' ')[0];
  const model = scriptedModel([
    [{ type: 'tool_use', id: 'd', name: 'support.draftReply', input: { orderId: 'ORD-1020', buyerMessage: 'the card arrived creased' } }],
    (messages) => { seenByModel = JSON.stringify(messages); return [{ type: 'text', text: 'Here is a reply you can send:\n' + JSON.parse(messages.at(-1).content[0].content).message }]; },
  ]);
  const w = w0;
  const svc = createAgentService({ registry: w.registry, extensionId: EXT, agent: w.agent, model });
  const events = [];
  // a goal the planner does not know, so the model path runs
  await svc.handle(msg('agent.ask', { text: 'Please write something kind to the person whose card arrived creased' }), sender, (e) => events.push(e));
  await waitFor(() => events.some((e) => e.event === 'agent.answer'));
  const ans = events.find((e) => e.event === 'agent.answer');
  assert.ok(seenByModel.includes('{{first_name}}') && !seenByModel.includes(first), 'the model saw only the placeholder');
  assert.ok(ans.text.includes(`Hi ${first},`) && !ans.text.includes('{{'), 'the panel sees the name');
  assert.equal(ans.drafts[0].notes.includes('RET-3'), true);
  assert.equal(validateEvent(ans), null);
});

test('very long drafts are cut with a flag, and the event rules reject malformed output', async () => {
  const { copyableOf, MAX_COPY_CHARS } = await import('./plan.js');
  const c = copyableOf('report.weeklyDraft', { text: 'x'.repeat(MAX_COPY_CHARS + 500) });
  assert.equal(c.truncated, true); assert.equal(c.text.length, MAX_COPY_CHARS);
  assert.equal(copyableOf('orders.stats', { total: 1 }), null);
  assert.equal(copyableOf('support.draftReply', null), null);
  const ok = { source: 'tcgss-agent', v: 1 };
  assert.match(validateEvent({ ...ok, event: 'agent.plan', steps: [{ text: 'x', state: 'done', output: 5 }] }), /output/);
  assert.match(validateEvent({ ...ok, event: 'agent.answer', status: 'done', text: 't', drafts: [{ title: 'a' }] }), /drafts/);
  assert.match(validateEvent({ ...ok, event: 'agent.answer', status: 'done', text: 't', drafts: Array(6).fill({ title: 'a', text: 'b' }) }), /drafts/);
  assert.equal(validateEvent({ ...ok, event: 'agent.answer', status: 'done', text: 't', drafts: [{ title: 'a', text: 'b', notes: 'c' }] }), null);
});
