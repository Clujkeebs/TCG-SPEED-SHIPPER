// Local store: IndexedDB with an in-memory fallback. Shapes follow docs/suite/DATA-MODEL.md and
// every record is checked with the shared validators before it is saved.
import {
  validateOrder,
  validateListingDraft,
  validateInventoryItem,
  validateScanRecord
} from './vendor/shared/models.js';
import { checkTrackingBatch } from './bridge.js';

export const DB_NAME = 'tcgss_suite';
export const DB_VERSION = 2;

// A batch of tracking numbers from the Shipper site, already checked by the bridge (src/bridge.js).
function validateTrackingBatch(r) {
  const problem = !r || typeof r !== 'object' || typeof r.receivedAt !== 'string' || Number.isNaN(Date.parse(r.receivedAt)) ? 'receivedAt must be an ISO date' : checkTrackingBatch({ batchId: r.id, items: r.items });
  return problem ? { ok: false, errors: [problem] } : { ok: true, errors: [] };
}

export const COLLECTION_DEFS = {
  trackingBatches: { validate: validateTrackingBatch, keyOf: (r) => r.id },
  orders: { validate: validateOrder, keyOf: (r) => r.id },
  listings: { validate: validateListingDraft, keyOf: (r) => r.id },
  inventory: { validate: validateInventoryItem, keyOf: (r) => [r.printingId, r.condition, r.finish, r.language].join('|') },
  scans: { validate: validateScanRecord, keyOf: (r) => r.id }
};

function memoryBackend() {
  const data = Object.fromEntries(Object.keys(COLLECTION_DEFS).map((c) => [c, new Map()]));
  return {
    kind: 'memory',
    async put(c, key, record) {
      data[c].set(key, structuredClone(record));
    },
    async get(c, key) {
      return data[c].has(key) ? structuredClone(data[c].get(key)) : null;
    },
    async list(c) {
      return [...data[c].values()].map((r) => structuredClone(r));
    },
    async delete(c, key) {
      data[c].delete(key);
    },
    async clear(c) {
      data[c].clear();
    }
  };
}

const wrap = (req) =>
  new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

async function indexedDbBackend(idb) {
  const db = await new Promise((resolve, reject) => {
    const open = idb.open(DB_NAME, DB_VERSION);
    open.onupgradeneeded = () => {
      for (const c of Object.keys(COLLECTION_DEFS)) if (!open.result.objectStoreNames.contains(c)) open.result.createObjectStore(c);
    };
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error);
    open.onblocked = () => reject(new Error('database blocked'));
  });
  const store = (c, mode) => db.transaction(c, mode).objectStore(c);
  return {
    kind: 'indexeddb',
    put: (c, key, record) => wrap(store(c, 'readwrite').put(record, key)),
    get: async (c, key) => (await wrap(store(c, 'readonly').get(key))) ?? null,
    list: (c) => wrap(store(c, 'readonly').getAll()),
    delete: (c, key) => wrap(store(c, 'readwrite').delete(key)),
    clear: (c) => wrap(store(c, 'readwrite').clear())
  };
}

export async function openStore({ indexedDB = globalThis.indexedDB } = {}) {
  let backend;
  try {
    backend = indexedDB ? await indexedDbBackend(indexedDB) : memoryBackend();
  } catch {
    backend = memoryBackend();
  }
  const def = (c) => {
    if (!COLLECTION_DEFS[c]) throw new Error('unknown collection: ' + c);
    return COLLECTION_DEFS[c];
  };
  return {
    kind: backend.kind,
    async put(collection, record) {
      const d = def(collection);
      const check = d.validate(record);
      if (!check.ok) throw new Error('invalid ' + collection + ' record: ' + check.errors.join('; '));
      const key = d.keyOf(record);
      await backend.put(collection, key, record);
      return key;
    },
    get: (collection, key) => (def(collection), backend.get(collection, key)),
    list: (collection) => (def(collection), backend.list(collection)),
    delete: (collection, key) => (def(collection), backend.delete(collection, key)),
    clear: (collection) => (def(collection), backend.clear(collection))
  };
}
