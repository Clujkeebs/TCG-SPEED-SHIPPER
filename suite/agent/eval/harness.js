// Runs scenarios offline against a scripted fake model and checks what happened.
import { createRegistry } from '../registry.js';
import { createAuditLog } from '../audit.js';
import { createLimits } from '../limits.js';
import { runAgent, scriptedModel } from '../loop.js';
import { registerAll } from '../tools/index.js';
import { makeOrders, makeInventory, loadPrintings, FIXTURE_NOW } from '../fixtures/orders.js';
import { TOOL_TIERS } from '../../shared/models.js';
import { scenarios } from './scenarios.js';

export function makeWorld() {
  const printings = loadPrintings();
  const clock = () => new Date(FIXTURE_NOW);
  const audit = createAuditLog({ now: clock });
  const limits = createLimits({ now: clock });
  const registry = createRegistry({ audit, limits });
  registerAll(registry, { orders: makeOrders({ printings }), inventory: makeInventory({ printings }), printings, now: FIXTURE_NOW });
  return { registry, audit, limits };
}

export async function runScenario(sc) {
  const { registry, audit } = makeWorld();
  const out = await runAgent({ model: scriptedModel(sc.script), registry, messages: [{ role: 'user', content: sc.user }] });
  const log = await audit.list();
  const failures = [];
  const e = sc.expect;
  const names = out.calls.map((c) => c.name);
  if (out.status !== 'done') failures.push('run ended with status ' + out.status);
  if (JSON.stringify(names) !== JSON.stringify(e.calls)) failures.push(`expected calls ${e.calls.join(', ')} but got ${names.join(', ')}`);
  for (const [tool, want] of Object.entries(e.args || {})) {
    const c = out.calls.find((x) => x.name === tool);
    for (const [k, v] of Object.entries(want)) if (!c || c.input[k] !== v) failures.push(`${tool}: expected ${k}=${v}`);
  }
  for (const w of e.includes || []) if (!out.text.includes(w)) failures.push(`answer is missing "${w}"`);
  for (const n of e.notCalled || []) if (names.includes(n)) failures.push('must not call ' + n);
  for (const n of e.failed || []) if (out.calls.find((c) => c.name === n)?.ok) failures.push(n + ' should have been refused');
  if (e.maxTier) {
    const limit = TOOL_TIERS.indexOf(e.maxTier);
    for (const entry of log) if (TOOL_TIERS.indexOf(entry.tier) > limit) failures.push(`tool ${entry.tool} is above tier ${e.maxTier}`);
  }
  if (log.some((x) => x.tier === 'act' || x.tier === 'autopilot')) failures.push('an act or autopilot tool ran');
  if (log.length !== out.calls.length) failures.push('audit log does not match the calls made');
  return { id: sc.id, title: sc.title, pass: failures.length === 0, failures, calls: names, text: out.text };
}

export async function runAll(list = scenarios) {
  const results = [];
  for (const sc of list) results.push(await runScenario(sc));
  return results;
}

export function toMarkdown(results, date) {
  const passed = results.filter((r) => r.pass).length;
  const lines = [
    '# Agent evaluation',
    '',
    `Run on ${date}, offline, scripted fake model, made-up buyers. **${passed} of ${results.length} scenarios pass.**`,
    '',
    'What this proves: the tools return the right data, the right tier is used, nothing is sent or changed, and every call is logged.',
    'What it does not prove: how a real model chooses tools. That needs a measured run with a real model, which costs money and waits for the owner.',
    '',
    '| Scenario | Asked | Tools used | Result |',
    '|---|---|---|---|',
  ];
  for (const r of results) lines.push(`| ${r.id} | ${r.title} | ${r.calls.join(', ') || 'none'} | ${r.pass ? 'pass' : 'FAIL: ' + r.failures.join('; ')} |`);
  lines.push('', 'Re-run: `node suite/agent/eval/run.js` (add `--write` to refresh this file).', '');
  return lines.join('\n');
}
