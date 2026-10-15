import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCron, cronMatches, validateSaved, createAutomationStore, isDue, runAutomation, tick } from './automations.js';
import { createRegistry } from './registry.js';
import { createLimits } from './limits.js';

const mondayEight = '2026-10-12T08:00:00Z'; // a Monday
const base = { id: 'a1', name: 'Monday summary', trigger: { type: 'cron', value: '0 8 * * 1' }, steps: [{ tool: 'demo.read' }], approvalMode: 'always', enabled: true };

function world() {
  const log = { acted: 0 };
  const registry = createRegistry({ limits: createLimits({ perRun: { maxCalls: 10 } }) })
    .register({ name: 'demo.read', description: 'r', tier: 'read', handler: () => 'seen' })
    .register({ name: 'demo.act', description: 'changes', tier: 'act', handler: () => ++log.acted })
    .register({ name: 'demo.auto', description: 'auto', tier: 'autopilot', handler: () => 'auto' });
  return { registry, log };
}

test('cron parsing and matching', () => {
  assert.ok(parseCron('*/15 * * * *'));
  assert.equal(parseCron('61 * * * *'), null);
  assert.equal(parseCron('* * * *'), null);
  assert.equal(parseCron('0 8 * * 9'), null);
  assert.equal(cronMatches('0 8 * * 1', mondayEight), true);
  assert.equal(cronMatches('0 8 * * 1', '2026-10-13T08:00:00Z'), false); // Tuesday
  assert.equal(cronMatches('*/15 * * * *', '2026-10-12T08:45:00Z'), true);
  assert.equal(cronMatches('*/15 * * * *', '2026-10-12T08:50:00Z'), false);
  assert.equal(cronMatches('0 8,17 * * 1-5', '2026-10-12T17:00:30Z'), true);
});

test('saved shape is checked, including the cron text', () => {
  assert.equal(validateSaved(base).ok, true);
  assert.match(validateSaved({ ...base, trigger: { type: 'cron', value: 'soon' } }).errors.join(), /cron/);
  assert.equal(validateSaved({ ...base, trigger: { type: 'event', value: 'new-order' } }).ok, true);
  assert.match(validateSaved({ ...base, trigger: { type: 'event', value: 'full-moon' } }).errors.join(), /event trigger/);
  assert.equal(validateSaved({ ...base, steps: [] }).ok, false);
  assert.equal(validateSaved({ ...base, approvalMode: 'sometimes' }).ok, false);
});

test('store saves copies and lists them', () => {
  const s = createAutomationStore();
  s.save(base);
  assert.throws(() => s.save({ ...base, id: 'bad', steps: [] }));
  const got = s.get('a1');
  got.enabled = false;
  assert.equal(s.get('a1').enabled, true);
  s.setEnabled('a1', false);
  assert.equal(s.list()[0].enabled, false);
  assert.throws(() => s.setEnabled('nope', true));
});

test('a disabled automation never runs', async () => {
  const { registry } = world();
  assert.equal(isDue({ ...base, enabled: false }, mondayEight), false);
  const out = await runAutomation({ ...base, enabled: false }, { registry });
  assert.equal(out.ok, false);
  assert.equal((await registry.audit.list()).length, 0);
});

test('read and draft steps run and are logged as the automation', async () => {
  const { registry } = world();
  const out = await runAutomation(base, { registry, now: mondayEight });
  assert.equal(out.ok, true);
  assert.equal(out.steps[0].result, 'seen');
  assert.equal((await registry.audit.list())[0].actor, 'automation');
});

test('act steps: always asks, no approver means refused', async () => {
  const { registry, log } = world();
  const a = { ...base, steps: [{ tool: 'demo.act' }] };
  const refused = await runAutomation(a, { registry });
  assert.equal(refused.steps[0].denied, true);
  assert.equal(log.acted, 0);
  let asked = 0;
  const ok = await runAutomation(a, { registry, approve: async () => { asked++; return { approved: true, by: 'owner' }; } });
  assert.equal(ok.ok, true);
  assert.equal(asked, 1);
  const again = await runAutomation({ ...a, lastRunAt: mondayEight }, { registry, approve: async () => { asked++; return false; } });
  assert.equal(again.steps[0].denied, true);
  assert.equal(asked, 2);
});

test('first-run asks once, then the owner setting covers it', async () => {
  const { registry, log } = world();
  const a = { ...base, approvalMode: 'first-run', steps: [{ tool: 'demo.act' }] };
  assert.equal((await runAutomation(a, { registry })).steps[0].denied, true);
  const second = await runAutomation({ ...a, lastRunAt: mondayEight }, { registry });
  assert.equal(second.ok, true);
  assert.equal(log.acted, 1);
  const entry = (await registry.audit.list()).at(-1);
  assert.equal(entry.approvedBy, 'owner-setting:first-run');
});

test('never: owner pre-approved, still limited and killable', async () => {
  const { registry, log } = world();
  const a = { ...base, approvalMode: 'never', steps: [{ tool: 'demo.act' }, { tool: 'demo.act' }] };
  assert.equal((await runAutomation(a, { registry })).ok, true);
  assert.equal(log.acted, 2);
  registry.limits.kill();
  const killed = await runAutomation(a, { registry });
  assert.equal(killed.ok, false);
  assert.equal(log.acted, 2);
});

test('autopilot tools run only inside an enabled automation', async () => {
  const { registry } = world();
  assert.equal((await registry.run('demo.auto', {})).denied, true);
  const out = await runAutomation({ ...base, steps: [{ tool: 'demo.auto' }] }, { registry });
  assert.equal(out.ok, true);
});

test('tick runs due automations once per minute', async () => {
  const { registry } = world();
  const store = createAutomationStore();
  store.save(base);
  store.save({ ...base, id: 'a2', trigger: { type: 'cron', value: '0 9 * * *' } });
  const first = await tick({ store, registry, now: mondayEight });
  assert.deepEqual(first.map((r) => r.id), ['a1']);
  assert.equal((await tick({ store, registry, now: '2026-10-12T08:00:30Z' })).length, 0);
  assert.equal(store.get('a1').lastRunAt, mondayEight);
  assert.equal((await tick({ store, registry, now: '2026-10-19T08:00:00Z' })).length, 1);
});
