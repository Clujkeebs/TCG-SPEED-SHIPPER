// Service worker. Answers checked messages from the Speed Shipper site and nothing else.
// It never contacts any website and never acts on a TCGplayer page.
import { validateRequest, makeResponse, makeError } from './bridge.js';
import { getFlags } from './flags.js';
import { openStore } from './store.js';
import { createPracticeHost } from './agent-host/host.js';
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
  hostInstance ??= createPracticeHost({ extensionId });
  return hostInstance.handle(msg, sender, emit);
}

if (globalThis.chrome?.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
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
