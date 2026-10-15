// A3: automations. Saved in the shape from docs/suite/DATA-MODEL.md (validateAutomation):
//   { id, name, trigger: { type: 'cron', value: '0 8 * * 1' }, steps: [{ tool, args? }], approvalMode, enabled, lastRunAt? }
// Approval modes: 'always' asks for every act step, 'first-run' asks until the automation has run once,
// 'never' means the owner pre-approved its act steps. Disabled automations never run. Every step goes
// through the registry, so tiers, limits, the kill switch and the audit log all still apply.
// Triggers: cron (a schedule) or event (low-stock, new-order, unanswered-message; see events.js).
import { validateAutomation } from '../shared/models.js';

export const EVENT_TRIGGERS = ['low-stock', 'new-order', 'unanswered-message'];

const RANGES = [[0, 59], [0, 23], [1, 31], [1, 12], [0, 6]]; // minute hour day-of-month month day-of-week

function expandField(field, [lo, hi]) {
  const out = new Set();
  for (const part of field.split(',')) {
    const m = /^(\*|\d+(?:-\d+)?)(?:\/(\d+))?$/.exec(part);
    if (!m) return null;
    const step = m[2] === undefined ? 1 : Number(m[2]);
    if (step < 1) return null;
    let from, to;
    if (m[1] === '*') [from, to] = [lo, hi];
    else if (m[1].includes('-')) [from, to] = m[1].split('-').map(Number);
    else { from = Number(m[1]); to = m[2] === undefined ? from : hi; }
    if (from < lo || to > hi || from > to) return null;
    for (let v = from; v <= to; v += step) out.add(v);
  }
  return out;
}

export function parseCron(expr) {
  const f = String(expr).trim().split(/\s+/);
  if (f.length !== 5) return null;
  const sets = f.map((x, i) => expandField(x, RANGES[i]));
  return sets.some((s) => !s) ? null : sets;
}

// Does this cron expression fire in the minute that contains `date` (UTC)?
export function cronMatches(expr, date) {
  const sets = parseCron(expr);
  if (!sets) return false;
  const d = new Date(date);
  return sets[0].has(d.getUTCMinutes()) && sets[1].has(d.getUTCHours()) && sets[2].has(d.getUTCDate()) && sets[3].has(d.getUTCMonth() + 1) && sets[4].has(d.getUTCDay());
}

export function validateSaved(a) {
  const v = validateAutomation(a);
  const errors = [...v.errors];
  if (v.ok && a.trigger.type === 'cron' && !parseCron(a.trigger.value)) errors.push('trigger.value is not a valid 5-field cron expression');
  if (v.ok && a.trigger.type === 'event' && !EVENT_TRIGGERS.includes(a.trigger.value)) errors.push('event trigger must be one of ' + EVENT_TRIGGERS.join(', '));
  return { ok: errors.length === 0, errors };
}

export function createAutomationStore() {
  const rows = new Map();
  return {
    save(a) {
      const v = validateSaved(a);
      if (!v.ok) throw new Error('bad automation: ' + v.errors.join('; '));
      rows.set(a.id, structuredClone(a));
    },
    get: (id) => (rows.has(id) ? structuredClone(rows.get(id)) : undefined),
    list: () => [...rows.values()].map((a) => structuredClone(a)),
    setEnabled(id, enabled) { const a = rows.get(id); if (!a) throw new Error('unknown automation ' + id); a.enabled = !!enabled; },
    remove(id) { rows.delete(id); },
    markRun(id, at) { const a = rows.get(id); if (a) a.lastRunAt = at; },
  };
}

const sameMinute = (a, b) => a && b && Date.parse(a) - (Date.parse(a) % 60000) === Date.parse(b) - (Date.parse(b) % 60000);

export function isDue(a, now) {
  if (!a.enabled || a.trigger.type !== 'cron') return false;
  if (sameMinute(a.lastRunAt, now)) return false; // never twice in one minute
  return cronMatches(a.trigger.value, now);
}

// Run one automation now. `approve(request)` is the human step; without it, act steps are refused
// unless the owner set approvalMode to 'never'. Returns what each step did. A refused step does not
// stop the later steps, but its result is reported as denied.
export async function runAutomation(automation, { registry, approve, now = new Date().toISOString(), store } = {}) {
  const v = validateSaved(automation);
  if (!v.ok) return { ok: false, error: v.errors.join('; '), steps: [] };
  if (!automation.enabled) return { ok: false, error: 'automation is switched off', steps: [] };
  const firstRun = automation.lastRunAt === undefined;
  const ownerPreApproved = automation.approvalMode === 'never' || (automation.approvalMode === 'first-run' && !firstRun);
  const ctx = {
    actor: 'automation',
    automation: { enabled: true, id: automation.id },
    run: registry.limits.newRun(),
    approve: ownerPreApproved ? async () => ({ approved: true, by: 'owner-setting:' + automation.approvalMode }) : approve,
  };
  const steps = [];
  for (const s of automation.steps) {
    const out = await registry.run(s.tool, s.args || {}, ctx);
    steps.push({ tool: s.tool, ok: out.ok, denied: !!out.denied, ...(out.ok ? { result: out.result } : { error: out.error }) });
    if (registry.limits.isKilled()) break;
  }
  if (store) store.markRun(automation.id, now);
  return { ok: steps.every((s) => s.ok), steps };
}

// Called once a minute by whatever hosts the Agent. Runs every due automation.
export async function tick({ store, registry, approve, now }) {
  const ran = [];
  for (const a of store.list()) {
    if (!isDue(a, now)) continue;
    ran.push({ id: a.id, ...(await runAutomation(a, { registry, approve, now, store })) });
  }
  return ran;
}
