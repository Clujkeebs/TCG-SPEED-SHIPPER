// Cost-per-run measurement: run some of the eval scenarios against a REAL model through the proxy (adapters/proxy.js), with a
// small money budget, and report three numbers plus the cost the server counted. Plan and report format: docs/suite/AGENT-MEASURE.md.
//   node suite/agent/eval/measure.js --stub                     safe: runs against the local contract stub, spends nothing
//   node suite/agent/eval/measure.js --live --base-url https://tcgspeedshipper.com --budget-cents 25 --yes-spend-money
//        needs AGENT_LOGIN_TOKEN in the environment (the site login token; never printed or written anywhere).
// Tests only ever use the stub. Nothing here sends a message, changes a listing or spends money by itself:
// the only cost is the model's own use, counted by the server and capped by --budget-cents and the server's limits.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runAgent } from '../loop.js';
import { createProxyModel, ProxyError } from '../adapters/proxy.js';
import { makeWorld } from './harness.js';
import { scenarios } from './scenarios.js';

// Run these first, in this order. Day one fits the default per-person limit of 5 questions.
export const FIRST_SCENARIOS = [
  'repeat-customers',   // one obvious tool: the baseline
  'shipping-cadence',   // one tool, a second near-miss tool exists (orders.stats)
  'restock-list',       // must pick inventory.restock, not a generic search
  'price-one-card',     // two steps in a row: search, then price
  'weekly-summary',     // report.weekly or report.weeklyDraft: both are fine
  'support-where',      // a draft tool, and it must pull the order id out of the sentence
];
// Different tool sets that are also right (the scripted scenarios name one; a real model may pick another good path).
const ALSO_RIGHT = {
  'weekly-summary': [['report.weeklyDraft']],
  'restock-list': [['inventory.restock', 'inventory.search'], ['inventory.search', 'inventory.restock']],
  'shipping-cadence': [['orders.stats']],
};
export const STEP_LIMIT = 8;

const sameSet = (a, b) => a.length === b.length && [...a].sort().join('|') === [...b].sort().join('|');

export function judgeTools(id, expected, called) {
  const ok = [expected, ...(ALSO_RIGHT[id] || [])].some((e) => sameSet(e, [...new Set(called)]));
  return { correct: ok, missing: expected.filter((t) => !called.includes(t)), extra: called.filter((t) => !expected.includes(t)) };
}

// model: anything with complete(messages, tools) that returns { content, costCents, costMillicents?, usage? } (the proxy adapter).
export async function measure({ model, ids = FIRST_SCENARIOS, budgetCents = 10, makeWorldFn = makeWorld } = {}) {
  const runs = [];
  let spentMillicents = 0, stopped = null;
  for (const id of ids) {
    const sc = scenarios.find((s) => s.id === id);
    if (!sc) throw new Error('no scenario ' + id);
    if (spentMillicents >= budgetCents * 1000) { stopped = { reason: 'budget', message: `Stopped before "${id}": ${(spentMillicents / 1000).toFixed(2)} of ${budgetCents} cents used.` }; break; }
    const world = makeWorldFn({ limitConfig: { perRun: { maxCalls: 25, maxSpendCents: Math.max(1, Math.ceil(budgetCents - spentMillicents / 1000)) } } });
    if (!sc.expect.calls.every((n) => world.registry.get(n))) { runs.push({ id, skipped: 'expects a tool that does not exist (a trap for the scripted model, not measurable)' }); continue; }
    const per = [];
    const recorder = {
      async complete(messages, tools, system) {
        const r = await model.complete(messages, tools, system);
        per.push({ inputTokens: (r.usage && r.usage.inputTokens) || 0, outputTokens: (r.usage && r.usage.outputTokens) || 0, millicents: Number.isFinite(r.costMillicents) ? r.costMillicents : (r.costCents || 0) * 1000 });
        return r;
      },
    };
    let out, error = null;
    try { out = await runAgent({ model: recorder, registry: world.registry, messages: [{ role: 'user', content: sc.user }], maxSteps: STEP_LIMIT }); }
    catch (err) { error = err; }
    const millicents = per.reduce((a, c) => a + c.millicents, 0);
    spentMillicents += millicents;
    const called = out ? out.calls.map((c) => c.name) : [];
    const verdict = judgeTools(id, sc.expect.calls, called);
    const hitLimit = (out && out.status === 'step-limit') || (error instanceof ProxyError && error.code === 'steps') || (per.length >= STEP_LIMIT && (!out || out.status !== 'done'));
    runs.push({
      id, user: sc.user, status: error ? 'error' : out.status, modelCalls: per.length,
      inputTokens: per.reduce((a, c) => a + c.inputTokens, 0), outputTokens: per.reduce((a, c) => a + c.outputTokens, 0), millicents,
      called, expected: sc.expect.calls, toolsCorrect: !!out && verdict.correct, missing: verdict.missing, extra: verdict.extra, hitStepLimit: !!hitLimit,
      ...(error ? { errorCode: error.code, errorWords: error.message, ...(error.resetsAt ? { resetsAt: error.resetsAt } : {}) } : {}),
    });
    if (error && error instanceof ProxyError && ['runs', 'calls', 'day', 'month', 'global', 'busy', 'off', 'plan', 'blocked'].includes(error.code)) { stopped = { reason: error.code, message: error.message, resetsAt: error.resetsAt }; break; }
    if (error && !(error instanceof ProxyError)) throw error;
  }
  return summarize(runs, { budgetCents, spentMillicents, stopped });
}

const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; };
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
export function summarize(runs, { budgetCents, spentMillicents, stopped }) {
  const done = runs.filter((r) => !r.skipped && r.status !== 'error');
  const measured = runs.filter((r) => !r.skipped && r.modelCalls > 0);
  const tokens = measured.map((r) => r.inputTokens + r.outputTokens);
  return {
    headline: {
      tokensPerRun: { mean: Math.round(mean(tokens)), median: Math.round(median(tokens)), inputMean: Math.round(mean(measured.map((r) => r.inputTokens))), outputMean: Math.round(mean(measured.map((r) => r.outputTokens))) },
      toolChoiceAccuracyPct: measured.length ? Math.round((measured.filter((r) => r.toolsCorrect).length / measured.length) * 1000) / 10 : null,
      stepLimitRatePct: measured.length ? Math.round((measured.filter((r) => r.hitStepLimit).length / measured.length) * 1000) / 10 : null,
      centsPerRun: { mean: Math.round(mean(measured.map((r) => r.millicents)) / 10) / 100, max: Math.round(Math.max(0, ...measured.map((r) => r.millicents)) / 10) / 100 },
    },
    runsMeasured: measured.length, runsCompleted: done.length, budgetCents, spentCents: Math.round(spentMillicents / 10) / 100, stopped, runs,
  };
}

export function formatReport(r, { title = 'Agent cost-per-run measurement', source = '' } = {}) {
  const h = r.headline, pct = (v) => (v === null ? 'n/a' : v + '%');
  const L = [`# ${title}`, ''];
  if (source) L.push(source, '');
  L.push(`${r.runsMeasured} questions measured, ${r.spentCents} cents of a ${r.budgetCents} cent budget used.` + (r.stopped ? ` **Stopped early:** ${r.stopped.message}${r.stopped.resetsAt ? ' (back at ' + r.stopped.resetsAt + ')' : ''}` : ''), '',
    '## The three numbers', '',
    `1. **Tokens per question:** ${h.tokensPerRun.mean} on average (median ${h.tokensPerRun.median}; ${h.tokensPerRun.inputMean} in, ${h.tokensPerRun.outputMean} out).`,
    `2. **Chose the right tools:** ${pct(h.toolChoiceAccuracyPct)} of questions.`,
    `3. **Hit the ${STEP_LIMIT}-step limit:** ${pct(h.stepLimitRatePct)} of questions.`, '',
    `Cost the server counted: ${h.centsPerRun.mean} cents per question on average, ${h.centsPerRun.max} at most.`, '',
    '## Each question', '', '| Question | Steps | Tokens in/out | Cents | Tools called | Right tools | Step limit |', '|---|---|---|---|---|---|---|');
  for (const x of r.runs) {
    if (x.skipped) { L.push(`| ${x.id} | | | | | skipped: ${x.skipped} | |`); continue; }
    L.push(`| ${x.id} | ${x.modelCalls} | ${x.inputTokens} / ${x.outputTokens} | ${(x.millicents / 1000).toFixed(2)} | ${x.called.join(', ') || (x.errorCode ? 'error: ' + x.errorCode : 'none')} | ${x.toolsCorrect ? 'yes' : 'no' + (x.missing.length ? ' (missing ' + x.missing.join(', ') + ')' : '') + (x.extra.length ? ' (extra ' + x.extra.join(', ') + ')' : '')} | ${x.hitStepLimit ? 'yes' : 'no'} |`);
  }
  return L.join('\n') + '\n';
}

export function parseArgs(argv, env = {}) {
  const a = { mode: null, baseUrl: null, budgetCents: 10, out: null, yes: false, ids: FIRST_SCENARIOS };
  for (let i = 0; i < argv.length; i += 1) {
    const x = argv[i];
    if (x === '--stub') a.mode = 'stub';
    else if (x === '--live') a.mode = 'live';
    else if (x === '--base-url') a.baseUrl = argv[++i];
    else if (x === '--budget-cents') a.budgetCents = Number(argv[++i]);
    else if (x === '--out') a.out = argv[++i];
    else if (x === '--yes-spend-money') a.yes = true;
    else if (x === '--scenarios') a.ids = String(argv[++i]).split(',');
    else throw new Error('unknown option ' + x);
  }
  if (!a.mode) throw new Error('say --stub (safe) or --live');
  if (!(a.budgetCents > 0 && a.budgetCents <= 200)) throw new Error('--budget-cents must be between 1 and 200');
  if (a.mode === 'live') {
    if (!a.yes) throw new Error('--live spends real money: add --yes-spend-money to confirm');
    if (!a.baseUrl || !/^https:\/\//.test(a.baseUrl)) throw new Error('--live needs --base-url https://...');
    if (!env.AGENT_LOGIN_TOKEN) throw new Error('--live needs AGENT_LOGIN_TOKEN in the environment');
  }
  return a;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = parseArgs(process.argv.slice(2), process.env);
  let model, stub;
  if (args.mode === 'stub') {
    const { createProxyStub } = await import('../fixtures/proxy-stub.js');
    const { stubScript } = await import('./measure-stub.js');
    stub = await createProxyStub({ token: 't', script: stubScript(), limits: { runsPerDay: 99, centsPerDay: 99, centsPerMonth: 999 } });
    model = createProxyModel({ baseUrl: stub.url, getToken: async () => 't' });
  } else {
    model = createProxyModel({ baseUrl: args.baseUrl, getToken: async () => process.env.AGENT_LOGIN_TOKEN });
    const st = await model.status();
    if (!st.available) { console.error('The assistant is not available: ' + (st.code || 'unknown')); process.exit(1); }
    console.log(`Allowed today: ${st.remaining.runsToday} questions, ${st.remaining.centsToday} cents.`);
    args.ids = args.ids.slice(0, st.remaining.runsToday);
  }
  const report = await measure({ model, ids: args.ids, budgetCents: args.budgetCents });
  const text = formatReport(report, args.mode === 'stub' ? { title: 'Agent cost-per-run measurement (STUB: invented numbers, spends nothing)', source: 'Run against the local contract stub. The token counts are made up; this only shows the report format.' } : { source: `Real model through ${args.baseUrl}.` });
  console.log(text);
  if (args.out) { writeFileSync(args.out, text); writeFileSync(args.out.replace(/\.md$/, '') + '.json', JSON.stringify(report, null, 2)); }
  if (stub) await stub.close();
}
