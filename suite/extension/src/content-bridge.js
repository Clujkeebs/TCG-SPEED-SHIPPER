// Runs on the Speed Shipper site only. Passes checked messages from the page to the service
// worker and sends the answer back. Does nothing on any other site (the manifest decides that).
import { isAllowedOrigin, validateRequest, makeError, REQUEST_SOURCE } from './bridge.js';

export function handle(event) {
  if (event.source !== window) return;
  if (!isAllowedOrigin(event.origin) || event.origin !== location.origin) return;
  if (!event.data || event.data.source !== REQUEST_SOURCE) return;
  const reply = (data) => window.postMessage(data, location.origin);
  const check = validateRequest(event.data, event.origin);
  if (!check.ok) return reply(makeError(event.data.id, check.error));
  chrome.runtime.sendMessage(event.data).then(reply, (err) => reply(makeError(event.data.id, err?.message || 'extension unavailable')));
}

export function start() {
  window.addEventListener('message', handle);
}
