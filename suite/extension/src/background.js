// Service worker. Answers checked messages from the Speed Shipper site (hello, tracking.put) and nothing else.
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
        return makeResponse(msg.id, { name: 'TCG Speed Suite', version: globalThis.chrome?.runtime?.getManifest?.().version ?? 'test' });
      case 'tracking.put': {
        const record = { id: p.batchId, receivedAt: new Date().toISOString(), items: p.items.map((i) => ({ ...i })) };
        return makeResponse(msg.id, { key: await store.put('trackingBatches', record), count: record.items.length });
      }
    }
  } catch (err) {
    return makeError(msg.id, err.message);
  }
  return makeError(msg.id, 'unknown type');
}

// ---- the practice Agent host (the real Agent core on made-up data)
// The worker can be shut down at any moment; the host saves its state and restores it on the next wake.
let hostInstance;
const broadcast = (event) => { try { chrome.runtime.sendMessage(event).catch(() => {}); } catch { /* no panel open */ } };
export const BADGE_COLOR = '#c97a00';

function setBadge(count) {
  if (!globalThis.chrome?.action?.setBadgeText) return;
  chrome.action.setBadgeText({ text: count > 0 ? String(Math.min(count, 99)) : '' }).catch?.(() => {});
  if (count > 0) chrome.action.setBadgeBackgroundColor?.({ color: BADGE_COLOR });
}

function getHost(extensionId) {
  hostInstance ??= createPracticeHost({
    extensionId, persist: chromeStatePersist(), onBadge: setBadge,
    loadOrders: async () => (await getStore()).list('orders'),
    auditStore: globalThis.indexedDB ? createIdbStore(indexedDB, AUDIT_DB) : undefined
  });
  return hostInstance;
}

// Only our own extension pages talk to the Agent, and only while the "Agent side panel" switch is on.
export async function handlePanelMessage(msg, sender, extensionId, emit) {
  if (!(await getFlags()).agentPanel) return agentError(msg?.id, 'The Agent panel is switched off in Settings.');
  return getHost(extensionId).handle(msg, sender, emit);
}

// Once a minute: run any background job whose time has come (practice data; act steps wait for the seller).
export const ALARM_NAME = 'tcgss-tick';
export async function runDueJobs(extensionId, emit = broadcast) {
  if (!(await getFlags()).agentPanel) return [];
  return getHost(extensionId).tick(emit);
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
        setBadge(0);
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

// Alarms and wake-up work must be registered at the top level, so a sleeping worker is woken for them.
if (globalThis.chrome?.alarms) {
  const ensureAlarm = () => chrome.alarms.get(ALARM_NAME).then((a) => { if (!a) chrome.alarms.create(ALARM_NAME, { periodInMinutes: 1 }); });
  chrome.runtime.onInstalled.addListener(ensureAlarm);
  chrome.runtime.onStartup.addListener(ensureAlarm);
  ensureAlarm();
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === ALARM_NAME) runDueJobs(chrome.runtime.id).catch(() => {});
  });
  // Waking up for any reason: bring the toolbar badge back to the right number.
  getFlags().then((f) => { if (f.agentPanel) return getHost(chrome.runtime.id).ready; }).catch(() => {});
}
