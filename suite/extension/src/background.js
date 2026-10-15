// Service worker. Answers checked messages from the Speed Shipper site and nothing else.
// It never contacts any website and never acts on a TCGplayer page.
import { validateRequest, makeResponse, makeError } from './bridge.js';
import { getFlags } from './flags.js';
import { openStore } from './store.js';

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

if (globalThis.chrome?.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
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
