import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runAgent, scriptedModel } from './loop.js';
import { createRegistry } from './registry.js';
import { createLimits } from './limits.js';
import { createAnthropicModel } from './adapters/anthropic.js';

const reg = (limits) => createRegistry({ limits }).register({ name: 'demo.add', description: 'add', tier: 'read', inputSchema: { type: 'object', required: ['a', 'b'], properties: { a: { type: 'integer' }, b: { type: 'integer' } } }, handler: ({ a, b }) => ({ sum: a + b }) });
const ask = [{ role: 'user', content: 'add' }];

test('loop calls tools and feeds results back', async () => {
  const model = scriptedModel([
    [{ type: 'tool_use', id: 't1', name: 'demo.add', input: { a: 2, b: 3 } }],
    (m) => [{ type: 'text', text: 'sum ' + JSON.parse(m.at(-1).content[0].content).sum }],
  ]);
  const out = await runAgent({ model, registry: reg(), messages: ask });
  assert.equal(out.status, 'done');
  assert.equal(out.text, 'sum 5');
  assert.deepEqual(out.calls.map((c) => c.name), ['demo.add']);
});

test('a refused or bad call is reported to the model as an error result', async () => {
  const model = scriptedModel([
    [{ type: 'tool_use', id: 't1', name: 'demo.add', input: { a: 'x' } }],
    (m) => [{ type: 'text', text: String(m.at(-1).content[0].is_error) }],
  ]);
  const out = await runAgent({ model, registry: reg(), messages: ask });
  assert.equal(out.text, 'true');
});

test('step limit ends a runaway loop', async () => {
  const again = [{ type: 'tool_use', id: 't', name: 'demo.add', input: { a: 1, b: 1 } }];
  const out = await runAgent({ model: scriptedModel(Array(10).fill(again)), registry: reg(), messages: ask, maxSteps: 3 });
  assert.equal(out.status, 'step-limit');
  assert.equal(out.calls.length, 3);
});

test('kill switch stops the loop before the next model call', async () => {
  const limits = createLimits();
  const model = scriptedModel([[{ type: 'text', text: 'never' }]]);
  limits.kill();
  const out = await runAgent({ model, registry: reg(limits), messages: ask });
  assert.equal(out.status, 'stopped');
  assert.equal(model.used, 0);
});

test('model spend counts against the run cap', async () => {
  const limits = createLimits({ perRun: { maxSpendCents: 5 } });
  const model = { complete: async () => ({ content: [{ type: 'text', text: 'x' }], costCents: 9 }) };
  const out = await runAgent({ model, registry: reg(limits), messages: ask });
  assert.equal(out.status, 'stopped');
  assert.match(out.reason, /spending/);
});

test('scripted model fails loudly when its script runs out', async () => {
  await assert.rejects(runAgent({ model: scriptedModel([]), registry: reg(), messages: ask }), /ran out/);
});

test('direct provider adapter: local experiments only, never in a page, renames dotted tool names both ways (fake fetch, no network)', async () => {
  const env = { ANTHROPIC_API_KEY: 'test-key', ANTHROPIC_MODEL: 'test-model', AGENT_LOCAL_EXPERIMENT: 'yes' };
  assert.throws(() => createAnthropicModel({ env: { ANTHROPIC_API_KEY: 'k', ANTHROPIC_MODEL: 'm' } }), /local experiments only/);
  assert.throws(() => createAnthropicModel({ env: { AGENT_LOCAL_EXPERIMENT: 'yes' } }), /API_KEY/);
  assert.throws(() => createAnthropicModel({ env: { ANTHROPIC_API_KEY: 'k', AGENT_LOCAL_EXPERIMENT: 'yes' } }), /MODEL/);
  globalThis.window = {};
  try { assert.throws(() => createAnthropicModel({ env }), /web page/); } finally { delete globalThis.window; }
  let seen;
  const fetchImpl = async (url, init) => { seen = { url, init }; return { ok: true, json: async () => ({ content: [{ type: 'tool_use', id: 'x', name: 'orders__search', input: {} }], usage: { input_tokens: 1000000, output_tokens: 0 } }) }; };
  const m = createAnthropicModel({ env, fetchImpl, centsPerMillionIn: 300 });
  const history = [{ role: 'user', content: 'q' }, { role: 'assistant', content: [{ type: 'tool_use', id: 'p', name: 'orders.stats', input: {} }] }, { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'p', content: '{}' }] }];
  const r = await m.complete(history, [{ name: 'orders.search', description: 'd', input_schema: { type: 'object', properties: {} } }], 'sys');
  const body = JSON.parse(seen.init.body);
  assert.match(seen.url, /^https:\/\/api\.anthropic\.com\/v1\/messages$/);
  assert.equal(body.tools[0].name, 'orders__search', 'tool names go out without dots');
  assert.equal(body.messages[1].content[0].name, 'orders__stats', 'and so does earlier history');
  assert.equal(r.content[0].name, 'orders.search', 'names come back with dots');
  assert.equal(body.model, 'test-model'); assert.equal(body.system, 'sys');
  assert.equal(seen.init.headers['x-api-key'], 'test-key');
  assert.equal(r.costCents, 300);
  await assert.rejects(m.complete(history, [{ name: 'a__b', description: 'd', input_schema: {} }]), /already contains/);
  const failing = createAnthropicModel({ env, fetchImpl: async () => ({ ok: false, status: 429 }) });
  await assert.rejects(failing.complete(ask, []), /429/);
});
