// Connects the side panel to the practice host in the same process (no browser), for tests.
import { createPracticeHost } from '../../src/agent-host/host.js';

export function hostTransport() {
  const id = 'ext-test-id';
  const sender = { id, url: `chrome-extension://${id}/src/ui/sidepanel.html` };
  const host = createPracticeHost({ extensionId: id });
  let listener = () => {};
  const emit = (e) => setTimeout(() => listener(e), 0);
  return { host, push: emit, request: (msg) => host.handle(msg, sender, emit), onEvent: (fn) => { listener = fn; } };
}
