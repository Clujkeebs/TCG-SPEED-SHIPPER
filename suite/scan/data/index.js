// Offline search over a list of Printings: by name, set code, set name and collector number.
// Example queries: "bolt", "bolt m11", "m11 149", "charizard base1 4".
import { validatePrinting } from '../../shared/models.js';

const fold = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const words = (s) => fold(s).split(/[^a-z0-9]+/).filter(Boolean);
const stripZeros = (s) => s.replace(/^0+(?=\d)/, '');

export function createIndex(printings = []) {
  const byId = new Map();
  const entries = [];

  function add(p, { replace = false } = {}) {
    const v = validatePrinting(p);
    if (!v.ok) throw new Error('bad printing ' + (p && p.id) + ': ' + v.errors.join('; '));
    if (byId.has(p.id)) {
      if (!replace) return;
      const i = entries.findIndex((e) => e.p.id === p.id); // a fresher copy of the same printing (new prices)
      if (i >= 0) entries.splice(i, 1);
    }
    byId.set(p.id, p);
    entries.push({
      p,
      name: fold(p.name),
      nameWords: words(p.name),
      set: fold(p.setCode),
      setWords: words(p.setName || ''),
      number: stripZeros(fold(p.number)),
    });
  }
  printings.forEach(add);

  function score(e, tokens) {
    let total = 0;
    for (const t of tokens) {
      const nt = stripZeros(t);
      let best = 0;
      if (e.set === t) best = 40;
      else if (e.number === nt || e.number === nt.replace(/^en/, '')) best = 40;
      else if (e.nameWords.includes(t)) best = 30;
      else if (e.nameWords.some((w) => w.startsWith(t))) best = 20;
      else if (e.name.includes(t) && t.length >= 3) best = 10;
      else if (e.setWords.some((w) => w.startsWith(t)) && t.length >= 3) best = 8;
      if (!best) return 0;
      total += best;
    }
    if (e.name === tokens.join(' ')) total += 50;
    else if (e.name.startsWith(tokens.join(' '))) total += 25;
    return total;
  }

  return {
    size: () => byId.size,
    add,
    get: (id) => byId.get(id),
    all: () => [...byId.values()],
    search(query, { game, limit = 20 } = {}) {
      const tokens = words(query);
      if (!tokens.length) return [];
      return entries
        .filter((e) => !game || e.p.game === game)
        .map((e) => ({ e, s: score(e, tokens) }))
        .filter((r) => r.s > 0)
        .sort((a, b) => b.s - a.s || a.e.name.localeCompare(b.e.name) || a.e.set.localeCompare(b.e.set))
        .slice(0, limit)
        .map((r) => r.e.p);
    },
    // Exact lookup by what is printed on the card (used later by the camera).
    findBySetNumber(setCode, number, game) {
      const s = fold(setCode);
      const n = stripZeros(fold(number));
      return entries.filter((e) => e.set === s && e.number === n && (!game || e.p.game === game)).map((e) => e.p);
    },
  };
}
