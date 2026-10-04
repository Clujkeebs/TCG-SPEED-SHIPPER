/* Pitney Bowes Shipping API client (https://docs.shippingapi.pitneybowes.com).
   Small on purpose: OAuth token (cached for half its life), rates, create a
   label, cancel (refund) a label, and tracking. No SDK dependency; uses the
   built-in fetch. `fetchImpl` is injectable so tests never touch the network.

   Sandbox labels are free test labels; production labels are real postage
   charged to the Pitney Bowes account behind PB_API_KEY. */
const crypto = require('crypto');

const HOSTS = {
  sandbox: 'https://shipping-api-sandbox.pitneybowes.com',
  production: 'https://shipping-api.pitneybowes.com',
};

class PbError extends Error {
  constructor(status, body) {
    const first = Array.isArray(body) ? body[0] : (body && body.errors && body.errors[0]) || body;
    const msg = (first && (first.errorDescription || first.message || first.error_description)) || ('Pitney Bowes error ' + status);
    super(msg);
    this.status = status;
    this.body = body;
  }
}

function makePbClient({ key, secret, env = 'sandbox', fetchImpl = fetch, now = Date.now }) {
  const host = HOSTS[env] || HOSTS.sandbox;
  const base = host + '/shippingservices';
  let token = null; // { value, expiresAt }

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
    const body = await call(host + '/oauth/token', {
      method: 'POST',
      headers: {
        Authorization: 'Basic ' + Buffer.from(key + ':' + secret).toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
    });
    // Refresh at half-life so a token never expires mid-batch.
    token = { value: body.access_token, expiresAt: now() + (Number(body.expiresIn) || 3600) * 500 };
    return token.value;
  }

  async function authed(path, init = {}) {
    const t = await getToken();
    const headers = Object.assign({
      Authorization: 'Bearer ' + t,
      'Content-Type': 'application/json',
      // Unique per request, max 25 chars; PB uses it to de-duplicate retries.
      'X-PB-TransactionId': init.transactionId || crypto.randomBytes(12).toString('hex'),
    }, init.headers || {});
    return call(base + path, { method: init.method || 'GET', headers, body: init.body ? JSON.stringify(init.body) : undefined });
  }

  return {
    env,
    rate: (shipment) => authed('/v1/rates', { method: 'POST', body: shipment }),
    createShipment: (shipment, transactionId) => authed('/v1/shipments', { method: 'POST', body: shipment, transactionId }),
    // Cancelling an unused label is how postage gets refunded.
    cancelShipment: (shipmentId, carrier = 'USPS') =>
      authed('/v1/shipments/' + encodeURIComponent(shipmentId), { method: 'DELETE', body: { carrier, cancelInitiator: 'SHIPPER' } }),
    tracking: (trackingNumber, carrier = 'USPS') =>
      authed('/v1/tracking/' + encodeURIComponent(trackingNumber) + '?packageIdentifierType=TrackingNumber&carrier=' + encodeURIComponent(carrier)),
  };
}

module.exports = { makePbClient, PbError, HOSTS };
