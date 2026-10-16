// The queue of ListingDrafts for one selling session. Works in browsers (IndexedDB) and in Node
// (in-memory store), so the same code is tested. Money is whole cents.
import { validateListingDraft, CONDITIONS } from '../../shared/models.js';

const KEY = 'session';
const MAX_UNDO = 50;

export function createMemoryStore() {
  let saved;
  return {
    kind: 'memory',
    async load() { return saved === undefined ? undefined : JSON.parse(saved); },
    async save(state) { saved = JSON.stringify(state); },
  };
}

// IndexedDB when the browser has it; otherwise (Node, private modes) the in-memory store.
export function createIndexedDbStore(name = 'tcg-speed-scan', key = KEY) {
  if (typeof indexedDB === 'undefined') return createMemoryStore();
  const open = () => new Promise((resolve, reject) => {
    const req = indexedDB.open(name, 1);
    req.onupgradeneeded = () => req.result.createObjectStore('kv');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  const run = async (mode, fn) => {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('kv', mode);
      const req = fn(tx.objectStore('kv'));
      tx.oncomplete = () => { db.close(); resolve(req.result); };
      tx.onerror = tx.onabort = () => { db.close(); reject(tx.error); };
    });
  };
  const fallback = createMemoryStore();
  return {
    kind: 'indexeddb',
    async load() { try { return await run('readonly', (s) => s.get(key)); } catch { return fallback.load(); } },
    async save(state) { try { await run('readwrite', (s) => s.put(state, key)); } catch { await fallback.save(state); } },
  };
}

const sameKey = (a, b) =>
  a.printingId === b.printingId && a.condition === b.condition && a.finish === b.finish && a.language === b.language;

export async function openSession({ store = createMemoryStore(), now = () => new Date().toISOString() } = {}) {
  const loaded = (await store.load()) || {};
  let items = Array.isArray(loaded.items) ? loaded.items : [];
  let defaults = loaded.defaults || {};
  let seq = Number.isInteger(loaded.seq) ? loaded.seq : items.length;
  const undoStack = [];
  const listeners = new Set();
  let pending = Promise.resolve();

  const snapshot = () => ({ items: JSON.parse(JSON.stringify(items)) });
  function commit(before) {
    if (before) { undoStack.push(before); if (undoStack.length > MAX_UNDO) undoStack.shift(); }
    pending = pending.then(() => store.save({ items, defaults, seq })).catch(() => {});
    listeners.forEach((fn) => fn(api));
  }
  function mustBeInt(q) {
    if (!Number.isInteger(q) || q < 1) throw new Error('quantity must be a whole number of 1 or more');
  }

  const api = {
    get items() { return items.slice(); },
    get defaults() { return { ...defaults }; },
    canUndo: () => undoStack.length > 0,
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    flush: () => pending,

    setDefaults(next) { defaults = { ...defaults, ...next }; commit(); },
    // The seller types a TCGplayer product ID for a printing we do not know; it goes on every row of that printing.
    setProductId(printingId, id) {
      const clear = id === null || id === undefined || id === '';
      if (!clear && !(Number.isInteger(id) && id > 0)) throw new Error('product id must be a positive whole number');
      const before = snapshot();
      for (const it of items) {
        if (it.printingId !== printingId) continue;
        if (clear) delete it.tcgplayerProductId; else it.tcgplayerProductId = id;
      }
      commit(before);
    },

    // Adds a row, or adds to the quantity of an identical row. Returns the row.
    add({ printingId, condition, finish, language = 'en', quantity = 1, priceCents = 0, priceRuleId, source = 'manual', tcgplayerProductId }) {
      mustBeInt(quantity);
      const draft = { printingId, condition, finish, language, quantity, priceCents, source };
      if (priceRuleId) draft.priceRuleId = priceRuleId;
      if (tcgplayerProductId) draft.tcgplayerProductId = tcgplayerProductId;
      const before = snapshot();
      const twin = items.find((it) => sameKey(it, draft));
      if (twin) {
        twin.quantity += quantity;
        commit(before);
        return twin;
      }
      seq += 1;
      draft.id = 'row-' + seq;
      draft.createdAt = now();
      const v = validateListingDraft(draft);
      if (!v.ok) throw new Error(v.errors.join('; '));
      items.push(draft);
      commit(before);
      return draft;
    },
    setQuantity(id, quantity) {
      mustBeInt(quantity);
      api.edit(id, { quantity });
    },
    // Change condition, finish, language, quantity or price of a row. Does not merge: call mergeDuplicates().
    edit(id, changes) {
      const row = items.find((it) => it.id === id);
      if (!row) throw new Error('no such row: ' + id);
      const allowed = ['condition', 'finish', 'language', 'quantity', 'priceCents', 'tcgplayerProductId'];
      const next = { ...row };
      for (const k of allowed) if (k in changes) next[k] = changes[k];
      if (!CONDITIONS.includes(next.condition) && 'condition' in changes) throw new Error('unknown condition');
      const v = validateListingDraft(next);
      if (!v.ok) throw new Error(v.errors.join('; '));
      const before = snapshot();
      Object.assign(row, next);
      commit(before);
      return row;
    },
    remove(id) {
      if (!items.some((it) => it.id === id)) return false;
      const before = snapshot();
      items = items.filter((it) => it.id !== id);
      commit(before);
      return true;
    },
    clear() {
      if (!items.length) return;
      const before = snapshot();
      items = [];
      commit(before);
    },
    undo() {
      const prev = undoStack.pop();
      if (!prev) return false;
      items = prev.items;
      commit();
      return true;
    },
    // Rows that now match (after an edit) are folded into the first one. Returns how many rows disappeared.
    mergeDuplicates() {
      const merged = [];
      for (const it of items) {
        const twin = merged.find((m) => sameKey(m, it));
        if (twin) twin.quantity += it.quantity;
        else merged.push({ ...it });
      }
      const removed = items.length - merged.length;
      if (removed) {
        const before = snapshot();
        items = merged;
        commit(before);
      }
      return removed;
    },
    totals() {
      let cards = 0;
      let valueCents = 0;
      let unpriced = 0;
      for (const it of items) {
        cards += it.quantity;
        valueCents += it.quantity * it.priceCents;
        if (it.priceCents < 1) unpriced += 1;
      }
      return { rows: items.length, cards, valueCents, unpriced };
    },
  };
  return api;
}
