// Message bridge between the Speed Shipper web app and the extension.
// Pure functions, no chrome.* calls, so the same rules run in the content script, the service
// worker and the tests. Every message is checked against an origin allow-list and a schema.
//
// The bridge is deliberately tiny. A web page (or a script injected into one) can call exactly four things, and
// every one of them is write-only (nothing is ever read back out of the extension):
//   hello           who are you (name and version only)
//   tracking.put    hand over a batch of tracking numbers
//   account.link    hand over the signed-in user's ACCESS token and its expiry (never a refresh token)
//   account.unlink  forget it (sign-out)
// Nothing a page can send reads anything back from the extension's storage, and nothing can write to the
// seller's orders, inventory, listings or scans. Those never leave the device through this bridge.
import { ALLOW_LOCALHOST } from './build-config.js';

export const BRIDGE_VERSION = 1;
export const REQUEST_SOURCE = 'tcgss-app';
export const RESPONSE_SOURCE = 'tcgss-extension';
export const SITE_ORIGIN = 'https://tcgspeedshipper.com';
export const MAX_ID_LENGTH = 80;

// The production build accepts only the exact site origin. localhost (any port) is accepted ONLY in the
// test build (see scripts/make-test-build.js), where build-config.js says so.
export function isAllowedOrigin(origin, allowLocalhost = ALLOW_LOCALHOST) {
  if (typeof origin !== 'string') return false;
  let u;
  try {
    u = new URL(origin);
  } catch {
    return false;
  }
  if (u.origin !== origin) return false;
  if (u.protocol === 'https:' && u.hostname === 'tcgspeedshipper.com' && u.port === '') return true;
  return allowLocalhost === true && u.protocol === 'http:' && u.hostname === 'localhost';
}

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isShortStr = (v) => typeof v === 'string' && v.length > 0 && v.length <= MAX_ID_LENGTH;

// ---- Tracking batches (Shipper -> extension). The website hands over tracking numbers it just made; the
// extension keeps them on this computer, ready for "Paste tracking" later. Nothing leaves the device.
export const CARRIERS = ['USPS', 'UPS', 'FedEx', 'DHL', 'other'];
export const MAX_BATCH_ITEMS = 200;
const ORDER_ID = /^[A-Za-z0-9._-]{1,80}$/;
const TRACKING = /^[A-Za-z0-9 ]{6,40}$/;

// Returns an error string or null. Exact shape: { batchId, items: [{ orderId, trackingNumber, carrier? }] }.
export function checkTrackingBatch(p) {
  if (!isObj(p) || Object.keys(p).some((k) => !['batchId', 'items'].includes(k))) return 'payload must be { batchId, items }';
  if (typeof p.batchId !== 'string' || !ORDER_ID.test(p.batchId)) return 'batchId must be 1 to 80 letters, digits, dot, dash or underscore';
  if (!Array.isArray(p.items) || p.items.length < 1 || p.items.length > MAX_BATCH_ITEMS) return 'items must be a list of 1 to ' + MAX_BATCH_ITEMS;
  const seen = new Set();
  for (const it of p.items) {
    if (!isObj(it) || Object.keys(it).some((k) => !['orderId', 'trackingNumber', 'carrier'].includes(k))) return 'each item must be { orderId, trackingNumber, carrier? }';
    if (typeof it.orderId !== 'string' || !ORDER_ID.test(it.orderId)) return 'orderId must be 1 to 80 letters, digits, dot, dash or underscore';
    if (seen.has(it.orderId)) return 'orderId appears twice: ' + it.orderId;
    seen.add(it.orderId);
    if (typeof it.trackingNumber !== 'string' || !TRACKING.test(it.trackingNumber)) return 'trackingNumber must be 6 to 40 letters, digits or spaces';
    if (it.carrier !== undefined && !CARRIERS.includes(it.carrier)) return 'carrier must be one of ' + CARRIERS.join(', ');
  }
  return null;
}

// ---- Account link: the site hands over the signed-in user's ACCESS token. It is kept in memory/session storage only,
// used for one status call, and dropped at its expiry, on sign-out and on Clear everything.
export const MAX_TOKEN_LENGTH = 4096;
const JWT = /^[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}$/;
const REFRESHY = /refresh|secret|password|session|user/i;

// expiresAt: seconds (what the site's login stores) or milliseconds since 1970 -> milliseconds, or null.
export function normalizeExpiry(v) {
  if (!Number.isFinite(v) || v <= 0) return null;
  if (v > 1e11 && v < 1e14) return Math.round(v); // already milliseconds
  if (v > 1e8 && v < 1e11) return Math.round(v * 1000); // seconds
  return null;
}

// Returns an error string or null. Exact shape: { accessToken, expiresAt }.
export function checkAccountLink(p) {
  if (!isObj(p)) return 'payload must be { accessToken, expiresAt }';
  for (const k of Object.keys(p)) {
    if (REFRESHY.test(k)) return 'send only the access token and its expiry (nothing else, never a refresh token)';
    if (!['accessToken', 'expiresAt'].includes(k)) return 'payload must be { accessToken, expiresAt }';
  }
  if (typeof p.accessToken !== 'string' || p.accessToken.length > MAX_TOKEN_LENGTH || !JWT.test(p.accessToken)) return 'accessToken is not a login token';
  if (normalizeExpiry(p.expiresAt) === null) return 'expiresAt must be a time in seconds or milliseconds';
  return null;
}

// type -> payload check. Returns an error string or null.
const PAYLOADS = {
  hello: (p) => (p === undefined || (isObj(p) && Object.keys(p).length === 0) ? null : 'hello takes no payload'),
  'tracking.put': checkTrackingBatch,
  'account.link': checkAccountLink,
  'account.unlink': (p) => (p === undefined || (isObj(p) && Object.keys(p).length === 0) ? null : 'account.unlink takes no payload')
};
export const MESSAGE_TYPES = Object.keys(PAYLOADS);

// Check one request. `origin` is the sender's origin as reported by the browser (never by the message).
export function validateRequest(msg, origin, { allowLocalhost = ALLOW_LOCALHOST } = {}) {
  if (!isAllowedOrigin(origin, allowLocalhost)) return { ok: false, error: 'origin not allowed' };
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
