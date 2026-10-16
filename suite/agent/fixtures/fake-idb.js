// A small, faithful fake of the browser's IndexedDB for tests: object stores with in-line or out-of-line keys, auto
// increment, put/add/get/delete/getAll/getAllKeys, async callbacks, values copied on the way in and out (like
// structured clone), data kept per factory so closing and reopening finds it again. Failure injection:
// idb.failNext('put', error) makes the next put/add fail once.
export function createFakeIdb() {
  const dbs = new Map(); // name -> { version, stores: Map(name -> { opts, rows: Map, seq }) }
  const failures = [];
  const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
  const later = (fn) => queueMicrotask(fn);
  const stats = { puts: 0, gets: 0 };

  function request(run) {
    const r = { result: undefined, error: null, onsuccess: null, onerror: null };
    later(() => {
      try { r.result = run(); r.onsuccess && r.onsuccess({ target: r }); } catch (e) { r.error = e; r.onerror && r.onerror({ target: r }); }
    });
    return r;
  }
  function objectStore(st) {
    const keyOf = (value, key) => {
      if (st.opts.keyPath) return value[st.opts.keyPath] !== undefined ? value[st.opts.keyPath] : (st.opts.autoIncrement ? ++st.seq : (() => { throw new Error('DataError: no key'); })());
      if (key !== undefined) return key;
      if (st.opts.autoIncrement) return ++st.seq;
      throw new Error('DataError: no key');
    };
    const write = (kind) => (value, key) => request(() => {
      const f = failures.findIndex((x) => x.kind === kind);
      if (f >= 0) { const [{ error }] = failures.splice(f, 1); throw error; }
      stats.puts += 1;
      const v = clone(value);
      const k = keyOf(v, key);
      if (kind === 'add' && st.rows.has(k)) throw new Error('ConstraintError: key exists');
      if (st.opts.keyPath && v[st.opts.keyPath] === undefined) v[st.opts.keyPath] = k;
      st.rows.set(k, v);
      return k;
    });
    return {
      put: write('put'), add: write('add'),
      get: (k) => request(() => { stats.gets += 1; return clone(st.rows.get(k)); }),
      delete: (k) => request(() => { st.rows.delete(k); }),
      getAll: () => request(() => [...st.rows.values()].map(clone)),
      getAllKeys: () => request(() => [...st.rows.keys()]),
      count: () => request(() => st.rows.size),
      clear: () => request(() => { st.rows.clear(); }),
    };
  }
  return {
    stats,
    failNext(kind, error = new Error('QuotaExceededError')) { failures.push({ kind, error }); },
    open(name, version = 1) {
      const req = { result: undefined, error: null, onsuccess: null, onerror: null, onupgradeneeded: null };
      later(() => {
        let rec = dbs.get(name);
        const fresh = !rec || rec.version < version;
        if (!rec) { rec = { version, stores: new Map() }; dbs.set(name, rec); }
        const db = {
          objectStoreNames: { contains: (n) => rec.stores.has(n) },
          createObjectStore(n, opts = {}) { const st = { opts, rows: new Map(), seq: 0 }; rec.stores.set(n, st); return objectStore(st); },
          transaction(names, mode) {
            const list = [].concat(names);
            for (const n of list) if (!rec.stores.has(n)) throw new Error('NotFoundError: ' + n);
            return { mode, objectStore: (n) => objectStore(rec.stores.get(n)) };
          },
          close() {},
        };
        req.result = db;
        if (fresh) { rec.version = version; req.onupgradeneeded && req.onupgradeneeded({ target: req }); }
        req.onsuccess && req.onsuccess({ target: req });
      });
      return req;
    },
  };
}
