// Approval inbox. Every act-level step lands here as a card and NOTHING runs until the seller approves it.
//   card: { id, status, tool, args, what, why, expected, undoText, actor, planId?, stepId?, createdAt, decidedAt?, result?, error?, undo? }
//   status: pending -> approved -> done | failed ; pending -> declined | expired ; done -> undone
// Approving runs the tool through the registry (limits, kill switch and audit log all apply), so the audit
// entry carries who approved. Undo runs the reverse change, also through the registry and the audit log.
export const EXPIRE_DAYS = 7;

export function createInbox({ registry, now = () => new Date() }) {
  const cards = new Map();
  let counter = 0;
  const iso = () => now().toISOString();

  function expireOld() {
    for (const c of cards.values()) {
      if (c.status === 'pending' && Date.parse(iso()) - Date.parse(c.createdAt) > EXPIRE_DAYS * 86400000) { c.status = 'expired'; c.decidedAt = iso(); }
    }
  }
  const must = (id) => {
    const c = cards.get(id);
    if (!c) throw new Error('no such card ' + id);
    return c;
  };

  return {
    // Describe the change in plain words and file it. Nothing runs.
    propose({ tool, args, why, actor = 'agent', planId, stepId }) {
      const t = registry.get(tool);
      if (!t) throw new Error('unknown tool ' + tool);
      if (t.tier !== 'act') throw new Error('only act-level tools go through the inbox');
      const d = (typeof t.describe === 'function' ? t.describe(args) : null) || {};
      const card = {
        id: 'card-' + (++counter), status: 'pending', tool, args,
        what: d.what || t.description,
        why: why || 'No reason given.',
        expected: d.expected || 'Not stated.',
        undoText: d.undoText || 'This cannot be undone automatically.',
        actor, createdAt: iso(),
      };
      if (planId) card.planId = planId;
      if (stepId) card.stepId = stepId;
      cards.set(card.id, card);
      return structuredClone(card);
    },
    list({ status } = {}) { expireOld(); return [...cards.values()].filter((c) => !status || c.status === status).map((c) => structuredClone(c)); },
    get: (id) => structuredClone(must(id)),
    async approve(id, { by = 'user' } = {}) {
      expireOld();
      const c = must(id);
      if (c.status !== 'pending') throw new Error('card ' + id + ' is ' + c.status + ', not pending');
      if (registry.limits.isKilled()) {
        await registry.audit.record({ actor: 'user', tool: c.tool, tier: 'act', args: c.args, outcome: 'denied' });
        throw new Error('the kill switch is on; the card stays waiting. Resume first, then approve.');
      }
      c.status = 'approved'; c.decidedAt = iso();
      const t = registry.get(c.tool);
      const out = await registry.run(c.tool, c.args, { actor: c.actor, approve: async () => ({ approved: true, by }) });
      if (!out.ok) { c.status = 'failed'; c.error = out.error; return structuredClone(c); }
      c.status = 'done'; c.result = out.result;
      const u = typeof t.undo === 'function' ? t.undo(c.args, out.result) : null;
      if (u) c.undo = u;
      return structuredClone(c);
    },
    decline(id) {
      expireOld();
      const c = must(id);
      if (c.status !== 'pending') throw new Error('card ' + id + ' is ' + c.status + ', not pending');
      c.status = 'declined'; c.decidedAt = iso();
      return structuredClone(c);
    },
    async undo(id, { by = 'user' } = {}) {
      const c = must(id);
      if (c.status !== 'done') throw new Error('card ' + id + ' is ' + c.status + '; only a finished change can be undone');
      if (!c.undo) throw new Error('this change cannot be undone automatically');
      if (registry.limits.isKilled()) throw new Error('the kill switch is on; resume first');
      const out = await registry.run(c.undo.tool, c.undo.args, { actor: 'user', approve: async () => ({ approved: true, by: by + ':undo' }) });
      if (!out.ok) throw new Error('undo failed: ' + out.error);
      c.status = 'undone'; c.undoneAt = iso();
      return structuredClone(c);
    },
    pendingCount() { expireOld(); return [...cards.values()].filter((c) => c.status === 'pending').length; },
  };
}
