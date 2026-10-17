import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createProxyModel, ProxyError, checkConversation, MAX_BODY_BYTES } from './proxy.js';
import { createProxyStub } from '../fixtures/proxy-stub.js';
import { runAgent } from '../loop.js';
import { makeWorld } from '../eval/harness.js';
import { scenarios } from '../eval/scenarios.js';
import { createAgentService, PANEL_SOURCE, validateEvent } from '../protocol.js';

const TOKEN = 'test-token-123';
const use = (id, name, input = {}) => ({ type: 'tool_use', id, name, input });
const q = [{ role: 'user', content: 'Who are my repeat buyers?' }];
const spec = { name: 'orders.stats', description: 'd', input_schema: { type: 'object', properties: {} } };

async function setup(opts = {}) {
  const stub = await createProxyStub({ token: TOKEN, ...opts });
  let tokenCalls = 0;
  const model = createProxyModel({ baseUrl: stub.url, getToken: async () => { tokenCalls += 1; return TOKEN; } });
  return { stub, model, tokenCalls: () => tokenCalls };
}

test('construction needs a site address and a token function', () => {
  assert.throws(() => createProxyModel({ getToken: () => 't' }), /baseUrl/);
  assert.throws(() => createProxyModel({ baseUrl: 'ftp://x', getToken: () => 't' }), /baseUrl/);
  assert.throws(() => createProxyModel({ baseUrl: 'https://x.example' }), /getToken/);
});

test('sends only messages and tools, with the login token, and never a system prompt or model name', async () => {
  const { stub, model, tokenCalls } = await setup();
  try {
    const r = await model.complete(q, [spec], 'a system prompt the server must not get');
    assert.deepEqual(r.content, [{ type: 'text', text: 'ok' }]);
    assert.deepEqual(stub.log.ignored, [], 'nothing but messages and tools was sent');
    assert.deepEqual(stub.log.authHeaders, ['Bearer ' + TOKEN]);
    assert.ok(stub.log.toolNames.has('orders.stats'), 'tool names go as they are, with the dot');
    await model.complete(q, [spec]);
    assert.equal(tokenCalls(), 2, 'the token is asked for on every call, not kept');
    assert.ok(Number.isInteger(r.costCents) && r.costCents >= 1 && r.costMillicents > 0 && r.usage.inputTokens > 0);
    assert.deepEqual(Object.keys(model.remaining).sort(), ['centsMonth', 'centsToday', 'runsToday']);
  } finally { await stub.close(); }
});

test('a whole question through the agent loop: tool steps, cost counted, remaining kept', async () => {
  const w = makeWorld();
  const sc = scenarios.find((s) => s.id === 'price-one-card'); // two tool steps, then an answer
  const { stub, model } = await setup({ script: (messages, tools, step) => ({ content: typeof sc.script[step] === 'function' ? sc.script[step](messages) : sc.script[step] }) });
  try {
    const out = await runAgent({ model, registry: w.registry, messages: [{ role: 'user', content: sc.user }] });
    assert.equal(out.status, 'done');
    assert.deepEqual(out.calls.map((c) => c.name), ['inventory.search', 'pricing.suggest']);
    assert.match(out.text, /LP: list at \$/);
    assert.equal(stub.log.requests.length, 3);
    assert.equal(model.remaining.runsToday, 4, 'one question used one run');
    assert.ok(stub.log.requests.every((r) => r.bytes < MAX_BODY_BYTES));
    assert.ok(stub.log.toolNames.size >= 25, 'the registry specs went as they are');
    assert.ok([...stub.log.toolNames].every((n) => !n.includes('__')));
    assert.ok(w.limits.usage({ calls: 0, spendCents: 0 }) && true);
  } finally { await stub.close(); }
});

test('the shape of a conversation is checked before anything is sent', async () => {
  const { stub, model } = await setup();
  try {
    const tu = (id) => ({ role: 'assistant', content: [use(id, 'orders.stats')] });
    const tr = (id) => ({ role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: '{}' }] });
    const bad = {
      'nothing to ask': [],
      'ends on an assistant message': [...q, tu('a')],
      'first message is not plain text': [{ role: 'user', content: [{ type: 'text', text: 'q' }] }],
      'first message empty': [{ role: 'user', content: '  ' }],
      'tool results answer a different tool': [...q, tu('a'), tr('b')],
      'a step without tools followed by more': [...q, { role: 'assistant', content: [{ type: 'text', text: 'hi' }] }, tr('a')],
      'roles out of order': [...q, tr('a'), tu('a')],
      'a result missing': [...q, { role: 'assistant', content: [use('a', 'x'), use('b', 'y')] }, tr('a')],
    };
    for (const [why, messages] of Object.entries(bad)) await assert.rejects(model.complete(messages, [spec]), (e) => e instanceof ProxyError && e.status === 400 && e.code === 'bad_request' && e.message.length > 10, why);
    const long = [...q];
    for (let i = 0; i < 8; i += 1) long.push(tu('s' + i), tr('s' + i));
    await assert.rejects(model.complete(long, [spec]), (e) => e.status === 429 && e.code === 'steps' && /at most 8/.test(e.message));
    const eight = long.slice(0, 15);
    assert.doesNotThrow(() => checkConversation(eight), 'eight model calls is allowed');
    assert.equal(stub.log.requests.length, 0, 'none of those reached the server');
  } finally { await stub.close(); }
});

test('refuses a tool name with "__" and a request over 60 KB, without sending', async () => {
  const { stub, model } = await setup();
  try {
    await assert.rejects(model.complete(q, [{ ...spec, name: 'a__b' }]), (e) => e.status === 400 && /"__"/.test(e.message));
    await assert.rejects(model.complete(q, [{ ...spec, description: 'x'.repeat(70000) }]), (e) => e.status === 413 && e.code === 'too_big');
    await assert.rejects(model.complete(q, 'nope'), (e) => e.status === 400);
    assert.equal(stub.log.requests.length, 0);
  } finally { await stub.close(); }
});

test('no token, no request; the token never appears in an error', async () => {
  const stub = await createProxyStub({ token: TOKEN });
  try {
    const none = createProxyModel({ baseUrl: stub.url, getToken: async () => '' });
    await assert.rejects(none.complete(q, [spec]), (e) => e.status === 401);
    assert.equal(stub.log.requests.length, 0);
    const wrong = createProxyModel({ baseUrl: stub.url, getToken: async () => 'wrong-secret-token' });
    await assert.rejects(wrong.complete(q, [spec]), (e) => { assert.equal(e.status, 401); assert.ok(!JSON.stringify([e.message, e.code, e.stack]).includes('wrong-secret-token')); return true; });
  } finally { await stub.close(); }
});

// The contract's error table: status, code, and what the seller is shown. resetsAt is kept when the server gives one.
const TABLE = [
  [400, 'bad_request', 'That request could not be understood.'],
  [402, 'plan', 'Your plan does not include the assistant.'],
  [403, 'blocked', 'The assistant is switched off for this account.'],
  [413, 'too_big', 'That question is too big to send.'],
  [429, 'runs', 'You have used your 5 questions for today.', '2026-10-18T00:00:00Z'],
  [429, 'calls', 'Too many steps today.', '2026-10-18T00:00:00Z'],
  [429, 'day', 'You have reached today\'s spending limit.', '2026-10-18T00:00:00Z'],
  [429, 'month', 'You have reached this month\'s spending limit.', '2026-11-01T00:00:00Z'],
  [429, 'global', 'The assistant is busy today for everyone. Try again tomorrow.', '2026-10-18T00:00:00Z'],
  [429, 'steps', 'One question can use at most 8 steps.'],
  [429, 'busy', 'One question at a time, please.'],
  [502, 'model_error', 'The assistant could not answer right now. Nothing was done.'],
  [503, 'off', 'The assistant is switched off.'],
  [503, 'try_again', 'A temporary problem. Please try again.'],
];
test('every status and code in the contract becomes a ProxyError with the server\'s words (and resetsAt)', async () => {
  const { stub, model } = await setup();
  try {
    for (const [status, code, error, resetsAt] of TABLE) {
      stub.failNext(status, code, error, resetsAt ? { resetsAt } : {});
      await assert.rejects(model.complete(q, [spec]), (e) => {
        assert.ok(e instanceof ProxyError && e.name === 'ProxyError');
        assert.equal(e.status, status); assert.equal(e.code, code); assert.equal(e.message, error);
        assert.equal(e.resetsAt, resetsAt);
        return true;
      }, `${status} ${code}`);
    }
    // 401 and a plan error that comes from the stub's own checks rather than a planned failure
    const free = await setup({ plan: 'free' });
    await assert.rejects(free.model.complete(q, [spec]), (e) => e.status === 402 && e.code === 'plan');
    await free.stub.close();
    // the server gave no sentence at all: a plain default is used
    stub.failNext(503, undefined, '');
    await assert.rejects(model.complete(q, [spec]), (e) => e.status === 503 && /not available/.test(e.message));
  } finally { await stub.close(); }
});

test('limits come back from the stub as the contract says: five runs a day, then a plain "runs" error', async () => {
  const { stub, model } = await setup();
  try {
    for (let i = 0; i < 5; i += 1) await model.complete(q, [spec]);
    assert.equal(model.remaining.runsToday, 0);
    await assert.rejects(model.complete(q, [spec]), (e) => e.status === 429 && e.code === 'runs' && /2026-10-18/.test(e.resetsAt));
    const st = await model.status();
    assert.equal(st.available, true);
    assert.equal(st.remaining.runsToday, 0);
  } finally { await stub.close(); }
});

test('server down or too slow: a plain network error, nothing thrown raw', async () => {
  const stub = await createProxyStub({ token: TOKEN });
  const url = stub.url; await stub.close();
  const gone = createProxyModel({ baseUrl: url, getToken: async () => TOKEN });
  await assert.rejects(gone.complete(q, [spec]), (e) => e instanceof ProxyError && e.code === 'network' && /connection/.test(e.message));
  const slow = createProxyModel({ baseUrl: 'http://127.0.0.1:1', getToken: async () => TOKEN, fetchImpl: (u, init) => new Promise((_, rej) => init.signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' })))), timeoutMs: 30 });
  await assert.rejects(slow.complete(q, [spec]), (e) => e.code === 'network' && /too long/.test(e.message));
});

test('a model-door error reaches the panel in plain words, with its code and when it comes back', async () => {
  const EXT = 'abcdefghijklmnopabcdefghijklmnop';
  const w = makeWorld();
  const { stub, model } = await setup();
  try {
    stub.failNext(429, 'day', 'You have reached today\'s spending limit.', { resetsAt: '2026-10-18T00:00:00Z' });
    const svc = createAgentService({ registry: w.registry, extensionId: EXT, agent: w.agent, model });
    const events = [];
    await svc.handle({ source: PANEL_SOURCE, v: 1, id: 'm1', type: 'agent.ask', payload: { text: 'Tell me something nice' } }, { id: EXT }, (e) => events.push(e));
    for (let i = 0; i < 100 && !events.some((e) => e.event === 'agent.answer'); i += 1) await new Promise((r) => setTimeout(r, 10));
    const a = events.find((e) => e.event === 'agent.answer');
    assert.equal(a.status, 'error'); assert.equal(a.text, 'You have reached today\'s spending limit.');
    assert.equal(a.code, 'day'); assert.equal(a.resetsAt, '2026-10-18T00:00:00Z');
    assert.equal(validateEvent(a), null);
  } finally { await stub.close(); }
});

test('the proxy adapter uses only what a browser worker has (no Node-only globals)', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('./proxy.js', import.meta.url), 'utf8').replace(/\/\/.*$/gm, '');
  for (const nodeOnly of ['Buffer', 'process.', 'require(', "from 'node:", 'from "node:']) assert.ok(!src.includes(nodeOnly), nodeOnly);
});
