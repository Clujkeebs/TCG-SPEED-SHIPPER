/* Pitney Bowes Shipping 360 API client (https://docs.shipping360.pitneybowes.com).
   Small on purpose: OAuth token (cached for half its life), rates, create a
   label, cancel (refund) a label, and tracking. No SDK dependency; uses the
   built-in fetch. `fetchImpl` is injectable so tests never touch the network.

   Credentials are the Client ID / Secret from 360.pitneybowes.com → Shipping
   API → API Keys. Sandbox labels are free test labels; production labels are
   real postage charged to the Shipping 360 account behind those keys. */
const crypto = require('crypto');

const HOSTS = {
  sandbox: 'https://api-sandbox.sendpro360.pitneybowes.com',
  production: 'https://api.sendpro360.pitneybowes.com',
};

// Node's built-in fetch sends "Accept-Language: *" when nobody sets one, and Pitney Bowes' gateway refuses that
// ("Invalid value for Accept-Language in http header, ex: en-US"; the owner's Oct 16 sample-order test, once the
// 429s stopped hiding it). So every call says what it means. Callers can still override a header.
const BASE_HEADERS = {
  Accept: 'application/json',
  'Accept-Language': 'en-US',
  'User-Agent': 'TCGSpeedShipper/1.0 (+https://tcgspeedshipper.com)',
};

class PbError extends Error {
  constructor(status, body) {
    const list = Array.isArray(body) ? body : (body && (body.errors || body.errorCauses)) || null;
    const first = (Array.isArray(list) && list[0]) || body;
    const pick = (o) => o && typeof o === 'object'
      ? (o.errorDescription || o.message || o.errorSummary || o.error_description || o.errorMessage)
      : (typeof o === 'string' && o.length < 300 ? o : null);
    super(pick(first) || pick(body) || ('Pitney Bowes error ' + status));
    this.status = status;
    this.body = body;
  }
}

function makePbClient({ key, secret, env = 'sandbox', partnerId, carrierAccountId, fetchImpl = fetch, now = Date.now,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)), maxRetries = 3, retryBaseMs = 400 }) {
  const host = HOSTS[env] || HOSTS.sandbox;
  let token = null; // { value, expiresAt }
  let uspsAccount = carrierAccountId || null; // looked up once if not given

  // A 429 means Pitney Bowes refused the request before doing anything, so
  // trying again is always safe. A 502/503/504 may have been processed, so those
  // are retried only for calls that change nothing (rates, tracking, lookups).
  // The same headers go out again, so the X-PB-TransactionId de-duplicates a retry.
  function retryDelay(res, attempt) {
    const h = res.headers && typeof res.headers.get === 'function' ? res.headers.get('retry-after') : null;
    const secs = h && /^\d+(\.\d+)?$/.test(String(h).trim()) ? Number(h) : NaN;
    const base = Number.isFinite(secs) ? secs * 1000 : retryBaseMs * (2 ** attempt);
    return Math.min(base, 4000) + Math.floor(Math.random() * 150);
  }
  async function call(url, init, { read = false } = {}) {
    for (let attempt = 0; ; attempt += 1) {
      const res = await fetchImpl(url, Object.assign({ signal: AbortSignal.timeout(30000) }, init, { headers: Object.assign({}, BASE_HEADERS, init.headers) }));
      const text = await res.text();
      let body = null;
      try { body = text ? JSON.parse(text) : null; } catch (e) { body = text; }
      if (res.ok) return body;
      const retryable = res.status === 429 || (read && (res.status === 502 || res.status === 503 || res.status === 504));
      if (retryable && attempt < maxRetries) { await sleep(retryDelay(res, attempt)); continue; }
      throw new PbError(res.status, body);
    }
  }

  // One token request at a time: a batch starts several calls at once, and
  // each one used to ask for its own token (a stampede Pitney Bowes answers
  // with 429 Too Many Requests).
  let tokenFlight = null;
  async function fetchToken() {
    const body = await call(host + '/auth/api/v1/token', {
      method: 'POST',
      headers: {
        Authorization: 'Basic ' + Buffer.from(key + ':' + secret).toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials&scope=psapi',
    }, { read: true });
    // Refresh at half-life so a token never expires mid-batch.
    const ttl = Number(body && (body.expires_in || body.expiresIn)) || 14400;
    token = { value: body.access_token, expiresAt: now() + ttl * 500 };
    return token.value;
  }
  async function getToken() {
    if (token && token.expiresAt > now()) return token.value;
    if (!tokenFlight) tokenFlight = fetchToken().finally(() => { tokenFlight = null; });
    return tokenFlight;
  }

  async function authed(path, init = {}) {
    const t = await getToken();
    const headers = Object.assign({
      Authorization: 'Bearer ' + t,
      'Content-Type': 'application/json',
      // Unique per request; PB uses it to de-duplicate retries.
      'X-PB-TransactionId': init.transactionId || crypto.randomBytes(12).toString('hex'),
    }, partnerId ? { 'X-PB-Developer-Partner-Id': partnerId } : {}, init.headers || {});
    return call(host + path, { method: init.method || 'GET', headers, body: init.body ? JSON.stringify(init.body) : undefined }, { read: Boolean(init.read) });
  }

  // The USPS carrier account the labels are bought under. Shipping 360
  // accounts come with one; we look it up once instead of asking the owner.
  let accountFlight = null;
  async function lookUpAccount() {
    try {
      const r = await authed('/shipping/api/v1/carrierAccounts', { read: true });
      const list = (r && r.data && r.data.carrierAccounts) || (r && r.carrierAccounts) || [];
      const usps = list.find((a) => /usps/i.test(String(a.carrierName || a.carrier || '')));
      if (usps) uspsAccount = usps.carrierAccountId;
    } catch (e) { /* fall back to carrier: 'USPS' without an account id */ }
    return uspsAccount;
  }
  async function carrierAccount() {
    if (uspsAccount) return uspsAccount;
    if (!accountFlight) accountFlight = lookUpAccount().finally(() => { accountFlight = null; });
    return accountFlight;
  }
  async function withAccount(shipment) {
    const id = await carrierAccount();
    if (!id || !shipment.byCarrier) return shipment;
    return Object.assign({}, shipment, { byCarrier: Object.assign({}, shipment.byCarrier, { carrierAccountId: id }) });
  }

  return {
    env,
    rate: async (shipment) => authed('/shipping/api/v2/rates', { method: 'POST', body: await withAccount(shipment), read: true }),
    createShipment: async (shipment, transactionId) => authed('/shipping/api/v2/shipments', { method: 'POST', body: await withAccount(shipment), transactionId }),
    // Cancelling an unused label is how postage gets refunded.
    cancelShipment: (shipmentId) => authed('/shipping/api/v2/shipments/cancel', { method: 'POST', body: { shipmentId } }),
    tracking: (trackingNumber, carrier = 'USPS') =>
      authed('/shippingtracking/api/v1/tracking/' + encodeURIComponent(trackingNumber) + '?carrier=' + encodeURIComponent(carrier), { read: true }),
  };
}

module.exports = { makePbClient, PbError, HOSTS };
