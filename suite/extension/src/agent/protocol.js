// Messages between the Agent side panel and an Agent connection (a "transport").
// The panel never imports the Agent itself: it only speaks this protocol, so the same panel works
// with the practice transport (fixtures, below) and, later, a real connection.
// Every message is a plain object checked here before it is used or shown.
export const PROTOCOL_VERSION = 1;
export const EVENT_TYPES = ['text', 'tool_call', 'approval_request', 'done', 'error'];
export const TIERS = ['read', 'draft', 'act', 'autopilot'];
const MAX_TEXT = 8000;
const MAX_ARG_ROWS = 12;

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isStr = (v, max = MAX_TEXT) => typeof v === 'string' && v.length > 0 && v.length <= max;
const plainName = (v) => typeof v === 'string' && /^[a-zA-Z0-9_.-]{1,60}$/.test(v);

// panel -> agent
export function validateClientMessage(m) {
  if (!isObj(m) || m.v !== PROTOCOL_VERSION) return { ok: false, error: 'bad message' };
  if (m.type === 'user_message') return isStr(m.text, 2000) && Object.keys(m).length === 3 ? { ok: true } : { ok: false, error: 'bad text' };
  if (m.type === 'approval') {
    const good = isStr(m.id, 80) && typeof m.approved === 'boolean' && Object.keys(m).length === 4;
    return good ? { ok: true } : { ok: false, error: 'bad approval' };
  }
  return { ok: false, error: 'unknown type' };
}

// agent -> panel
export function validateEvent(e) {
  if (!isObj(e) || e.v !== PROTOCOL_VERSION || !EVENT_TYPES.includes(e.type)) return { ok: false, error: 'bad event' };
  switch (e.type) {
    case 'text':
      return isStr(e.text) ? { ok: true } : { ok: false, error: 'bad text' };
    case 'tool_call':
      return plainName(e.tool) && TIERS.includes(e.tier) && isStr(e.summary, 400) ? { ok: true } : { ok: false, error: 'bad tool_call' };
    case 'approval_request': {
      const rows = e.args;
      const rowsOk = Array.isArray(rows) && rows.length <= MAX_ARG_ROWS && rows.every((r) => isObj(r) && isStr(r.label, 60) && isStr(String(r.value ?? ''), 200));
      // Only "act" tools ask for approval.
      return isStr(e.id, 80) && plainName(e.tool) && e.tier === 'act' && isStr(e.description, 400) && rowsOk ? { ok: true } : { ok: false, error: 'bad approval_request' };
    }
    case 'done':
      return { ok: true };
    case 'error':
      return isStr(e.message, 400) ? { ok: true } : { ok: false, error: 'bad error' };
  }
  return { ok: false, error: 'unknown' };
}

export const userMessage = (text) => ({ v: PROTOCOL_VERSION, type: 'user_message', text });
export const approvalReply = (id, approved) => ({ v: PROTOCOL_VERSION, type: 'approval', id, approved });
