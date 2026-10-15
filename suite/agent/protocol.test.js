import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateRequest, isTrustedSender, createAgentService, MESSAGE_TYPES, PANEL_SOURCE, AGENT_SOURCE } from './protocol.js';
import { createRegistry } from './registry.js';
import { scriptedModel } from './loop.js';

const EXT = 'abcdefghijklmnopabcdefghijklmnop';
const sender = { id: EXT, url: `chrome-extension://${EXT}/panel.html` };
const msg = (type, payload, id = 'm1') => ({ source: PANEL_SOURCE, v: 1, id, type, ...(payload === undefined ? {} : { payload }) });
const tick = () => new Promise((r) => setTimeout(r, 60));

function setup(steps, approvalTimeoutMs = 5000) {
  let acted = 0;
  const registry = createRegistry()
    .register({ name: 'demo.read', description: 'r', tier: 'read', handler: () => ({ n: 1 }) })
    .register({ name: 'demo.act', description: 'changes a thing', tier: 'act', handler: () => ++acted });
  const svc = createAgentService({ registry, model: scriptedModel(steps), extensionId: EXT, approvalTimeoutMs });
  const events = [];
  return { svc, registry, events, emit: (e) => events.push(e), acted: () => acted };
}

test('only our own extension is trusted', () => {
  assert.equal(isTrustedSender(sender, EXT), true);
  assert.equal(isTrustedSender({ id: EXT }, EXT), true);
  assert.equal(isTrustedSender({ id: 'other' }, EXT), false);
  assert.equal(isTrustedSender({ id: EXT, url: 'https://tcgspeedshipper.com/' }, EXT), false);
  assert.equal(isTrustedSender({ url: `chrome-extension://${EXT}/x` }, EXT), false); // a web page cannot claim an id
  assert.equal(isTrustedSender(null, EXT), false);
  assert.equal(isTrustedSender(sender, ''), false);
});

test('requests are checked like the bridge: source, version, id, type, payload, extra fields', () => {
  const ok = (m) => validateRequest(m, sender, EXT);
  assert.equal(ok(msg('agent.hello')).ok, true);
  assert.equal(ok(msg('agent.ask', { text: 'hi' })).ok, true);
  assert.equal(ok({ ...msg('agent.hello'), source: 'tcgss-app' }).ok, false);
  assert.equal(ok({ ...msg('agent.hello'), v: 2 }).ok, false);
  assert.equal(ok(msg('agent.hello', undefined, '')).ok, false);
  assert.equal(ok(msg('agent.delete')).ok, false);
  assert.equal(ok({ ...msg('agent.hello'), extra: 1 }).ok, false);
  assert.match(ok(msg('agent.ask', { text: '' })).error, /text/);
  assert.match(ok(msg('agent.ask', { text: 'x'.repeat(2001) })).error, /too long/);
  assert.match(ok(msg('agent.ask', { text: 'a', tool: 'demo.act' })).error, /unexpected/);
  assert.equal(ok(msg('agent.approve', { approvalId: 'ap-1', approved: 'yes' })).ok, false);
  assert.equal(ok(msg('agent.audit', { limit: 999 })).ok, false);
  assert.equal(validateRequest(msg('agent.hello'), { id: 'evil' }, EXT).ok, false);
  assert.ok(!MESSAGE_TYPES.includes('store.put')); // no bridge types leak in
});

test('hello lists tools and tiers; a bad sender gets an error, nothing runs', async () => {
  const { svc } = setup([]);
  const r = await svc.handle(msg('agent.hello'), sender);
  assert.equal(r.ok, true);
  assert.equal(r.source, AGENT_SOURCE);
  assert.deepEqual(r.result.tools.map((t) => t.tier), ['read', 'act']);
  const bad = await svc.handle(msg('agent.ask', { text: 'hi' }), { id: 'evil' });
  assert.equal(bad.ok, false);
});

test('ask streams progress then the answer', async () => {
  const { svc, events, emit } = setup([[{ type: 'tool_use', id: 't', name: 'demo.read', input: {} }], [{ type: 'text', text: 'done' }]]);
  const r = await svc.handle(msg('agent.ask', { text: 'go' }), sender, emit);
  assert.equal(r.ok, true);
  await tick();
  assert.deepEqual(events.map((e) => e.event), ['agent.progress', 'agent.answer']);
  assert.equal(events[1].text, 'done');
  assert.equal(svc.busy, false);
});

test('only one conversation at a time', async () => {
  const { svc, emit } = setup([[{ type: 'tool_use', id: 't', name: 'demo.act', input: {} }], [{ type: 'text', text: 'x' }]]);
  await svc.handle(msg('agent.ask', { text: 'go' }), sender, emit);
  await tick();
  const second = await svc.handle(msg('agent.ask', { text: 'again' }, 'm2'), sender, emit);
  assert.equal(second.ok, false);
  assert.match(second.error, /already working/);
});

test('act tool waits for the panel; approve lets it run', async () => {
  const s = setup([[{ type: 'tool_use', id: 't', name: 'demo.act', input: {} }], [{ type: 'text', text: 'changed' }]]);
  await s.svc.handle(msg('agent.ask', { text: 'go' }), sender, s.emit);
  await tick();
  const ask = s.events.find((e) => e.event === 'agent.approval-needed');
  assert.ok(ask && ask.tool === 'demo.act');
  assert.equal(s.acted(), 0);
  const r = await s.svc.handle(msg('agent.approve', { approvalId: ask.approvalId, approved: true }, 'm2'), sender, s.emit);
  assert.equal(r.ok, true);
  await tick();
  assert.equal(s.acted(), 1);
  assert.equal((await s.registry.audit.list()).at(-1).approvedBy, 'user');
  assert.equal((await s.svc.handle(msg('agent.approve', { approvalId: ask.approvalId, approved: true }, 'm3'), sender)).ok, false); // already used
});

test('declined, timed out, or stopped approvals do not run the tool', async () => {
  const steps = () => [[{ type: 'tool_use', id: 't', name: 'demo.act', input: {} }], [{ type: 'text', text: 'ok' }]];
  const a = setup(steps());
  await a.svc.handle(msg('agent.ask', { text: 'go' }), sender, a.emit);
  await tick();
  await a.svc.handle(msg('agent.approve', { approvalId: a.events[0].approvalId, approved: false }), sender);
  await tick();
  assert.equal(a.acted(), 0);

  const b = setup(steps(), 80); // times out after 80 ms
  await b.svc.handle(msg('agent.ask', { text: 'go' }), sender, b.emit);
  await new Promise((r) => setTimeout(r, 400));
  assert.equal(b.acted(), 0);
  assert.equal(b.events.at(-1).event, 'agent.answer');

  const c = setup(steps());
  await c.svc.handle(msg('agent.ask', { text: 'go' }), sender, c.emit);
  await tick();
  const stop = await c.svc.handle(msg('agent.stop'), sender, c.emit);
  assert.equal(stop.result.killed, true);
  await tick();
  assert.equal(c.acted(), 0);
  assert.ok(c.events.some((e) => e.event === 'agent.stopped'));
});

test('kill switch blocks new questions until resume', async () => {
  const { svc } = setup([[{ type: 'text', text: 'hi' }]]);
  await svc.handle(msg('agent.stop'), sender);
  assert.match((await svc.handle(msg('agent.ask', { text: 'hi' }, 'm2'), sender)).error, /kill switch/);
  assert.equal((await svc.handle(msg('agent.limits', undefined, 'm3'), sender)).result.killed, true);
  await svc.handle(msg('agent.resume', undefined, 'm4'), sender);
  assert.equal((await svc.handle(msg('agent.ask', { text: 'hi' }, 'm5'), sender)).ok, true);
});

test('audit view returns hashed entries only', async () => {
  const s = setup([[{ type: 'tool_use', id: 't', name: 'demo.read', input: {} }], [{ type: 'text', text: 'x' }]]);
  await s.svc.handle(msg('agent.ask', { text: 'go' }), sender, s.emit);
  await tick();
  const r = await s.svc.handle(msg('agent.audit', { limit: 5 }, 'm2'), sender);
  assert.equal(r.result.entries.length, 1);
  assert.match(r.result.entries[0].argsHash, /^[0-9a-f]{64}$/);
});
