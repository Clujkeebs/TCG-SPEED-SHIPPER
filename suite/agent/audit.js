// Append-only audit log for the Agent. One AuditEntry per tool call (docs/suite/DATA-MODEL.md).
// Arguments are hashed (SHA-256 of a stable JSON form) and never stored raw.
import { validateAuditEntry } from '../shared/models.js';

function stable(value) {
  if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']';
  if (value && typeof value === 'object') {
    return '{' + Object.keys(value).sort().filter((k) => value[k] !== undefined).map((k) => JSON.stringify(k) + ':' + stable(value[k])).join(',') + '}';
  }
  return JSON.stringify(value === undefined ? null : value);
}

export async function hashArgs(args) {
  const bytes = new TextEncoder().encode(stable(args));
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

// A store only appends and lists. There is deliberately no update or delete.
export function createMemoryStore() {
  const rows = [];
  return {
    async append(entry) { rows.push(Object.freeze({ ...entry })); },
    async list() { return rows.map((r) => ({ ...r })); },
  };
}

// IndexedDB store. `idb` is an IDBFactory (the browser's `indexedDB`); passed in so tests can fake it.
export function createIdbStore(idb, name = 'tcgss-agent-audit') {
  let dbPromise;
  function open() {
    if (!dbPromise) {
      dbPromise = new Promise((resolve, reject) => {
        const req = idb.open(name, 1);
        req.onupgradeneeded = () => req.result.createObjectStore('audit', { keyPath: 'seq', autoIncrement: true });
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    }
    return dbPromise;
  }
  const wrap = (req) => new Promise((resolve, reject) => { req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });
  return {
    async append(entry) {
      const db = await open();
      await wrap(db.transaction('audit', 'readwrite').objectStore('audit').add({ ...entry }));
    },
    async list() {
      const db = await open();
      const all = await wrap(db.transaction('audit', 'readonly').objectStore('audit').getAll());
      return all.map(({ seq, ...rest }) => rest);
    },
  };
}

export function createAuditLog({ store = createMemoryStore(), now = () => new Date() } = {}) {
  return {
    async record({ actor = 'agent', tool, tier, args, outcome, approvedBy }) {
      const entry = { at: now().toISOString(), actor, tool, tier, argsHash: await hashArgs(args ?? {}), outcome };
      if (approvedBy) entry.approvedBy = approvedBy;
      const v = validateAuditEntry(entry);
      if (!v.ok) throw new Error('bad audit entry: ' + v.errors.join('; '));
      await store.append(entry);
      return entry;
    },
    list: () => store.list(),
    // One JSON object per line: what ran, when, by whom, who approved. Arguments are hashes only.
    async exportJsonl() { return (await store.list()).map((e) => JSON.stringify(e)).join('\n') + '\n'; },
  };
}
