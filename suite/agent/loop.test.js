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

test('anthropic adapter needs env vars and builds the request (fake fetch, no network)', async () => {
  assert.throws(() => createAnthropicModel({ env: {} }), /API_KEY/);
  assert.throws(() => createAnthropicModel({ env: { ANTHROPIC_API_KEY: 'k' } }), /MODEL/);
  let seen;
  const fetchImpl = async (url, init) => { seen = { url, init }; return { ok: true, json: async () => ({ content: [{ type: 'text', text: 'hi' }], usage: { input_tokens: 1000000, output_tokens: 0 } }) }; };
  const m = createAnthropicModel({ env: { ANTHROPIC_API_KEY: 'test-key', ANTHROPIC_MODEL: 'test-model' }, fetchImpl, centsPerMillionIn: 300 });
  const r = await m.complete(ask, [{ name: 'x' }], 'sys');
  assert.match(seen.url, /^https:\/\/api\.anthropic\.com\/v1\/messages$/);
  const body = JSON.parse(seen.init.body);
  assert.equal(body.model, 'test-model');
  assert.equal(body.system, 'sys');
  assert.equal(seen.init.headers['x-api-key'], 'test-key');
  assert.equal(r.costCents, 300);
  const failing = createAnthropicModel({ env: { ANTHROPIC_API_KEY: 'k', ANTHROPIC_MODEL: 'm' }, fetchImpl: async () => ({ ok: false, status: 429 }) });
  await assert.rejects(failing.complete(ask, []), /429/);
});
