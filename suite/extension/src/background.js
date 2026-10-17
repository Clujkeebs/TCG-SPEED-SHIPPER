// Service worker. Answers checked messages from the Speed Shipper site (hello, tracking.put) and nothing else.
// It never contacts any website and never acts on a TCGplayer page.
import { validateRequest, makeResponse, makeError, normalizeExpiry } from './bridge.js';
import { createVault } from './account/vault.js';
import { checkAccount } from './account/status.js';
import { API_BASE } from './build-config.js';
import { SITE_ORIGIN } from './site-origin.js';
import { getFlags } from './flags.js';
import { openStore } from './store.js';
import { createPracticeHost } from './agent-host/host.js';
import { chromeStatePersist, AUDIT_DB } from './agent-host/persist.js';
import { createIdbStore } from './vendor/agent/audit.js';
import { clearEverything } from './clear.js';
import { PANEL_SOURCE, AGENT_SOURCE, makeError as agentError } from './vendor/agent/protocol.js';

// The login token lives here (memory, with session storage as a backup for a sleeping worker). Nowhere else.
export const vault = createVault({ area: globalThis.chrome?.storage?.session });

let storePromise;
const getStore = () => (storePromise ??= openStore());

export async function handleRequest(msg, senderOrigin, store, { vault: v = vault } = {}) {
  const check = validateRequest(msg, senderOrigin);
  if (!check.ok) return makeError(msg?.id, check.error);
  try {
    const p = msg.payload;
    switch (msg.type) {
      case 'hello':
        return makeResponse(msg.id, { name: 'TCG Speed Suite', version: globalThis.chrome?.runtime?.getManifest?.().version ?? 'test' });
      case 'account.link': {
        const ok = await v.set(p.accessToken, normalizeExpiry(p.expiresAt));
        forgetStatus();
        return ok ? makeResponse(msg.id, { linked: true }) : makeError(msg.id, 'That login has already expired or lasts too long. Sign in again.');
      }
      case 'account.unlink':
        await v.drop();
        forgetStatus();
        return makeResponse(msg.id, { linked: false });
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
// ---- "Is the online assistant available?" The panel asks; the answer is one plain line (never a token).
let statusCache = null; // { at, result }
export const OFF_LINE = 'The online assistant is off. Turn it on in Settings if you want it.';
// On only when the person switched it on AND Chrome still holds the permission they granted on that click.
async function onlineAssistantOn() {
  try {
    if (!(await getFlags()).onlineAssistant) return false;
    return (await chrome.permissions.contains({ origins: [SITE_ORIGIN] })) === true;
  } catch { return false; }
}

export async function handleAccountStatus(msg, sender, extensionId, { vault: v = vault, fetchFn, base = API_BASE, now = () => Date.now(), isOn = onlineAssistantOn } = {}) {
  const own = sender && sender.id === extensionId && typeof sender.url === 'string' && sender.url.startsWith('chrome-extension://' + extensionId + '/');
  if (!own || !msg || msg.type !== 'ext.account.status') return { ok: false, error: 'not allowed' };
  if (!(await isOn())) return { ok: true, result: { kind: 'assistant-off', line: OFF_LINE, openSite: false } };
  const hasToken = await v.has();
  if (statusCache && hasToken === statusCache.hadToken && now() - statusCache.at < 60000) return { ok: true, result: statusCache.result };
  const res = await checkAccount({ vault: v, fetchFn: fetchFn ?? globalThis.fetch.bind(globalThis), base });
  const result = { kind: res.kind, line: res.line, openSite: res.openSite === true };
  statusCache = { at: now(), result, hadToken: hasToken };
  return { ok: true, result };
}
export const forgetStatus = () => { statusCache = null; };

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
    loadStock: async () => { const st = await getStore(); return { items: await st.list('inventory'), printings: await st.list('printings') }; },
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
        const out = await handleAdminMessage(msg, sender, chrome.runtime.id, { storage: chrome.storage.local, session: chrome.storage.session, vault, store, idb: globalThis.indexedDB, host });
        forgetStatus();
        hostInstance = undefined; // next use starts from a clean slate
        setBadge(0);
        return out;
      })().then(sendResponse, (err) => sendResponse({ ok: false, error: err?.message || 'failed' }));
      return true;
    }
    if (msg && msg.source === PANEL_SOURCE && msg.type === 'ext.account.status') {
      handleAccountStatus(msg, sender, chrome.runtime.id).then((r) => sendResponse(r.ok ? { source: AGENT_SOURCE, v: 1, id: String(msg.id).slice(0, 80), ok: true, result: r.result } : agentError(msg.id, r.error)), () => sendResponse(agentError(msg.id, 'failed')));
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
