// Service worker. Answers checked messages from the Speed Shipper site and nothing else.
// It never contacts any website and never acts on a TCGplayer page.
import { validateRequest, makeResponse, makeError } from './bridge.js';
import { getFlags } from './flags.js';
import { openStore } from './store.js';
import { createPracticeHost } from './agent-host/host.js';
import { chromeStatePersist, AUDIT_DB } from './agent-host/persist.js';
import { createIdbStore } from './vendor/agent/audit.js';
import { clearEverything } from './clear.js';
import { PANEL_SOURCE, AGENT_SOURCE, makeError as agentError } from './vendor/agent/protocol.js';

let storePromise;
const getStore = () => (storePromise ??= openStore());

export async function handleRequest(msg, senderOrigin, store) {
  const check = validateRequest(msg, senderOrigin);
  if (!check.ok) return makeError(msg?.id, check.error);
  try {
    const p = msg.payload;
    switch (msg.type) {
      case 'hello':
        return makeResponse(msg.id, { name: 'TCG Speed Suite', version: globalThis.chrome?.runtime?.getManifest?.().version ?? 'test', flags: await getFlags() });
      case 'tracking.put': {
        const record = { id: p.batchId, receivedAt: new Date().toISOString(), items: p.items.map((i) => ({ ...i })) };
        return makeResponse(msg.id, { key: await store.put('trackingBatches', record), count: record.items.length });
      }
      case 'tracking.get':
        return makeResponse(msg.id, { batch: await store.get('trackingBatches', p.batchId) });
      case 'tracking.list':
        return makeResponse(msg.id, { batches: (await store.list('trackingBatches')).map((b) => ({ id: b.id, receivedAt: b.receivedAt, count: b.items.length })) });
      case 'store.put':
        return makeResponse(msg.id, { key: await store.put(p.collection, p.record) });
      case 'store.get':
        return makeResponse(msg.id, { record: await store.get(p.collection, p.key) });
      case 'store.list':
        return makeResponse(msg.id, { records: await store.list(p.collection) });
    }
  } catch (err) {
    return makeError(msg.id, err.message);
  }
  return makeError(msg.id, 'unknown type');
}

// The Agent side panel talks to a practice host (the real Agent engine on made-up data). It answers
// only our own extension pages, and only while the "Agent side panel" switch is on.
let hostInstance;
export async function handlePanelMessage(msg, sender, extensionId, emit) {
  if (!(await getFlags()).agentPanel) return agentError(msg?.id, 'The Agent panel is switched off in Settings.');
  // State and the audit trail live in storage, so a worker that went to sleep wakes up where it left off.
  hostInstance ??= createPracticeHost({ extensionId, persist: chromeStatePersist(), auditStore: globalThis.indexedDB ? createIdbStore(indexedDB, AUDIT_DB) : undefined });
  return hostInstance.handle(msg, sender, emit);
}

// "Clear everything" comes only from our own extension pages (the Settings page), never from a web page.
export async function handleAdminMessage(msg, sender, extensionId, deps) {
  const own = sender && sender.id === extensionId && typeof sender.url === 'string' && sender.url.startsWith('chrome-extension://' + extensionId + '/');
  if (!own || msg.type !== 'clear-everything') return { ok: false, error: 'not allowed' };
  const result = await clearEverything(deps);
  return result;
}

if (globalThis.chrome?.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg && msg.source === 'tcgss-admin') {
      (async () => {
        const store = await getStore();
        const host = hostInstance;
        const out = await handleAdminMessage(msg, sender, chrome.runtime.id, { storage: chrome.storage.local, store, idb: globalThis.indexedDB, host });
        hostInstance = undefined; // next use starts from a clean slate
        return out;
      })().then(sendResponse, (err) => sendResponse({ ok: false, error: err?.message || 'failed' }));
      return true;
    }
    if (msg && msg.source === PANEL_SOURCE) {
      const emit = (event) => chrome.runtime.sendMessage(event).catch(() => {});
      handlePanelMessage(msg, sender, chrome.runtime.id, emit).then(sendResponse, (err) => sendResponse(agentError(msg.id, err?.message || 'failed')));
      return true;
    }
    if (msg && msg.source === AGENT_SOURCE) return false; // our own events, not for the worker
    // Only our own content script (on an allowed page) may talk to us.
    if (sender.id !== chrome.runtime.id || !sender.url) return false;
    let origin;
    try {
      origin = new URL(sender.url).origin;
    } catch {
      return false;
    }
    getStore().then((store) => handleRequest(msg, origin, store)).then(sendResponse);
    return true;
  });
  chrome.sidePanel?.setPanelBehavior?.({ openPanelOnActionClick: false }).catch(() => {});
}
