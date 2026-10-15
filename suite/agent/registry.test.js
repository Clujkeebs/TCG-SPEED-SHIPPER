import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRegistry, validateArgs } from './registry.js';
import { createLimits } from './limits.js';

const echo = { name: 'demo.echo', description: 'echo', tier: 'read', inputSchema: { type: 'object', required: ['text'], properties: { text: { type: 'string' }, n: { type: 'integer', minimum: 1, maximum: 5 } } }, handler: (a) => ({ said: a.text }) };

test('registers and runs a read tool, and logs it', async () => {
  const r = createRegistry().register(echo);
  const out = await r.run('demo.echo', { text: 'hi' });
  assert.deepEqual(out, { ok: true, result: { said: 'hi' } });
  const log = await r.audit.list();
  assert.equal(log.length, 1);
  assert.equal(log[0].outcome, 'ok');
});

test('rejects bad registrations', () => {
  const r = createRegistry();
  assert.throws(() => r.register({ ...echo, name: 'bad name' }));
  assert.throws(() => r.register({ ...echo, tier: 'root' }));
  assert.throws(() => r.register({ ...echo, handler: null }));
  assert.throws(() => r.register({ ...echo, description: '' }));
  r.register(echo);
  assert.throws(() => r.register(echo), /already/);
});

test('validates arguments', async () => {
  assert.deepEqual(validateArgs(echo.inputSchema, { text: 'a', n: 3 }), []);
  assert.match(validateArgs(echo.inputSchema, {}).join(), /text is required/);
  assert.match(validateArgs(echo.inputSchema, { text: 5 }).join(), /must be a string/);
  assert.match(validateArgs(echo.inputSchema, { text: 'a', n: 9 }).join(), /at most/);
  assert.match(validateArgs(echo.inputSchema, { text: 'a', extra: 1 }).join(), /unknown argument/);
  const r = createRegistry().register(echo);
  const out = await r.run('demo.echo', { text: 1 });
  assert.equal(out.ok, false);
  assert.equal((await r.audit.list())[0].outcome, 'error');
});

test('unknown tool is an error, not a crash', async () => {
  const r = createRegistry();
  assert.equal((await r.run('nope', {})).ok, false);
});

test('act tools are refused without an approval callback', async () => {
  let ran = false;
  const r = createRegistry().register({ name: 'demo.change', description: 'changes', tier: 'act', handler: () => { ran = true; return 1; } });
  const out = await r.run('demo.change', {});
  assert.equal(out.ok, false);
  assert.equal(out.denied, true);
  assert.equal(ran, false);
  assert.equal((await r.audit.list())[0].outcome, 'denied');
});

test('act tools run only when approved, and the approver is logged', async () => {
  let ran = 0;
  const r = createRegistry().register({ name: 'demo.change', description: 'changes', tier: 'act', handler: () => ++ran });
  assert.equal((await r.run('demo.change', {}, { approve: async () => false })).denied, true);
  assert.equal(ran, 0);
  const ok = await r.run('demo.change', {}, { approve: async (req) => ({ approved: req.tool === 'demo.change', by: 'owner' }) });
  assert.equal(ok.ok, true);
  assert.equal(ran, 1);
  const log = await r.audit.list();
  assert.equal(log[1].approvedBy, 'owner');
});

test('autopilot tools need an enabled automation', async () => {
  const r = createRegistry().register({ name: 'demo.auto', description: 'auto', tier: 'autopilot', handler: () => 'ok' });
  assert.equal((await r.run('demo.auto', {})).denied, true);
  assert.equal((await r.run('demo.auto', {}, { automation: { enabled: false } })).denied, true);
  assert.equal((await r.run('demo.auto', {}, { automation: { enabled: true } })).ok, true);
});

test('handler errors are caught and logged', async () => {
  const r = createRegistry().register({ name: 'demo.boom', description: 'x', tier: 'read', handler: () => { throw new Error('boom'); } });
  const out = await r.run('demo.boom', {});
  assert.equal(out.ok, false);
  assert.equal((await r.audit.list())[0].outcome, 'error');
});

test('limits and kill switch stop tools and are logged as denied', async () => {
  const limits = createLimits({ perRun: { maxCalls: 2, maxSpendCents: 10 } });
  const r = createRegistry({ limits }).register(echo).register({ name: 'demo.paid', description: 'costs', tier: 'read', costCents: 6, handler: () => 1 });
  const ctx = {};
  assert.equal((await r.run('demo.echo', { text: 'a' }, ctx)).ok, true);
  assert.equal((await r.run('demo.paid', {}, ctx)).ok, true);
  assert.match((await r.run('demo.echo', { text: 'a' }, ctx)).error, /call limit/);
  limits.kill();
  assert.match((await r.run('demo.echo', { text: 'a' }, {})).error, /kill switch/);
  assert.equal((await r.audit.list()).filter((e) => e.outcome === 'denied').length, 2);
});

test('specs show tier and schema to the model', () => {
  const s = createRegistry().register(echo).specs();
  assert.equal(s[0].name, 'demo.echo');
  assert.match(s[0].description, /^\[read\]/);
  assert.equal(s[0].input_schema.required[0], 'text');
});
