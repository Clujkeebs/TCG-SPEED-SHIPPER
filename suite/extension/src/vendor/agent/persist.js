// Saving the Agent's own state on the device: shop memory, plans (runs), approval cards, job reports and saved schedules.
// (The audit trail has its own IndexedDB store in audit.js.) The stores keep their normal in-memory interface; this file
// loads what was saved when the shop opens and saves again, in the background, after anything changes.
//   - one record per store in a single IndexedDB object store, written only when something actually changed
//   - writes are queued in order; flush() waits for them
//   - a failed write is reported (onError) and retried with the next change; the in-memory copy keeps working
//   - a record written by a NEWER version is left alone (read-only) so we never overwrite data we cannot read
// Buyer names are not saved here: the on-device names table from order files stays in memory only.
export const RECORD_VERSION = 1;

export function createKv(idb, { dbName = 'tcgss-agent-state', storeName = 'kv' } = {}) {
  let dbp;
  const open = () => (dbp ||= new Promise((resolve, reject) => {
    const r = idb.open(dbName, 1);
    r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains(storeName)) r.result.createObjectStore(storeName); };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => { dbp = undefined; reject(r.error || new Error('could not open the on-device database')); };
  }));
  const wrap = (r) => new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error || new Error('on-device database error')); });
  const store = async (mode) => (await open()).transaction(storeName, mode).objectStore(storeName);
  return {
    get: async (key) => wrap((await store('readonly')).get(key)),
    put: async (key, value) => wrap((await store('readwrite')).put(value, key)),
    delete: async (key) => wrap((await store('readwrite')).delete(key)),
    keys: async () => wrap((await store('readonly')).getAllKeys()),
  };
}

const SKIP = new Set(['snapshot', 'restore']);

// Load `key` into `target`, then save after every call on it. Returns { flush, readOnly, saves }.
export async function attach(target, { kv, key, snapshot, restore, onError = () => {} }) {
  let readOnly = false, last = null, saves = 0, chain = Promise.resolve(), snapshotting = false;
  let rec;
  try { rec = await kv.get(key); } catch (err) { onError(err); }
  if (rec) {
    if (rec.v === RECORD_VERSION) {
      try { restore(rec.data); last = JSON.stringify(rec.data); } catch (err) { readOnly = true; onError(new Error(`saved ${key} could not be read (${err.message}); leaving it untouched`)); }
    } else { readOnly = true; onError(new Error(`saved ${key} is from a different version; leaving it untouched`)); }
  }
  if (!rec && !readOnly) { try { last = JSON.stringify(snapshot()); } catch { /* first save will write */ } } // empty start: nothing to write until something changes
  const save = async () => {
    if (readOnly) return;
    // taking a snapshot calls the store's own (wrapped) methods; that must not schedule another save
    snapshotting = true;
    let data, json;
    try { data = snapshot(); json = JSON.stringify(data); } finally { snapshotting = false; }
    if (json === last) return;
    try { await kv.put(key, { v: RECORD_VERSION, data }); last = json; saves += 1; } catch (err) { onError(err); }
  };
  const schedule = () => { chain = chain.then(save); return chain; };
  for (const name of Object.keys(target)) {
    const orig = target[name];
    if (typeof orig !== 'function' || SKIP.has(name)) continue;
    target[name] = function (...args) {
      const out = orig.apply(this, args);
      if (snapshotting) return out;
      if (out && typeof out.then === 'function') return out.then((r) => { schedule(); return r; }, (e) => { schedule(); throw e; });
      schedule();
      return out;
    };
  }
  return { key, flush: () => chain, get readOnly() { return readOnly; }, get saves() { return saves; } };
}

// Everything the Agent keeps on the device, in one call. world: { memory, inbox, reports, automations, agent }.
export async function persistShop(world, idb, { onError = () => {}, dbName } = {}) {
  const kv = createKv(idb, dbName ? { dbName } : {});
  const handles = [];
  const add = async (target, key, snapshot, restore) => handles.push(await attach(target, { kv, key, snapshot, restore, onError }));
  await add(world.memory, 'memory', () => JSON.parse(world.memory.exportJson()), (d) => world.memory.importJson(JSON.stringify(d)));
  await add(world.automations, 'automations', () => world.automations.list(), (rows) => { for (const r of rows) world.automations.save(r); });
  await add(world.inbox, 'inbox', () => world.inbox.snapshot(), (s) => world.inbox.restore(s));
  await add(world.reports, 'reports', () => world.reports.snapshot(), (s) => world.reports.restore(s));
  await add(world.agent, 'plans', () => [...world.agent.runs.entries()], (rows) => { world.agent.runs.clear(); for (const [id, run] of rows) world.agent.runs.set(id, run); });
  return {
    kv,
    handles,
    flush: () => Promise.all(handles.map((h) => h.flush())),
    get saves() { return handles.reduce((n, h) => n + h.saves, 0); },
    get readOnly() { return handles.filter((h) => h.readOnly).map((h) => h.key); },
  };
}
