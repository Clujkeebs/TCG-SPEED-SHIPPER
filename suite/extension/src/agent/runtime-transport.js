// The real connection from the side panel to the service worker (chrome.runtime messages).
// Same shape as the practice transport: request(msg) -> Promise<response>, onEvent(fn).
import { AGENT_SOURCE } from './protocol.js';

export function createRuntimeTransport(runtime = globalThis.chrome.runtime) {
  return {
    request: (msg) => runtime.sendMessage(msg),
    onEvent(fn) {
      runtime.onMessage.addListener((m, sender) => {
        // Only events from our own extension (the service worker), never from a web page.
        if (sender.id === runtime.id && m && m.source === AGENT_SOURCE && 'event' in m) fn(m);
      });
    }
  };
}
