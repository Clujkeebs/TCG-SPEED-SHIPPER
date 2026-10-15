// The side panel's brain, with no DOM so it can be tested. It keeps the list of things to show and
// the approval cards. Rules: an approval is only ever answered by a click (answer() is the only way),
// each card can be answered once, and anything that fails the protocol check is shown as an error.
import { validateEvent, userMessage, approvalReply } from './protocol.js';

export function createPanel(transport) {
  const items = []; // { kind: 'user'|'agent'|'tool'|'approval'|'error', ... }
  let busy = false;
  const listeners = new Set();
  const changed = () => listeners.forEach((f) => f());

  transport.onEvent((e) => {
    const check = validateEvent(e);
    if (!check.ok) items.push({ kind: 'error', text: 'Ignored a message that did not look right.' });
    else if (e.type === 'text') items.push({ kind: 'agent', text: e.text });
    else if (e.type === 'tool_call') items.push({ kind: 'tool', tool: e.tool, tier: e.tier, text: e.summary });
    else if (e.type === 'approval_request') items.push({ kind: 'approval', id: e.id, tool: e.tool, description: e.description, args: e.args, state: 'waiting' });
    else if (e.type === 'error') { items.push({ kind: 'error', text: e.message }); busy = false; }
    else if (e.type === 'done') busy = false;
    changed();
  });

  return {
    items,
    get busy() { return busy; },
    get waitingForApproval() { return items.some((i) => i.kind === 'approval' && i.state === 'waiting'); },
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    say(text) {
      const t = String(text ?? '').trim();
      if (!t || t.length > 2000 || busy) return false;
      items.push({ kind: 'user', text: t });
      busy = true;
      transport.send(userMessage(t));
      changed();
      return true;
    },
    // Called from a button click only.
    answer(id, approved) {
      const card = items.find((i) => i.kind === 'approval' && i.id === id && i.state === 'waiting');
      if (!card) return false;
      card.state = approved ? 'approved' : 'denied';
      transport.send(approvalReply(id, approved === true));
      changed();
      return true;
    }
  };
}
