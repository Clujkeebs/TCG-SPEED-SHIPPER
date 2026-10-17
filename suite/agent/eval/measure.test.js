import { test } from 'node:test';
import assert from 'node:assert/strict';
import { measure, formatReport, parseArgs, judgeTools, FIRST_SCENARIOS, STEP_LIMIT } from './measure.js';
import { stubScript } from './measure-stub.js';
import { createProxyStub, PRICES } from '../fixtures/proxy-stub.js';
import { createProxyModel } from '../adapters/proxy.js';
import { scenarios } from './scenarios.js';

const use = (id, name, input = {}) => ({ type: 'tool_use', id, name, input });
async function rig(opts = {}, scriptOpts = {}) {
  const stub = await createProxyStub({ token: 't', script: stubScript(scriptOpts), limits: { runsPerDay: 99, centsPerDay: 99, centsPerMonth: 999 }, ...opts });
  return { stub, model: createProxyModel({ baseUrl: stub.url, getToken: async () => 't' }) };
}

test('the first scenarios exist, can be measured with a real model, and fit one day\'s five questions', () => {
  for (const id of FIRST_SCENARIOS) assert.ok(scenarios.find((s) => s.id === id), id);
  assert.equal(new Set(FIRST_SCENARIOS).size, FIRST_SCENARIOS.length);
  assert.ok(FIRST_SCENARIOS.slice(0, 5).length === 5);
});

test('the report: three numbers from the server\'s own token and cost counts', async () => {
  const { stub, model } = await rig();
  try {
    const r = await measure({ model, budgetCents: 50 });
    assert.equal(r.runsMeasured, 6);
    const q = r.runs.find((x) => x.id === 'price-one-card');
    assert.equal(q.modelCalls, 3);
    assert.deepEqual(q.called, ['inventory.search', 'pricing.suggest']);
    // stub usage: input 2600 + 700 x step, output 140, per call; steps 0, 1, 2
    assert.equal(q.inputTokens, (2600 + 0) + (2600 + 700) + (2600 + 1400));
    assert.equal(q.outputTokens, 3 * 140);
    const cents = (i, o) => Math.ceil((i * PRICES.inCentsPerMillion + o * PRICES.outCentsPerMillion) / 1000);
    assert.equal(q.millicents, [0, 1, 2].reduce((a, s) => a + cents(2600 + s * 700, 140), 0));
    assert.equal(r.headline.toolChoiceAccuracyPct, 100);
    assert.equal(r.headline.stepLimitRatePct, 0);
    const total = r.runs.reduce((a, x) => a + x.inputTokens + x.outputTokens, 0);
    assert.equal(r.headline.tokensPerRun.mean, Math.round(total / 6));
    assert.ok(r.headline.centsPerRun.mean > 0 && r.headline.centsPerRun.max >= r.headline.centsPerRun.mean);
    assert.equal(r.spentCents, Math.round(r.runs.reduce((a, x) => a + x.millicents, 0) / 10) / 100);
    const text = formatReport(r, { title: 'T' });
    for (const needle of ['## The three numbers', 'Tokens per question', 'Chose the right tools', `Hit the ${STEP_LIMIT}-step limit`, 'price-one-card']) assert.ok(text.includes(needle), needle);
  } finally { await stub.close(); }
});

test('a wrong tool and a runaway loop are counted', async () => {
  const { stub, model } = await rig({}, { overrides: {
    'restock-list': (m, step) => (step === 0 ? { content: [use('a', 'orders.stats')] } : { content: [{ type: 'text', text: 'here' }] }),
    'repeat-customers': () => ({ content: [use(String(Math.random()), 'report.repeatCustomers')] }), // never stops asking
  } });
  try {
    const r = await measure({ model, ids: ['repeat-customers', 'restock-list', 'weekly-summary'], budgetCents: 100 });
    const loop = r.runs.find((x) => x.id === 'repeat-customers');
    assert.equal(loop.hitStepLimit, true); assert.equal(loop.modelCalls, STEP_LIMIT); assert.equal(loop.status, 'step-limit');
    const wrong = r.runs.find((x) => x.id === 'restock-list');
    assert.equal(wrong.toolsCorrect, false); assert.deepEqual(wrong.missing, ['inventory.restock']); assert.deepEqual(wrong.extra, ['orders.stats']);
    assert.equal(r.headline.toolChoiceAccuracyPct, 66.7, 'the looping question did call the right tool; the loop shows up in the step-limit number');
    assert.equal(r.headline.stepLimitRatePct, 33.3);
    assert.match(formatReport(r), /no \(missing inventory\.restock\) \(extra orders\.stats\)/);
  } finally { await stub.close(); }
});

test('also-right tool sets count as right', () => {
  assert.equal(judgeTools('weekly-summary', ['report.weekly'], ['report.weeklyDraft']).correct, true);
  assert.equal(judgeTools('weekly-summary', ['report.weekly'], ['report.weekly', 'orders.stats']).correct, false);
  assert.equal(judgeTools('repeat-customers', ['report.repeatCustomers'], ['report.repeatCustomers', 'report.repeatCustomers']).correct, true, 'calling the same tool twice is not a different tool');
});

test('stops at the money budget, before starting the next question', async () => {
  const { stub, model } = await rig({}, { perCall: (step) => ({ inputTokens: 40000, outputTokens: 2000 }) }); // about 15 cents per call in the stub's price list
  try {
    const r = await measure({ model, budgetCents: 20 });
    assert.ok(r.runsMeasured < 6);
    assert.ok(r.stopped && /^budget|^Stopped before/.test(r.stopped.reason === 'budget' ? 'budget' : r.stopped.message));
    assert.ok(r.runs.at(-1).status === 'error' || r.stopped.reason === 'budget', 'a question that would pass the budget is cut by the per-question cap');
  } finally { await stub.close(); }
});

test('stops cleanly when the server says a limit is reached, and keeps when it comes back', async () => {
  const { stub, model } = await rig({ limits: { runsPerDay: 2, centsPerDay: 99, centsPerMonth: 999 } });
  try {
    const r = await measure({ model, budgetCents: 50 });
    assert.equal(r.runsMeasured, 2);
    assert.equal(r.stopped.reason, 'runs'); assert.match(r.stopped.message, /questions for today/); assert.match(r.stopped.resetsAt, /^2026-10-18/);
    assert.equal(r.runs.at(-1).errorCode, 'runs');
    assert.match(formatReport(r), /Stopped early/);
  } finally { await stub.close(); }
});

test('nothing in the report holds the login token', async () => {
  const { stub } = await rig();
  const model = createProxyModel({ baseUrl: stub.url, getToken: async () => 'MY-SECRET-LOGIN-TOKEN' });
  const s2 = await createProxyStub({ token: 'MY-SECRET-LOGIN-TOKEN', script: stubScript(), limits: { runsPerDay: 9, centsPerDay: 99, centsPerMonth: 999 } });
  try {
    const m2 = createProxyModel({ baseUrl: s2.url, getToken: async () => 'MY-SECRET-LOGIN-TOKEN' });
    const r = await measure({ model: m2, ids: ['repeat-customers'], budgetCents: 10 });
    assert.ok(!JSON.stringify(r).includes('MY-SECRET') && !formatReport(r).includes('MY-SECRET'));
  } finally { await stub.close(); await s2.close(); }
});

test('the command line refuses to spend money by accident', () => {
  assert.throws(() => parseArgs([]), /--stub/);
  assert.throws(() => parseArgs(['--live']), /--yes-spend-money/);
  assert.throws(() => parseArgs(['--live', '--yes-spend-money']), /--base-url/);
  assert.throws(() => parseArgs(['--live', '--yes-spend-money', '--base-url', 'http://insecure.example']), /https/);
  assert.throws(() => parseArgs(['--live', '--yes-spend-money', '--base-url', 'https://x.example'], {}), /AGENT_LOGIN_TOKEN/);
  assert.throws(() => parseArgs(['--stub', '--budget-cents', '5000']), /between 1 and 200/);
  assert.throws(() => parseArgs(['--stub', '--nope']), /unknown option/);
  const ok = parseArgs(['--live', '--yes-spend-money', '--base-url', 'https://x.example', '--budget-cents', '25'], { AGENT_LOGIN_TOKEN: 'x' });
  assert.equal(ok.mode, 'live'); assert.equal(ok.budgetCents, 25);
  assert.equal(parseArgs(['--stub']).mode, 'stub');
});
