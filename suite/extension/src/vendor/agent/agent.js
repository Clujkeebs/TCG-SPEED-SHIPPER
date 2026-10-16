// The agent: goals become visible plans, plans run step by step, act steps wait in the approval inbox,
// memory is the seller's to view, edit and delete, and background jobs leave reports.
// Everything the seller does directly (adding, editing or forgetting a fact; approving a card) is audited too.
import { runPlan, renderPlan, validatePlan } from './plan.js';

import { fillBuyerNames } from './orderfile.js';
import { VOICE_KEY, deriveVoiceCard, describeVoice, voiceFromMemory, editVoiceCard, DEFAULT_CARD } from './voice.js';

export function createAgent({ registry, memory, inbox, planner, reports, jobs, now, names = new Map() }) {
  const runs = new Map(); // planId -> { plan, status, steps, text }
  const iso = () => (typeof now === 'function' ? now() : now);

  async function audit(tool, args, approvedBy) {
    await registry.audit.record({ actor: 'user', tool, tier: 'act', args, outcome: 'ok', approvedBy });
  }

  return {
    memory, inbox, reports, jobs, runs,

    // A goal in plain words. With autorun (the default) read and draft steps run now; act steps become cards.
    async goal(text, { autorun = true, onEvent = () => {} } = {}) {
      const r = await planner.plan(text, memory.list());
      if (!r.plan) return { status: 'no-plan', reason: r.reason, needs: r.needs };
      const v = validatePlan(r.plan, registry);
      if (!v.ok) return { status: 'invalid', reason: v.errors.join('; ') };
      if (!autorun) {
        runs.set(r.plan.id, { plan: r.plan, status: 'planned', steps: [] });
        onEvent({ event: 'plan', planId: r.plan.id, text: renderPlan(r.plan, registry) });
        return { status: 'planned', plan: r.plan, text: renderPlan(r.plan, registry) };
      }
      return this.execute(r.plan, { onEvent });
    },

    async execute(plan, { onEvent = () => {} } = {}) {
      const out = await runPlan({ plan, registry, inbox, onEvent });
      runs.set(plan.id, { plan, status: out.status, steps: out.steps, text: out.text });
      return out;
    },

    // The seller taps Approve or Decline on a card. The plan's step is updated to match.
    async decide(cardId, approved) {
      const card = approved ? await inbox.approve(cardId, { by: 'user' }) : inbox.decline(cardId);
      const run = card.planId ? runs.get(card.planId) : undefined;
      if (run) {
        const step = run.steps.find((s) => s.cardId === cardId);
        if (step) {
          step.status = card.status === 'done' ? 'ok' : card.status === 'declined' ? 'skipped' : 'failed';
          step.note = card.status === 'done' ? 'done after your OK' : card.status === 'declined' ? 'you declined this' : 'did not work: ' + card.error;
        }
        if (!run.steps.some((s) => s.status === 'waiting-approval' || s.status === 'pending')) run.status = run.steps.some((s) => s.status === 'failed') ? 'stopped' : 'done';
      }
      return { card, planStatus: run ? run.status : undefined, step: run ? run.steps.find((s) => s.cardId === cardId) : undefined };
    },
    undo: (cardId) => inbox.undo(cardId, { by: 'user' }),

    // The seller's own memory edits (not agent-proposed): immediate, and logged.
    async remember(fact) { const f = memory.add({ ...fact, source: 'user' }); await audit('memory.add', { id: f.id }, 'user'); return f; },
    async editMemory(id, patch) { const f = memory.edit(id, patch); await audit('memory.edit', { id }, 'user'); return f; },
    async forgetMemory(id) { const f = memory.delete(id); await audit('memory.delete', { id }, 'user'); return f; },

    // A pasted or dropped Seller Portal export. The analysis is read-only; each fix that changes something
    // becomes an approval card. Nothing is applied here.
    async syncExport(csv, { onEvent = () => {} } = {}) {
      const out = await registry.run('sync.analyzeExport', { csv }, { actor: 'agent' });
      if (!out.ok) return { status: 'failed', reason: out.error };
      const analysis = out.result;
      if (!analysis.ok) return { status: 'unreadable', problems: analysis.problems, analysis };
      const cards = [];
      for (const f of analysis.fixes) {
        if (!f.action) continue;
        const card = inbox.propose({ tool: f.action.tool, args: f.action.args, why: f.why, actor: 'agent' });
        f.cardId = card.id;
        cards.push(card);
        onEvent({ event: 'card', cardId: card.id });
      }
      return { status: 'ok', analysis, cards };
    },

    // Voice profile: derived on the device from the seller's own replies, kept as an editable card in shop memory.
    getVoice: () => voiceFromMemory(memory),
    async learnVoice(samples) {
      const card = deriveVoiceCard(samples);
      const old = memory.list().find((f) => f.key === VOICE_KEY);
      const fact = { text: describeVoice(card), key: VOICE_KEY, value: JSON.stringify(card), category: 'preference' };
      const saved = old ? memory.edit(old.id, fact) : memory.add({ ...fact, source: 'user' });
      await audit(old ? 'memory.edit' : 'memory.add', { id: saved.id }, 'user');
      return { card, text: saved.text, memoryId: saved.id };
    },
    async setVoice(patch) {
      const old = memory.list().find((f) => f.key === VOICE_KEY);
      const card = editVoiceCard(voiceFromMemory(memory) || DEFAULT_CARD, patch);
      const fact = { text: describeVoice(card), key: VOICE_KEY, value: JSON.stringify(card), category: 'preference' };
      const saved = old ? memory.edit(old.id, fact) : memory.add({ ...fact, source: 'user' });
      await audit(old ? 'memory.edit' : 'memory.add', { id: saved.id }, 'user');
      return { card, text: saved.text, memoryId: saved.id };
    },

    // On this device only: put "Ada L." in place of {{buyer:KEY}} in a draft.
    fillNames: (text) => fillBuyerNames(text, names),

    // A pasted or dropped order/shipping export. Read-only: returns the summary, a weekly draft and chart numbers.
    async orderFile(csv, { weekEnding } = {}) {
      const out = await registry.run('orders.fileInsights', { csv, ...(weekEnding ? { weekEnding } : {}) }, { actor: 'agent' });
      if (!out.ok) return { status: 'failed', reason: out.error };
      return { status: out.result.summary.ok ? 'ok' : 'unreadable', ...out.result };
    },

    async briefing() {
      const out = await registry.run('briefing.morning', {}, { actor: 'agent' });
      if (!out.ok) throw new Error(out.error);
      return out.result;
    },

    suggestions: async () => {
      const out = await registry.run('suggestions.weekly', {}, { actor: 'agent' });
      if (!out.ok) throw new Error(out.error);
      return out.result;
    },
    now: iso,
  };
}
