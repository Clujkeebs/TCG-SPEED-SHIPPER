// Batch 4 evaluation: the real-model door (proxy adapter), draft text for the panel, and the cost-per-run report format.
// Everything runs against the local contract stub: no real model, no key, no network beyond this machine.
import { createProxyModel, ProxyError } from '../adapters/proxy.js';
import { createProxyStub } from '../fixtures/proxy-stub.js';
import { measure, formatReport } from './measure.js';
import { stubScript } from './measure-stub.js';
import { makeWorld } from './harness.js';
import { createAgentService, PANEL_SOURCE, validateEvent } from '../protocol.js';

const TABLE = [[400, 'bad_request'], [402, 'plan'], [403, 'blocked'], [413, 'too_big'], [429, 'runs'], [429, 'calls'], [429, 'day'], [429, 'month'], [429, 'global'], [429, 'steps'], [429, 'busy'], [502, 'model_error'], [503, 'off'], [503, 'try_again']];

export async function runBatch4() {
  const checks = [];
  const check = (area, name, pass, detail = '') => checks.push({ area, name, pass: !!pass, detail });
  const q = [{ role: 'user', content: 'Who are my repeat buyers?' }];
  const spec = { name: 'orders.stats', description: 'd', input_schema: { type: 'object', properties: {} } };

  const stub = await createProxyStub({ token: 'tok', script: stubScript(), limits: { runsPerDay: 99, centsPerDay: 99, centsPerMonth: 999 } });
  const model = createProxyModel({ baseUrl: stub.url, getToken: async () => 'tok' });
  try {
    await model.complete(q, [spec], 'a system prompt that must not be sent');
    check('Model door', 'sends only messages and tools: no system prompt, model name or key', stub.log.ignored.length === 0 && stub.log.authHeaders[0] === 'Bearer tok');
    check('Model door', 'tool names go as they are (with dots); the server renames them', stub.log.toolNames.has('orders.stats'));
    let okRows = 0;
    for (const [status, code] of TABLE) {
      stub.failNext(status, code, 'words from the server', code === 'runs' ? { resetsAt: '2026-10-18T00:00:00Z' } : {});
      try { await model.complete(q, [spec]); } catch (e) { if (e instanceof ProxyError && e.status === status && e.code === code && e.message === 'words from the server') okRows += 1; }
    }
    check('Model door', `all ${TABLE.length} status/code rows of the contract become a plain-words ProxyError (${okRows} of ${TABLE.length})`, okRows === TABLE.length);
    let local = 0;
    const tu = (id) => ({ role: 'assistant', content: [{ type: 'tool_use', id, name: 'orders.stats', input: {} }] });
    const tr = (id) => ({ role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: '{}' }] });
    const before = stub.log.requests.length;
    for (const bad of [[], [...q, tu('a')], [...q, tu('a'), tr('b')], Array.from({ length: 17 }, (_, i) => (i === 0 ? q[0] : i % 2 ? tu('s' + i) : tr('s' + (i - 1))))]) { try { await model.complete(bad, [spec]); } catch (e) { if (e instanceof ProxyError) local += 1; } }
    check('Model door', 'a badly shaped or over-long conversation is refused before anything is sent', local === 4 && stub.log.requests.length === before);
  } finally { await stub.close(); }

  // draft text for the panel
  const w = makeWorld({ clockStart: '2026-10-12T08:00:00Z' });
  const EXT = 'abcdefghijklmnopabcdefghijklmnop';
  const svc = createAgentService({ registry: w.registry, extensionId: EXT, agent: w.agent });
  const events = [];
  await svc.handle({ source: PANEL_SOURCE, v: 1, id: 'm1', type: 'agent.ask', payload: { text: 'Draft a reply to the oldest unanswered message' } }, { id: EXT }, (e) => events.push(e));
  for (let i = 0; i < 300 && !events.some((e) => e.event === 'agent.answer'); i += 1) await new Promise((r) => setTimeout(r, 10));
  const answer = events.find((e) => e.event === 'agent.answer');
  const first = w.orders.find((o) => o.id === 'ORD-1010').shipTo.name.split(' ')[0];
  const audit = await w.audit.exportJsonl();
  check('Draft text', 'the reply to copy reaches the panel in the answer and in the plan step', answer && answer.drafts && answer.drafts[0].text.startsWith(`Hi ${first},`) && events.some((e) => e.event === 'agent.plan' && e.steps.some((s) => s.output === answer.drafts[0].text)));
  check('Draft text', 'the name is filled in on the device only: not in the audit trail or the saved plan', !new RegExp('\\b' + first + '\\b').test(audit + JSON.stringify([...w.agent.runs.entries()])));
  check('Draft text', 'seller-only notes (policy ids, "check TCGplayer\'s current article") come separately', /LOST-1/.test(answer.drafts[0].notes) && !answer.drafts[0].text.includes('LOST-1'));
  check('Draft text', 'every event is well formed', events.every((e) => validateEvent(e) === null));

  // the measurement script
  const s2 = await createProxyStub({ token: 'tok', script: stubScript(), limits: { runsPerDay: 99, centsPerDay: 99, centsPerMonth: 999 } });
  let report;
  try { report = await measure({ model: createProxyModel({ baseUrl: s2.url, getToken: async () => 'tok' }), budgetCents: 50 }); } finally { await s2.close(); }
  check('Cost measurement', 'the six first scenarios run against the stand-in and report the three numbers', report.runsMeasured === 6 && report.headline.toolChoiceAccuracyPct === 100 && report.headline.stepLimitRatePct === 0 && report.headline.tokensPerRun.mean > 0);
  return { checks, pass: checks.every((c) => c.pass), report, reportText: formatReport(report, { title: 'Agent cost-per-run measurement (STUB: invented numbers, spends nothing)' }), tableRows: TABLE.length };
}
