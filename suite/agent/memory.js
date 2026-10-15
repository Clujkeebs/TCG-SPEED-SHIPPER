// Shop memory: facts about the seller's shop (settings, preferences, past decisions) that later runs use.
// The seller can view, edit and delete every fact. The agent can only *propose* a fact (an approval card).
// No buyer personal details: emails, phone numbers and street addresses are refused.
export const CATEGORIES = ['setting', 'preference', 'decision', 'fact'];
export const MAX_FACTS = 200;
export const MAX_TEXT = 300;

const PERSONAL = [
  [/[^\s@]+@[^\s@]+\.[^\s@]+/, 'an email address'],
  [/(\+?\d[\s().-]?){10,}/, 'a phone number'],
  [/\b\d{1,5}\s+\w+(\s\w+)?\s+(st|street|ave|avenue|rd|road|blvd|lane|ln|dr|drive)\b/i, 'a street address'],
];

export function createShopMemory({ now = () => new Date() } = {}) {
  const facts = new Map();
  let counter = 0;
  const iso = () => now().toISOString();

  function check({ text, key, category }) {
    if (typeof text !== 'string' || !text.trim()) throw new Error('a fact needs some text');
    if (text.length > MAX_TEXT) throw new Error('fact is too long (limit ' + MAX_TEXT + ' characters)');
    for (const [re, what] of PERSONAL) if (re.test(text)) throw new Error('facts must not hold ' + what);
    if (key !== undefined && !/^[a-z][a-z0-9_.-]{0,59}$/.test(key)) throw new Error('key must be lowercase letters, digits, dots or dashes');
    if (category !== undefined && !CATEGORIES.includes(category)) throw new Error('category must be one of ' + CATEGORIES.join(', '));
  }
  const byKey = (key) => [...facts.values()].find((f) => f.key === key);

  return {
    add({ text, key, value, category = 'fact', source = 'user' }) {
      check({ text, key, category });
      if (facts.size >= MAX_FACTS) throw new Error('memory is full; delete something first');
      if (key !== undefined && byKey(key)) throw new Error('there is already a fact with key ' + key + '; edit it instead');
      const fact = { id: 'mem-' + (++counter), text: text.trim(), category, source, createdAt: iso(), updatedAt: iso() };
      if (key !== undefined) fact.key = key;
      if (value !== undefined) fact.value = value;
      facts.set(fact.id, fact);
      return { ...fact };
    },
    edit(id, patch) {
      const f = facts.get(id);
      if (!f) throw new Error('no such fact ' + id);
      const next = { ...f, ...patch };
      check(next);
      if (patch.key !== undefined && patch.key !== f.key && byKey(patch.key)) throw new Error('there is already a fact with key ' + patch.key);
      facts.set(id, { ...next, id, source: f.source, createdAt: f.createdAt, updatedAt: iso() });
      return { ...facts.get(id) };
    },
    delete(id) {
      const f = facts.get(id);
      if (!f) throw new Error('no such fact ' + id);
      facts.delete(id);
      return { ...f };
    },
    get: (key) => { const f = byKey(key); return f ? f.value : undefined; },
    find: (id) => (facts.has(id) ? { ...facts.get(id) } : undefined),
    list: ({ category } = {}) => [...facts.values()].filter((f) => !category || f.category === category).map((f) => ({ ...f })),
    search(text) {
      const t = String(text || '').toLowerCase();
      return [...facts.values()].filter((f) => !t || f.text.toLowerCase().includes(t) || (f.key || '').includes(t)).map((f) => ({ ...f }));
    },
    exportJson: () => JSON.stringify([...facts.values()], null, 2),
    importJson(json) {
      const rows = JSON.parse(json);
      if (!Array.isArray(rows)) throw new Error('expected a list of facts');
      for (const r of rows) check(r);
      facts.clear();
      for (const r of rows) { facts.set(r.id, { ...r }); counter = Math.max(counter, Number(String(r.id).replace('mem-', '')) || 0); }
    },
  };
}
