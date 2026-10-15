// A practice Agent connection: scripted answers on made-up data. Nothing here is real and nothing
// changes anything. It exists so the panel can be built and tested before a real connection exists.
// transport.send(clientMessage) -> void; transport.onEvent(fn) registers the listener.
import { PROTOCOL_VERSION as v, validateClientMessage } from './protocol.js';

export function createFixtureTransport() {
  let listener = () => {};
  let pending = null; // the one approval we are waiting for
  const emit = (e) => queueMicrotask(() => listener({ v, ...e }));

  function send(m) {
    const check = validateClientMessage(m);
    if (!check.ok) return emit({ type: 'error', message: 'The panel sent a message the practice agent did not understand.' });
    if (m.type === 'user_message') {
      emit({ type: 'tool_call', tool: 'orders.stats', tier: 'read', summary: 'Looked at the last 30 days of made-up orders' });
      if (/price|reprice|cheaper/i.test(m.text)) {
        pending = 'fx-approval-1';
        emit({ type: 'text', text: 'I can lower the price of Sample Card A from $1.50 to $1.35. This needs your OK.' });
        emit({ type: 'approval_request', id: pending, tool: 'listing.setPrice', tier: 'act', description: 'Change one listing price (practice only: nothing is changed)', args: [{ label: 'Card', value: 'Sample Card A' }, { label: 'Old price', value: '$1.50' }, { label: 'New price', value: '$1.35' }] });
        return;
      }
      emit({ type: 'text', text: 'Practice answer: you shipped 42 orders in the last 30 days, 9 of them to repeat buyers. (Made-up numbers.)' });
      emit({ type: 'done' });
      return;
    }
    if (m.type === 'approval') {
      if (m.id !== pending) return emit({ type: 'error', message: 'That approval is not waiting for an answer.' });
      pending = null;
      emit({ type: 'text', text: m.approved ? 'Approved. In practice mode nothing was changed.' : 'Okay, I did not change anything.' });
      emit({ type: 'done' });
    }
  }
  return { send, onEvent: (fn) => { listener = fn; } };
}
