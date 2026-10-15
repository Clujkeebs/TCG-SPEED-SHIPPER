// Message bridge between the Speed Shipper web app and the extension.
// Pure functions, no chrome.* calls, so the same rules run in the content script, the service
// worker and the tests. Every message is checked against an origin allow-list and a schema.

export const BRIDGE_VERSION = 1;
export const REQUEST_SOURCE = 'tcgss-app';
export const RESPONSE_SOURCE = 'tcgss-extension';
export const ALLOWED_ORIGINS = ['https://tcgspeedshipper.com', 'http://localhost'];
export const COLLECTIONS = ['orders', 'listings', 'inventory', 'scans'];
export const MAX_ID_LENGTH = 80;
export const MAX_RECORD_BYTES = 64 * 1024;

function tooBig(record) {
  try {
    return JSON.stringify(record).length > MAX_RECORD_BYTES;
  } catch {
    return true; // cannot be serialized
  }
}

// localhost may carry any port in development; every other origin must match exactly.
export function isAllowedOrigin(origin) {
  if (typeof origin !== 'string') return false;
  let u;
  try {
    u = new URL(origin);
  } catch {
    return false;
  }
  if (u.origin !== origin) return false;
  if (u.protocol === 'https:' && u.hostname === 'tcgspeedshipper.com' && u.port === '') return true;
  return u.protocol === 'http:' && u.hostname === 'localhost';
}

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isShortStr = (v) => typeof v === 'string' && v.length > 0 && v.length <= MAX_ID_LENGTH;

// type -> payload check. Returns an error string or null.
const PAYLOADS = {
  hello: (p) => (p === undefined || (isObj(p) && Object.keys(p).length === 0) ? null : 'hello takes no payload'),
  'store.put': (p) => {
    if (!isObj(p) || !COLLECTIONS.includes(p.collection)) return 'collection must be one of ' + COLLECTIONS.join(', ');
    if (!isObj(p.record)) return 'record must be an object';
    return tooBig(p.record) ? 'record too large' : null;
  },
  'store.get': (p) => {
    if (!isObj(p) || !COLLECTIONS.includes(p.collection)) return 'collection must be one of ' + COLLECTIONS.join(', ');
    return isShortStr(p.key) ? null : 'key must be a short string';
  },
  'store.list': (p) => (isObj(p) && COLLECTIONS.includes(p.collection) ? null : 'collection must be one of ' + COLLECTIONS.join(', '))
};
export const MESSAGE_TYPES = Object.keys(PAYLOADS);

// Check one request. `origin` is the sender's origin as reported by the browser (never by the message).
export function validateRequest(msg, origin) {
  if (!isAllowedOrigin(origin)) return { ok: false, error: 'origin not allowed' };
  if (!isObj(msg)) return { ok: false, error: 'message must be an object' };
  if (msg.source !== REQUEST_SOURCE) return { ok: false, error: 'wrong source' };
  if (msg.v !== BRIDGE_VERSION) return { ok: false, error: 'unsupported version' };
  if (!isShortStr(msg.id)) return { ok: false, error: 'id must be a short string' };
  if (!MESSAGE_TYPES.includes(msg.type)) return { ok: false, error: 'unknown type' };
  const known = ['source', 'v', 'id', 'type', 'payload'];
  if (Object.keys(msg).some((k) => !known.includes(k))) return { ok: false, error: 'unexpected field' };
  const problem = PAYLOADS[msg.type](msg.payload);
  return problem ? { ok: false, error: problem } : { ok: true };
}

export function makeResponse(id, result) {
  return { source: RESPONSE_SOURCE, v: BRIDGE_VERSION, id, ok: true, result };
}
export function makeError(id, error) {
  return { source: RESPONSE_SOURCE, v: BRIDGE_VERSION, id: typeof id === 'string' ? id.slice(0, MAX_ID_LENGTH) : null, ok: false, error: String(error) };
}
