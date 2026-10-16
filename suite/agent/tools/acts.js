// The first act-level tools. Each one only changes the seller's OWN local data (stock prices, memory, saved
// schedules). None touches a marketplace, sends a message or spends money. Every one has a plain-words
// `describe` (for its approval card) and an `undo`.
import { CONDITIONS, FINISHES } from '../../shared/models.js';
import { CATEGORIES } from '../memory.js';
import { validateSaved } from '../automations.js';

const usd = (c) => '$' + (c / 100).toFixed(2);
const key = (c) => [c.printingId, c.condition, c.finish].join('|');

export function createActTools({ inventory, printings, memory, automations }) {
  const byId = new Map(printings.map((p) => [p.id, p]));
  const find = (c) => inventory.find((i) => key(i) === key(c));

  function checkChange(c) {
    if (!c || typeof c !== 'object') return 'each change must be an object';
    if (typeof c.printingId !== 'string') return 'printingId is required';
    if (!CONDITIONS.includes(c.condition)) return 'condition must be one of ' + CONDITIONS.join(', ');
    if (!FINISHES.includes(c.finish)) return 'finish must be one of ' + FINISHES.join(', ');
    if (!Number.isInteger(c.priceCents) || c.priceCents < 1 || c.priceCents > 10000000) return 'priceCents must be whole cents, at least 1';
    return null;
  }

  const tools = [
    {
      name: 'inventory.setPrices', tier: 'act',
      description: 'Save new prices in the seller\'s own stock list (on this device). Does not touch TCGplayer or any listing: the seller uploads a file afterwards.',
      inputSchema: { type: 'object', required: ['changes'], properties: { changes: { type: 'array' } } },
      describe(args) {
        const ch = (args.changes || []).filter((c) => !checkChange(c));
        let before = 0, after = 0, big = 0;
        for (const c of ch) {
          const i = find(c);
          if (!i) continue;
          before += (i.priceCents || 0) * i.quantity; after += c.priceCents * i.quantity;
          if (i.priceCents && Math.abs(c.priceCents - i.priceCents) / i.priceCents > 0.5) big += 1;
        }
        const warn = big ? ` WARNING: ${big} of these prices move by more than half.` : '';
        return {
          what: `Change the saved price of ${ch.length} cards in your stock list (on this device only; nothing is listed or changed on TCGplayer)`,
          expected: `Total list value of those cards goes from ${usd(before)} to ${usd(after)} (${after >= before ? '+' : '-'}${usd(Math.abs(after - before))}).${warn}`,
          undoText: 'Undo puts every price back as it was.',
        };
      },
      handler(args) {
        if (!Array.isArray(args.changes) || args.changes.length === 0) throw new Error('no changes given');
        if (args.changes.length > 100) throw new Error('at most 100 changes at a time');
        for (const c of args.changes) { const p = checkChange(c); if (p) throw new Error(p); }
        const previous = [], missing = [];
        for (const c of args.changes) {
          const i = find(c);
          if (!i) { missing.push(c.printingId); continue; }
          previous.push({ printingId: i.printingId, condition: i.condition, finish: i.finish, priceCents: i.priceCents });
          i.priceCents = c.priceCents;
        }
        return { changed: previous.length, previous, missing };
      },
      undo: (args, result) => {
        const back = result.previous.filter((p) => p.priceCents !== undefined);
        return back.length ? { tool: 'inventory.setPrices', args: { changes: back } } : null;
      },
    },
    {
      name: 'memory.search', tier: 'read', blockedAfterUntrusted: true,
      description: 'Look up facts remembered about the shop (settings, preferences, past decisions).',
      inputSchema: { type: 'object', properties: { text: { type: 'string' } } },
      handler: (a) => ({ facts: memory.search(a.text).map((f) => ({ id: f.id, text: f.text, category: f.category, key: f.key })) }),
    },
    {
      name: 'memory.remember', tier: 'act', blockedAfterUntrusted: true,
      description: 'Remember a fact about the shop for later runs. Needs approval; the seller can edit or delete it any time.',
      inputSchema: { type: 'object', required: ['text'], properties: { text: { type: 'string' }, key: { type: 'string' }, value: { type: 'string' }, category: { type: 'string', enum: CATEGORIES } } },
      describe: (a) => ({ what: `Remember: "${a.text}"`, expected: 'Later plans will use this fact. You can see, edit or delete it under shop memory.', undoText: 'Undo forgets it again.' }),
      handler(a) {
        let value = a.value;
        if (value !== undefined && value !== '' && !isNaN(Number(value))) value = Number(value);
        return memory.add({ text: a.text, key: a.key, value, category: a.category || 'fact', source: 'agent' });
      },
      undo: (args, result) => ({ tool: 'memory.forget', args: { id: result.id } }),
    },
    {
      name: 'memory.forget', tier: 'act', blockedAfterUntrusted: true,
      description: 'Forget one remembered fact. Needs approval.',
      inputSchema: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
      describe(a) { const f = memory.find(a.id); return { what: `Forget: "${f ? f.text : a.id}"`, expected: 'Later plans will not use this fact.', undoText: 'Undo remembers it again.' }; },
      handler: (a) => memory.delete(a.id),
      undo: (args, result) => ({ tool: 'memory.remember', args: { text: result.text, ...(result.key ? { key: result.key } : {}), ...(result.value !== undefined ? { value: String(result.value) } : {}), category: result.category } }),
    },
  ];

  if (automations) {
    tools.push(
      {
        name: 'automation.save', tier: 'act', blockedAfterUntrusted: true,
        description: 'Save a scheduled job that runs on a timer and leaves a report. Jobs the agent saves always ask before acting; only the owner can switch a job to autopilot.',
        inputSchema: { type: 'object', required: ['automation'], properties: { automation: { type: 'object' } } },
        describe: (a) => ({ what: `Save the schedule "${a.automation && a.automation.name}" (${a.automation && a.automation.trigger && a.automation.trigger.value})`, expected: 'It runs on that schedule and leaves a report. Any change it wants to make still comes to you as a card.', undoText: 'Undo removes the schedule.' }),
        handler(a) {
          const job = a.automation;
          if (job && job.approvalMode === 'never') throw new Error('only the owner can switch a job to autopilot, in settings');
          const v = validateSaved(job);
          if (!v.ok) throw new Error('bad schedule: ' + v.errors.join('; '));
          automations.save(job);
          return { id: job.id };
        },
        undo: (args, result) => ({ tool: 'automation.remove', args: { id: result.id } }),
      },
      {
        name: 'automation.remove', tier: 'act', blockedAfterUntrusted: true,
        description: 'Remove a saved schedule. Needs approval.',
        inputSchema: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
        describe: (a) => ({ what: `Remove the schedule ${a.id}`, expected: 'It stops running.', undoText: 'Undo saves it again.' }),
        handler(a) { const prev = automations.get(a.id); if (!prev) throw new Error('no such schedule'); automations.remove(a.id); return { removed: prev }; },
        undo: (args, result) => ({ tool: 'automation.save', args: { automation: result.removed } }),
      },
    );
  }
  return tools;
}
