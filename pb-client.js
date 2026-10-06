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

function makePbClient({ key, secret, env = 'sandbox', partnerId, carrierAccountId, fetchImpl = fetch, now = Date.now }) {
  const host = HOSTS[env] || HOSTS.sandbox;
  let token = null; // { value, expiresAt }
  let uspsAccount = carrierAccountId || null; // looked up once if not given

  async function call(url, init) {
    const res = await fetchImpl(url, Object.assign({ signal: AbortSignal.timeout(30000) }, init));
    const text = await res.text();
    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch (e) { body = text; }
    if (!res.ok) throw new PbError(res.status, body);
    return body;
  }

  async function getToken() {
    if (token && token.expiresAt > now()) return token.value;
    const body = await call(host + '/auth/api/v1/token', {
      method: 'POST',
      headers: {
        Authorization: 'Basic ' + Buffer.from(key + ':' + secret).toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials&scope=psapi',
    });
    // Refresh at half-life so a token never expires mid-batch.
    const ttl = Number(body && (body.expires_in || body.expiresIn)) || 14400;
    token = { value: body.access_token, expiresAt: now() + ttl * 500 };
    return token.value;
  }

  async function authed(path, init = {}) {
    const t = await getToken();
    const headers = Object.assign({
      Authorization: 'Bearer ' + t,
      'Content-Type': 'application/json',
      // Unique per request; PB uses it to de-duplicate retries.
      'X-PB-TransactionId': init.transactionId || crypto.randomBytes(12).toString('hex'),
    }, partnerId ? { 'X-PB-Developer-Partner-Id': partnerId } : {}, init.headers || {});
    return call(host + path, { method: init.method || 'GET', headers, body: init.body ? JSON.stringify(init.body) : undefined });
  }

  // The USPS carrier account the labels are bought under. Shipping 360
  // accounts come with one; we look it up once instead of asking the owner.
  async function carrierAccount() {
    if (uspsAccount) return uspsAccount;
    try {
      const r = await authed('/shipping/api/v1/carrierAccounts');
      const list = (r && r.data && r.data.carrierAccounts) || (r && r.carrierAccounts) || [];
      const usps = list.find((a) => /usps/i.test(String(a.carrierName || a.carrier || '')));
      if (usps) uspsAccount = usps.carrierAccountId;
    } catch (e) { /* fall back to carrier: 'USPS' without an account id */ }
    return uspsAccount;
  }
  async function withAccount(shipment) {
    const id = await carrierAccount();
    if (!id || !shipment.byCarrier) return shipment;
    return Object.assign({}, shipment, { byCarrier: Object.assign({}, shipment.byCarrier, { carrierAccountId: id }) });
  }

  return {
    env,
    rate: async (shipment) => authed('/shipping/api/v2/rates', { method: 'POST', body: await withAccount(shipment) }),
    createShipment: async (shipment, transactionId) => authed('/shipping/api/v2/shipments', { method: 'POST', body: await withAccount(shipment), transactionId }),
    // Cancelling an unused label is how postage gets refunded.
    cancelShipment: (shipmentId) => authed('/shipping/api/v2/shipments/cancel', { method: 'POST', body: { shipmentId } }),
    tracking: (trackingNumber, carrier = 'USPS') =>
      authed('/shippingtracking/api/v1/tracking/' + encodeURIComponent(trackingNumber) + '?carrier=' + encodeURIComponent(carrier)),
  };
}

module.exports = { makePbClient, PbError, HOSTS };
