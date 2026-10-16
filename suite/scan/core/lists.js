// Several named lists on the device. Keeps the 20 most recently changed. Each list holds its rows; everything else
// (settings, counts) lives elsewhere. `store` is { load(), save(state) } (IndexedDB in the browser, memory in tests).
export const MAX_LISTS = 20;

export async function openLists({ store, legacy, now = () => new Date().toISOString() }) {
  let st = (await store.load()) || null;
  let pending = Promise.resolve();
  if (!st || !st.lists || !Object.keys(st.lists).length) {
    // First run, or first run since lists existed: the old single list becomes "My list" so nothing is lost.
    const l = { id: 'list-1', name: 'My list', createdAt: now(), updatedAt: now(), items: (legacy && legacy.items) || [], seq: (legacy && legacy.seq) || 0 };
    st = { version: 1, activeId: l.id, nextId: 2, lists: { [l.id]: l } };
  }
  const persist = () => { pending = pending.then(() => store.save(st)).catch(() => {}); return pending; };
  const must = (id) => { const l = st.lists[id]; if (!l) throw new Error('no such list: ' + id); return l; };
  const cap = () => { // over the limit: forget the oldest, never the one in use
    const ids = Object.values(st.lists).filter((l) => l.id !== st.activeId).sort((a, b) => a.updatedAt.localeCompare(b.updatedAt)).map((l) => l.id);
    while (Object.keys(st.lists).length > MAX_LISTS && ids.length) delete st.lists[ids.shift()];
  };
  const newList = (name, items = [], seq = 0) => {
    const id = 'list-' + st.nextId; st.nextId += 1;
    st.lists[id] = { id, name: name || 'List ' + (st.nextId - 1), createdAt: now(), updatedAt: now(), items, seq };
    return id;
  };
  const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, 40);
  const api = {
    get activeId() { return st.activeId; },
    count: () => Object.keys(st.lists).length,
    meta() {
      return Object.values(st.lists).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map((l) => ({
        id: l.id, name: l.name, updatedAt: l.updatedAt, rows: l.items.length, cards: l.items.reduce((n, i) => n + i.quantity, 0), active: l.id === st.activeId,
      }));
    },
    items: (id) => must(id).items.map((i) => ({ ...i })),
    create(name) { const id = newList(clean(name)); st.activeId = id; cap(); persist(); return id; },
    rename(id, name) { const n = clean(name); if (!n) throw new Error('a list needs a name'); must(id).name = n; must(id).updatedAt = now(); persist(); },
    duplicate(id) {
      const src = must(id);
      const nid = newList(clean(src.name + ' copy'), JSON.parse(JSON.stringify(src.items)), src.seq);
      st.activeId = nid; cap(); persist(); return nid;
    },
    // Returns the id now in use (a fresh empty list if the last one was deleted).
    remove(id) {
      must(id); delete st.lists[id];
      if (!Object.keys(st.lists).length) st.activeId = newList('My list');
      else if (st.activeId === id) st.activeId = api.meta()[0].id;
      persist(); return st.activeId;
    },
    switchTo(id) { must(id); st.activeId = id; persist(); },
    // Adapter for openSession: the session reads and writes only the rows of one list.
    sessionStore(id) {
      return {
        kind: 'list',
        async load() { const l = st.lists[id]; return l ? { items: l.items, seq: l.seq } : undefined; },
        async save(state) { const l = st.lists[id]; if (!l) return; l.items = state.items; l.seq = state.seq; l.updatedAt = now(); await persist(); },
      };
    },
    flush: () => pending,
  };
  persist();
  return api;
}
