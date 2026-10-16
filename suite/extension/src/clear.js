// "Clear everything": erases every bit of data the extension keeps on this computer: settings and
// switches, the practice Agent's plan, memory and audit trail, stored orders/listings/tracking batches.
// Nothing is sent anywhere. (Existing database connections stay open, so stores are emptied, not deleted.)
import { COLLECTION_DEFS } from './store.js';
import { AUDIT_DB } from './agent-host/persist.js';

function emptyAllStores(idb, name) {
  return new Promise((resolve) => {
    let req;
    try { req = idb.open(name); } catch { return resolve(0); }
    req.onerror = () => resolve(0);
    req.onsuccess = () => {
      const db = req.result;
      const names = [...db.objectStoreNames];
      if (!names.length) { db.close(); return resolve(0); }
      const tx = db.transaction(names, 'readwrite');
      names.forEach((n) => tx.objectStore(n).clear());
      tx.oncomplete = () => { db.close(); resolve(names.length); };
      tx.onerror = tx.onabort = () => { db.close(); resolve(0); };
    };
  });
}

// deps: { storage (chrome.storage.local), store (openStore result), idb (indexedDB), host? (practice host) }
export async function clearEverything({ storage, store, idb, host }) {
  const done = [];
  if (host) { await host.clearAll(); done.push('agent'); }
  if (store) { for (const c of Object.keys(COLLECTION_DEFS)) await store.clear(c); done.push('records'); }
  if (idb) { await emptyAllStores(idb, AUDIT_DB); done.push('audit'); }
  if (storage) { await storage.clear(); done.push('settings'); }
  return { ok: true, cleared: done };
}
