// Background jobs: saved automations (cron or event) that run and leave a REPORT. Default is approval-required:
// a read or draft step just runs; an act step becomes a card in the inbox and waits. Only an automation the owner
// switched to approvalMode 'never' (autopilot, set in settings, not by the agent) acts on its own, and it still
// goes through limits, the kill switch and the audit log.
import { isDue } from './automations.js';
import { formatResult } from './plan.js';

export function createReportStore({ now = () => new Date() } = {}) {
  const rows = [];
  return {
    add(r) { const row = { id: 'rep-' + (rows.length + 1), ranAt: now().toISOString ? now().toISOString() : now(), ...r }; rows.push(row); return structuredClone(row); },
    list: () => rows.map((r) => structuredClone(r)),
    snapshot: () => rows.map((r) => structuredClone(r)),
    restore(snap) { rows.length = 0; for (const r of snap || []) rows.push(structuredClone(r)); },
    get: (id) => { const r = rows.find((x) => x.id === id); return r ? structuredClone(r) : undefined; },
  };
}

// A new job always starts approval-required.
export function newJob({ id, name, trigger, steps }) {
  return { id, name, trigger, steps, approvalMode: 'always', enabled: true };
}

export async function runJob(job, { registry, inbox, reports, store, now, event }) {
  if (!job.enabled) return { ok: false, error: 'job is switched off', steps: [] };
  // Kill switch on: do nothing at all. No report, and it is not marked as run, so it still runs when resumed.
  if (registry.limits.isKilled()) {
    await registry.audit.record({ actor: 'automation', tool: 'job.' + job.id, tier: 'autopilot', args: { jobId: job.id }, outcome: 'denied' });
    return { ok: false, skipped: 'kill switch is on', steps: [] };
  }
  const firstRun = job.lastRunAt === undefined;
  const ownerPreApproved = job.approvalMode === 'never' || (job.approvalMode === 'first-run' && !firstRun);
  const ctx = {
    actor: 'automation',
    automation: { enabled: true, id: job.id },
    run: registry.limits.newRun(),
    approve: ownerPreApproved ? async () => ({ approved: true, by: 'owner-setting:' + job.approvalMode }) : undefined,
  };
  const steps = [], cardIds = [];
  for (const s of job.steps) {
    const tool = registry.get(s.tool);
    if (!tool) { steps.push({ tool: s.tool, status: 'failed', note: 'unknown tool' }); continue; }
    if (tool.tier === 'act' && !ownerPreApproved) {
      if (tool.blockedAfterUntrusted && ctx.tainted) { steps.push({ tool: s.tool, status: 'failed', note: 'not allowed after reading text written by someone else' }); continue; }
      const card = inbox.propose({ tool: s.tool, args: s.args || {}, why: `Scheduled job "${job.name}" wants this.`, actor: 'automation', tainted: !!ctx.tainted });
      cardIds.push(card.id);
      steps.push({ tool: s.tool, status: 'waiting-approval', note: 'waiting for your OK (card ' + card.id + ')' });
      continue;
    }
    const out = await registry.run(s.tool, s.args || {}, ctx);
    steps.push({ tool: s.tool, status: out.ok ? 'ok' : out.denied ? 'denied' : 'failed', note: out.ok ? formatResult(s.tool, out.result) : out.error, ...(out.ok && tool.tier === 'draft' ? { result: out.result } : {}) });
    if (registry.limits.isKilled()) break;
  }
  const at = typeof now === 'function' ? now() : now;
  if (store) store.markRun(job.id, at);
  const title = `${job.name}${event ? ' (' + event.type + (event.count > 1 ? ' x' + event.count : '') + ')' : ''}`;
  const text = [title, ...steps.map((s) => `- ${s.tool}: ${s.status === 'ok' ? s.note : s.status + (s.note ? ': ' + s.note : '')}`)].join('\n');
  const drafts = steps.filter((x) => x.result !== undefined).map((x) => ({ tool: x.tool, result: x.result }));
  const report = reports.add({ jobId: job.id, title, text, steps: steps.map(({ result, ...rest }) => rest), cardIds, ...(drafts.length ? { drafts } : {}), ...(event ? { event: { type: event.type, count: event.count || 1 } } : {}) });
  return { ok: steps.every((s) => s.status === 'ok' || s.status === 'waiting-approval'), report, steps };
}

// Once a minute: run every job whose cron time has come.
export async function tickJobs({ store, now, ...deps }) {
  const out = [];
  for (const j of store.list()) if (isDue(j, now)) out.push(await runJob(j, { ...deps, store, now }));
  return out;
}

// When events happen: run every enabled job that listens for that kind of event, ONCE per kind per call
// (50 low-stock events make one run and one report, not 50). The run sees { type, count, sample }.
export async function fireEvents({ store, events, now, ...deps }) {
  const byType = new Map();
  for (const ev of events) {
    const g = byType.get(ev.type) || { type: ev.type, count: 0, sample: [] };
    g.count += 1;
    if (g.sample.length < 5) g.sample.push(ev.detail);
    byType.set(ev.type, g);
  }
  const out = [];
  for (const g of byType.values()) {
    for (const j of store.list()) {
      if (j.enabled && j.trigger.type === 'event' && j.trigger.value === g.type) out.push(await runJob(j, { ...deps, store, now, event: g }));
    }
  }
  return out;
}
