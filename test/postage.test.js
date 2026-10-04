/* Postage pilot (Pitney Bowes). Pins: only the owner and pilot emails can
   use it; it stays in sandbox unless production is explicitly switched on;
   label requests send PB the right shipment (service, label size, shipper
   id); one bad address doesn't sink a batch; every label lands in the
   ledger; and a user can only refund their own unused labels. PB and
   Supabase are stubbed, nothing touches the network. */
const Module = require('module');
const path = require('path');

process.env.STRIPE_SECRET_KEY = 'sk_test_stub';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_stub';
process.env.STRIPE_PRICE_BASE = 'price_base';
process.env.STRIPE_PRICE_PREMIUM = 'price_premium';
process.env.SUPABASE_URL = 'https://stub.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'stub-key';
process.env.PB_API_KEY = 'pbkey';
process.env.PB_API_SECRET = 'pbsecret';
process.env.PB_SHIPPER_ID = '9015544760';
process.env.PB_PILOT_EMAILS = 'Pilot@Example.com, other@example.com';

const ledger = [];
const pbCalls = [];
function builder(table) {
  const q = { filters: {}, op: 'select', payload: null };
  ['select', 'eq', 'order', 'limit'].forEach((m) => { q[m] = (k, v) => { if (m === 'eq') q.filters[k] = v; return q; }; });
  q.insert = async (p) => { if (table === 'tcgss_postage_labels') ledger.push(Object.assign({}, p)); return { error: null }; };
  q.update = (p) => { q.op = 'update'; q.payload = p; return q; };
  q.maybeSingle = async () => ({ data: ledger.find((r) => r.shipment_id === q.filters.shipment_id) || null, error: null });
  q.then = (resolve) => {
    if (q.op === 'update') ledger.filter((r) => r.shipment_id === q.filters.shipment_id).forEach((r) => Object.assign(r, q.payload));
    return Promise.resolve({ data: null, error: null }).then(resolve);
  };
  return q;
}
const users = { 'owner-token': { id: 'u_owner', email: 'clujkeebs@aol.com' }, 'pilot-token': { id: 'u_pilot', email: 'pilot@example.com' }, 'stranger-token': { id: 'u_x', email: 'x@example.com' } };
const supabaseStub = {
  from: (t) => builder(t),
  rpc: async () => ({ data: null, error: null }),
  auth: { getUser: async (t) => (users[t] ? { data: { user: users[t] }, error: null } : { data: { user: null }, error: new Error('bad') }) },
};

// Fake Pitney Bowes.
let shipSeq = 0;
global.fetch = async (url, init) => {
  pbCalls.push({ url, init });
  const json = (status, body) => ({ ok: status < 300, status, text: async () => JSON.stringify(body) });
  if (url.endsWith('/oauth/token')) return json(200, { access_token: 'tok', expiresIn: 28800 });
  if (url.endsWith('/v1/rates')) return json(200, { rates: [{ totalCarrierCharge: 0.78 }] });
  if (url.endsWith('/v1/shipments') && init.method === 'POST') {
    const b = JSON.parse(init.body);
    if (b.toAddress.postalCode === '00000') return json(400, [{ errorCode: '1001', errorDescription: 'Invalid address' }]);
    shipSeq++;
    return json(201, { shipmentId: 'USPS' + shipSeq, parcelTrackingNumber: '9400' + shipSeq, rates: [{ totalCarrierCharge: b.rates[0].serviceId === 'GA' ? 4.5 : 0.78 }], documents: [{ pages: [{ contents: 'JVBERi0x' }] }] });
  }
  if (/\/v1\/shipments\/[^/?]+$/.test(url) && init.method === 'DELETE') return json(200, { status: 'INITIATED' });
  if (url.includes('/v1/tracking/')) return json(200, { status: 'In Transit', scanDetailsList: [{ eventDate: '2026-10-04', eventTime: '10:00', scanDescription: 'Accepted', eventCity: 'Los Angeles', eventStateOrProvince: 'CA' }] });
  return json(404, { message: 'no' });
};

const origLoad = Module._load;
Module._load = function (request) {
  if (request === 'stripe') return function StripeStub() { return {}; };
  if (request === '@supabase/supabase-js') return { createClient: () => supabaseStub };
  return origLoad.apply(this, arguments);
};
const app = require(path.join(__dirname, '..', 'server.js'));
Module._load = origLoad;
const { pbConfig, pbAddress } = require(path.join(__dirname, '..', 'postage.js'));

const http = require('http');
const server = http.createServer(app);
function req(method, urlPath, body, token) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
    const r = http.request({ host: '127.0.0.1', port: server.address().port, method, path: urlPath,
      headers: Object.assign({ 'Content-Type': 'application/json', 'Content-Length': payload ? payload.length : 0 }, token ? { Authorization: 'Bearer ' + token } : {}) }, (res) => {
      let d = ''; res.on('data', (c) => { d += c; });
      res.on('end', () => { let j; try { j = JSON.parse(d); } catch (e) { j = d; } resolve({ status: res.statusCode, body: j }); });
    });
    r.on('error', reject); if (payload) r.write(payload); r.end();
  });
}
let passed = 0, failed = 0;
function check(name, cond, extra) { if (cond) { passed++; console.log('  PASS  ' + name); } else { failed++; console.log('  FAIL  ' + name + (extra ? '  — ' + extra : '')); } }

const FROM = { name: 'Card Shop Co', addr1: '123 Seller St', city: 'Springfield', state: 'IL', zip: '62701' };
const TO = { firstName: 'Jane', lastName: 'Doe', addr1: '456 Oak Ave', addr2: 'Apt 2', city: 'Chicago', state: 'IL', zip: '60601' };

server.listen(0, async () => {
  try {
    console.log('\n-- Mode and access --');
    check('sandbox by default', pbConfig({ PB_API_KEY: 'k', PB_API_SECRET: 's', PB_SHIPPER_ID: '1' }).mode === 'sandbox');
    check('PB_ENV=production alone stays sandbox', pbConfig({ PB_ENV: 'production' }).mode === 'sandbox');
    check('production needs PB_LIVE_OK=yes too', pbConfig({ PB_ENV: 'production', PB_LIVE_OK: 'yes' }).mode === 'production');
    let r = await req('GET', '/api/postage/status');
    check('status needs sign-in', r.status === 401);
    r = await req('GET', '/api/postage/status', undefined, 'stranger-token');
    check('non-pilot user is not allowed', r.status === 200 && r.body.allowed === false && r.body.mode === 'sandbox');
    r = await req('GET', '/api/postage/status', undefined, 'pilot-token');
    check('pilot email (case-insensitive) is allowed', r.body.allowed === true && r.body.configured === true);
    const before = pbCalls.length;
    r = await req('POST', '/api/postage/labels', { from: FROM, labels: [{ to: TO, service: 'letter' }] }, 'stranger-token');
    check('non-pilot cannot buy labels, and PB is never called', r.status === 403 && pbCalls.length === before);

    console.log('\n-- Addresses --');
    check('a complete address passes', pbAddress(TO).missing.length === 0 && pbAddress(TO).address.name === 'Jane Doe');
    check('a bad ZIP is caught', pbAddress(Object.assign({}, TO, { zip: '123' })).missing.includes('ZIP'));
    check('international is refused for now', pbAddress(Object.assign({}, TO, { country: 'CA' })).missing.length === 1);

    console.log('\n-- Rates and labels --');
    r = await req('POST', '/api/postage/rates', { from: FROM, to: TO, service: 'letter', weightOz: 1 }, 'owner-token');
    check('rate quote comes back', r.status === 200 && r.body.amount === 0.78, JSON.stringify(r.body));
    r = await req('POST', '/api/postage/rates', { from: FROM, to: TO, service: 'letter', weightOz: 5 }, 'owner-token');
    check('letters over 3.5 oz are refused', r.status === 400);
    pbCalls.length = 0;
    r = await req('POST', '/api/postage/labels', { from: FROM, labels: [
      { ref: 'A1', to: TO, service: 'letter', weightOz: 1 },
      { ref: 'A2', to: Object.assign({}, TO, { zip: '00000' }), service: 'ground', weightOz: 3 },
      { ref: 'A3', to: TO, service: 'ground', weightOz: 3 },
    ] }, 'pilot-token');
    const res3 = r.body.results || [];
    check('a batch returns one result per label, in order', r.status === 200 && res3.map((x) => x.ref).join() === 'A1,A2,A3', JSON.stringify(r.body));
    check('a bad address fails alone; the others still print', res3[0].ok && !res3[1].ok && res3[2].ok && /Invalid address/.test(res3[1].error));
    check('labels come back with tracking and a PDF', res3[0].trackingNumber && res3[0].labelPdfBase64 === 'JVBERi0x');
    check('total adds up the purchased labels only', r.body.total === 5.28, r.body.total);
    const ships = pbCalls.filter((c) => c.url.endsWith('/v1/shipments')).map((c) => JSON.parse(c.init.body));
    check('letter → USPS FCM LETTER on a 6x4 label', ships[0].rates[0].serviceId === 'FCM' && ships[0].rates[0].parcelType === 'LETTER' && ships[0].documents[0].size === 'DOC_6X4');
    check('ground → USPS GA package on a 4x6 label', ships[2].rates[0].serviceId === 'GA' && ships[2].documents[0].size === 'DOC_4X6');
    check('shipper id is sent', ships[0].shipmentOptions.some((o) => o.name === 'SHIPPER_ID' && o.value === '9015544760'));
    check('requests go to the sandbox', pbCalls.every((c) => c.url.startsWith('https://shipping-api-sandbox.pitneybowes.com/')));
    check('each label call has a transaction id', pbCalls.filter((c) => c.url.endsWith('/v1/shipments')).every((c) => /^[0-9a-f]{24}$/.test(c.init.headers['X-PB-TransactionId'])));
    check('the token is fetched once and reused', pbCalls.filter((c) => c.url.endsWith('/oauth/token')).length === 0);
    check('purchased labels are in the ledger with the buyer', ledger.length === 2 && ledger.every((x) => x.user_id === 'u_pilot' && x.mode === 'sandbox' && x.status === 'purchased'));
    r = await req('POST', '/api/postage/labels', { from: FROM, labels: new Array(51).fill({ to: TO, service: 'letter' }) }, 'owner-token');
    check('more than 50 labels at once is refused', r.status === 400);

    console.log('\n-- Refunds and tracking --');
    const sid = res3[0].shipmentId;
    r = await req('POST', '/api/postage/labels/' + sid + '/refund', {}, 'owner-token');
    check('someone else cannot refund your label', r.status === 404);
    r = await req('POST', '/api/postage/labels/' + sid + '/refund', {}, 'pilot-token');
    check('the buyer can refund an unused label', r.status === 200 && ledger.find((x) => x.shipment_id === sid).status === 'refund_requested');
    r = await req('POST', '/api/postage/labels/' + sid + '/refund', {}, 'pilot-token');
    check('a label can only be refunded once', r.status === 409);
    r = await req('GET', '/api/postage/track/94001', undefined, 'pilot-token');
    check('tracking returns status and scans', r.status === 200 && r.body.status === 'In Transit' && r.body.events[0].where === 'Los Angeles, CA');
    r = await req('GET', '/api/health');
    check('health shows PB keys present without values', r.body.config.pb_keys === true && r.body.config.pb_mode === 'sandbox' && !JSON.stringify(r.body).includes('pbsecret'));
  } catch (e) { failed++; console.log('  FAIL  threw: ' + e.stack); }
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  server.close(); process.exit(failed ? 1 : 0);
});
