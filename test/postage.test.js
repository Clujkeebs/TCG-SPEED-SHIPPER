/* Postage pilot (Pitney Bowes). Pins: only the owner and pilot emails can
   use it; it stays in sandbox unless production is explicitly switched on;
   label requests send PB the right shipment (service, label size, USPS
   carrier account); one bad address doesn't sink a batch; every label lands in the
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
process.env.PB_PILOT_EMAILS = 'Pilot@Example.com, other@example.com';
process.env.PB_ACCESS = 'pilot';

const ledger = [];
const stripeCreated = [];
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
// Prepaid balance ledger (cents), keyed by user.
const money = [];
const bal = (u) => money.filter((m) => m.user_id === u).reduce((t, m) => t + m.cents, 0);
const supabaseStub = {
  from: (t) => builder(t),
  rpc: async (name, a) => {
    if (name === 'tcgss_postage_balance') return { data: bal(a.p_user), error: null };
    if (name === 'tcgss_postage_debit') {
      if (bal(a.p_user) < a.p_cents) return { data: { ok: false, balance: bal(a.p_user) }, error: null };
      money.push({ user_id: a.p_user, cents: -a.p_cents, kind: 'label', ref: a.p_ref });
      return { data: { ok: true, balance: bal(a.p_user) }, error: null };
    }
    if (name === 'tcgss_postage_credit') {
      if (money.some((m) => m.kind === a.p_kind && m.ref === a.p_ref && a.p_kind !== 'adjust')) return { data: { ok: true, duplicate: true, balance: bal(a.p_user) }, error: null };
      money.push({ user_id: a.p_user, cents: a.p_cents, kind: a.p_kind, ref: a.p_ref });
      return { data: { ok: true, balance: bal(a.p_user) }, error: null };
    }
    return { data: null, error: null };
  },
  auth: { getUser: async (t) => (users[t] ? { data: { user: users[t] }, error: null } : { data: { user: null }, error: new Error('bad') }) },
};

// Fake Pitney Bowes.
let shipSeq = 0;
global.fetch = async (url, init) => {
  pbCalls.push({ url, init });
  const json = (status, body) => ({ ok: status < 300, status, text: async () => JSON.stringify(body) });
  if (url.endsWith('/auth/api/v1/token')) return json(200, { access_token: 'tok', expires_in: 14400, token_type: 'Bearer' });
  if (url.endsWith('/shipping/api/v1/carrierAccounts')) return json(200, { data: { carrierAccounts: [{ carrierAccountId: 'acct_ups', carrierName: 'UPS' }, { carrierAccountId: 'acct_usps', carrierName: 'USPS' }] } });
  if (url.endsWith('/shipping/api/v2/rates')) return json(200, { rate: [{ serviceId: 'FCM', totalCarrierCharge: 0.78 }] });
  if (url.endsWith('/shipping/api/v2/shipments') && init.method === 'POST') {
    const b = JSON.parse(init.body);
    if (b.toAddress.postalCode === '00000') return json(400, { errors: [{ errorCode: '1001', message: 'Invalid address' }] });
    shipSeq++;
    return json(200, { shipmentId: 'USPS' + shipSeq, parcelTrackingNumber: '9400' + shipSeq, rate: { serviceId: b.byCarrier.service, totalCarrierCharge: b.byCarrier.service === 'UGA' ? 4.5 : 0.78 }, labelLayout: [{ contentType: 'BASE64', contents: 'JVBERi0x', fileFormat: 'PDF', size: b.labelSize, type: 'SHIPPING_LABEL' }] });
  }
  if (url.endsWith('/shipping/api/v2/shipments/cancel') && init.method === 'POST') return json(200, { status: 'INITIATED', totalCarrierCharge: 4.5 });
  if (url.includes('/shippingtracking/api/v1/tracking/')) return json(200, { currentStatus: { status: 'In Transit', eventDescription: 'In Transit' }, trackingHistory: [{ eventDate: '2026-10-04T10:00:00', eventDescription: 'Accepted', eventLocation: { city: 'Los Angeles', stateOrProvince: 'CA' } }] });
  return json(404, { message: 'no' });
};

const origLoad = Module._load;
Module._load = function (request) {
  if (request === 'stripe') return function StripeStub() { return { checkout: { sessions: { create: async (p) => { stripeCreated.push(p); return { url: 'https://checkout.stripe.test/s1' }; } } } }; };
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
    check('sandbox by default', pbConfig({ PB_API_KEY: 'k', PB_API_SECRET: 's' }).mode === 'sandbox');
    check('PB_ENV=production alone stays sandbox', pbConfig({ PB_ENV: 'production' }).mode === 'sandbox');
    check('production needs PB_LIVE_OK=yes too', pbConfig({ PB_ENV: 'production', PB_LIVE_OK: 'yes' }).mode === 'production');
    check('rollout defaults to owner-only', pbConfig({}).access === 'owner' && pbConfig({ PB_ACCESS: 'everyone' }).access === 'owner');
    process.env.PB_ACCESS = '';
    let r0 = await req('GET', '/api/postage/status', undefined, 'pilot-token');
    check('owner-only stage: a pilot email is NOT allowed, only told it\'s coming', r0.body.allowed === false && r0.body.comingSoon === true && !('services' in r0.body) && !('mode' in r0.body), JSON.stringify(r0.body));
    r0 = await req('POST', '/api/postage/labels', { from: FROM, labels: [{ to: TO, service: 'letter' }] }, 'pilot-token');
    check('owner-only stage: a pilot email cannot buy', r0.status === 403);
    r0 = await req('GET', '/api/postage/status', undefined, 'owner-token');
    check('owner-only stage: the owner is allowed', r0.body.allowed === true);
    process.env.PB_ACCESS = 'all';
    r0 = await req('GET', '/api/postage/status', undefined, 'stranger-token');
    check('all stage: any signed-in user is allowed', r0.body.allowed === true);
    process.env.PB_ACCESS = 'pilot';
    let r = await req('GET', '/api/postage/status');
    check('status needs sign-in', r.status === 401);
    r = await req('GET', '/api/postage/status', undefined, 'stranger-token');
    check('non-pilot user is not allowed', r.status === 200 && r.body.allowed === false && r.body.comingSoon === true);
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
    check('rate quote shows postage, our fee and the price', r.status === 200 && r.body.postage === 0.78 && r.body.fee === 0.21 && r.body.price === 0.99, JSON.stringify(r.body));
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
    check('total = postage + fees, purchased labels only', r.body.postage === 5.28 && r.body.fees === 0.71 && r.body.total === 5.99, JSON.stringify([r.body.postage, r.body.fees, r.body.total]));
    check('each label carries its price', res3[0].price === 0.99 && res3[2].price === 5);
    const ships = pbCalls.filter((c) => c.url.endsWith('/shipping/api/v2/shipments')).map((c) => JSON.parse(c.init.body));
    check('letter → USPS FCM LETTER on a 4x6 PDF label', ships[0].byCarrier.carrier === 'USPS' && ships[0].byCarrier.service === 'FCM' && ships[0].parcels[0].parcelType === 'LETTER' && ships[0].labelSize === 'DOC_4X6' && ships[0].labelFormat === 'PDF');
    check('ground → USPS Ground Advantage package', ships[2].byCarrier.service === 'UGA' && ships[2].parcels[0].parcelType === 'PKG');
    check('weight goes in ounces', ships[0].parcels[0].parcel.weight === 1 && ships[0].parcels[0].parcel.weightUnit === 'OZ');
    check('the USPS carrier account is looked up and sent', ships.every((x) => x.byCarrier.carrierAccountId === 'acct_usps'));
    check('the carrier account is looked up only once', pbCalls.filter((c) => c.url.endsWith('/carrierAccounts')).length <= 1);
    check('requests go to the Shipping 360 sandbox', pbCalls.every((c) => c.url.startsWith('https://api-sandbox.sendpro360.pitneybowes.com/')));
    check('each label call has a transaction id', pbCalls.filter((c) => c.url.endsWith('/shipping/api/v2/shipments')).every((c) => /^[0-9a-f]{24}$/.test(c.init.headers['X-PB-TransactionId'])));
    check('the token is fetched once and reused', pbCalls.filter((c) => c.url.endsWith('/auth/api/v1/token')).length === 0);
    const { buildShipment } = require(path.join(__dirname, '..', 'postage.js'));
    const bs = buildShipment({ from: pbAddress(Object.assign({}, FROM, { phone: '555-123-4567' })).address, to: pbAddress(TO).address, service: 'letter', weightOz: 1 });
    check('the sender phone stands in for the buyer\'s missing phone', bs.toAddress.phone === '555-123-4567');
    check('street lines map to addressLine1/2', bs.toAddress.addressLine1 === '456 Oak Ave' && bs.toAddress.addressLine2 === 'Apt 2');
    check('purchased labels are in the ledger with the buyer', ledger.length === 2 && ledger.every((x) => x.user_id === 'u_pilot' && x.mode === 'sandbox' && x.status === 'purchased'));
    check('the ledger records postage, fee and price separately', ledger[0].amount === 0.78 && ledger[0].fee === 0.21 && ledger[0].price === 0.99);
    const { feeFor } = require(path.join(__dirname, '..', 'postage.js'));
    check('fees can be changed with env vars', feeFor('ground', { PB_FEE_GROUND: '0.4' }) === 0.4 && feeFor('letter', { PB_FEE_LETTER: 'junk' }) === 0.21 && feeFor('letter', { PB_FEE_LETTER: '99' }) === 0.21);
    r = await req('POST', '/api/postage/labels', { from: FROM, labels: new Array(51).fill({ to: TO, service: 'letter' }) }, 'owner-token');
    check('more than 50 labels at once is refused', r.status === 400);

    console.log('\n-- Label history and reprint --');
    check('the label PDF is saved for reprints', ledger.every((x) => x.label_pdf === 'JVBERi0x'));
    r = await req('GET', '/api/postage/labels/' + res3[0].shipmentId + '/pdf', undefined, 'pilot-token');
    check('the buyer can reprint a label', r.status === 200 && r.body.labelPdfBase64 === 'JVBERi0x');
    r = await req('GET', '/api/postage/labels/' + res3[0].shipmentId + '/pdf', undefined, 'owner-token');
    check('nobody else can reprint it', r.status === 404);
    r = await req('GET', '/api/postage/labels', undefined, 'stranger-token');
    check('label history is pilot-only', r.status === 403);

    console.log('\n-- Refunds and tracking --');
    r = await req('POST', '/api/postage/labels/' + res3[0].shipmentId + '/refund', {}, 'pilot-token');
    check('letter postage can\'t be refunded (USPS rule)', r.status === 409 && /letter/i.test(r.body.error));
    const sid = res3[2].shipmentId;
    r = await req('POST', '/api/postage/labels/' + sid + '/refund', {}, 'owner-token');
    check('someone else cannot refund your label', r.status === 404);
    r = await req('POST', '/api/postage/labels/' + sid + '/refund', {}, 'pilot-token');
    check('the buyer can refund an unused label', r.status === 200 && ledger.find((x) => x.shipment_id === sid).status === 'refund_requested');
    r = await req('POST', '/api/postage/labels/' + sid + '/refund', {}, 'pilot-token');
    check('a label can only be refunded once', r.status === 409);
    r = await req('GET', '/api/postage/labels/' + sid + '/pdf', undefined, 'pilot-token');
    check('a refunded label can\'t be reprinted', r.status === 409);
    r = await req('GET', '/api/postage/track/94001', undefined, 'pilot-token');
    check('tracking returns status and scans', r.status === 200 && r.body.status === 'In Transit' && r.body.events[0].where === 'Los Angeles, CA');
    console.log('\n-- Prepaid balance --');
    const { handleTopupSession } = require(path.join(__dirname, '..', 'postage.js'));
    r = await req('POST', '/api/postage/topup', { amount: 50 }, 'pilot-token');
    check('no top-ups while labels are free test labels', r.status === 409);
    process.env.PB_BALANCE = 'on';
    r = await req('POST', '/api/postage/labels', { from: FROM, labels: [{ ref: 'B1', to: TO, service: 'letter' }] }, 'pilot-token');
    check('an empty balance blocks buying, before PB is called', r.status === 402);
    r = await req('POST', '/api/postage/topup', { amount: 10 }, 'pilot-token');
    check('top-ups under $20 are refused', r.status === 400);
    r = await req('POST', '/api/postage/topup', { amount: 2500 }, 'pilot-token');
    check('top-ups over $2,000 are refused', r.status === 400);
    r = await req('POST', '/api/postage/topup', { amount: 12.5 }, 'pilot-token');
    check('custom top-ups must be whole dollars', r.status === 400);
    r = await req('POST', '/api/postage/topup', { amount: 250 }, 'pilot-token');
    check('a custom $250 top-up is allowed', r.status === 200 && stripeCreated.pop().line_items[0].price_data.unit_amount === 25000);
    r = await req('POST', '/api/postage/topup', { amount: 50 }, 'pilot-token');
    const cs = stripeCreated[0] || {};
    check('top-up opens one Stripe payment for $50', r.status === 200 && /checkout/.test(r.body.url) && cs.mode === 'payment' && cs.line_items[0].price_data.unit_amount === 5000 && cs.metadata.kind === 'postage_topup' && cs.client_reference_id === 'u_pilot');
    const sess = { id: 'cs_1', amount_total: 600, payment_status: 'paid', client_reference_id: 'u_pilot', metadata: { kind: 'postage_topup', user_id: 'u_pilot' } };
    check('a paid top-up is credited', (await handleTopupSession(supabaseStub, sess)) === true && bal('u_pilot') === 600);
    await handleTopupSession(supabaseStub, sess);
    check('a repeated webhook credits only once', bal('u_pilot') === 600);
    await handleTopupSession(supabaseStub, Object.assign({}, sess, { id: 'cs_2', payment_status: 'unpaid' }));
    check('an unsettled bank payment is not credited yet', bal('u_pilot') === 600);
    check('a subscription checkout is not treated as a top-up', (await handleTopupSession(supabaseStub, { id: 'cs_sub', metadata: {} })) === false);
    pbCalls.length = 0;
    r = await req('POST', '/api/postage/labels', { from: FROM, labels: [
      { ref: 'C1', to: TO, service: 'ground', weightOz: 3 },
      { ref: 'C2', to: TO, service: 'letter' },
      { ref: 'C3', to: TO, service: 'letter' },
    ] }, 'pilot-token');
    const rb = r.body.results || [];
    check('labels draw down the balance with no checkout', rb[0].ok && rb[1].ok && r.body.balanceCents === 600 - 500 - 99, JSON.stringify(r.body));
    check('when the balance runs out, the next label is quoted and never bought', !rb[2].ok && /balance/.test(rb[2].error) && pbCalls.filter((c) => c.url.endsWith('/shipping/api/v2/shipments')).length === 2);
    check('balance never goes negative', bal('u_pilot') >= 0);
    r = await req('POST', '/api/postage/labels/' + rb[0].shipmentId + '/refund', {}, 'pilot-token');
    check('a refund puts the label price back', r.status === 200 && bal('u_pilot') === 600 - 99, String(bal('u_pilot')));
    r = await req('GET', '/api/postage/balance', undefined, 'stranger-token');
    check('balance is pilot-only', r.status === 403);
    delete process.env.PB_BALANCE;

    r = await req('GET', '/api/health');
    check('health shows PB keys present without values', r.body.config.pb_keys === true && r.body.config.pb_mode === 'sandbox' && !JSON.stringify(r.body).includes('pbsecret'));
  } catch (e) { failed++; console.log('  FAIL  threw: ' + e.stack); }
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  server.close(); process.exit(failed ? 1 : 0);
});
