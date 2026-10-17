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
process.env.PB_RETRY_BASE_MS = '1'; // retries pause 1 ms in tests, not 400
process.env.PB_API_KEY = 'pbkey';
process.env.PB_API_SECRET = 'pbsecret';
process.env.PB_PILOT_EMAILS = 'Pilot@Example.com, other@example.com';
process.env.PB_ACCESS = 'pilot';

const ledger = [];
// Plans decide the letter fee: the owner is lifetime-free (Premium rates), the pilot seller is on Base.
const profiles = { u_owner: { plan: 'free', is_lifetime_free: true, free_until: null }, u_pilot: { plan: 'base', is_lifetime_free: false, free_until: null } };
const stripeCreated = [];
const pbCalls = [];
function builder(table) {
  const q = { filters: {}, op: 'select', payload: null };
  ['select', 'eq', 'order', 'limit'].forEach((m) => { q[m] = (k, v) => { if (m === 'eq') q.filters[k] = v; return q; }; });
  q.insert = async (p) => { if (table === 'tcgss_postage_labels') ledger.push(Object.assign({}, p)); return { error: null }; };
  q.update = (p) => { q.op = 'update'; q.payload = p; return q; };
  q.maybeSingle = async () => (table === 'tcgss_profiles'
    ? { data: profiles[q.filters.id] || null, error: null }
    : { data: ledger.find((r) => r.shipment_id === q.filters.shipment_id) || null, error: null });
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
let rates429 = 0; // how many price requests answer 429 Too Many Requests before succeeding
const LABEL_HOST = 'prv-labels-cls.gcs.pitneycloud.com'; // where Pitney Bowes keeps label files (the docs' example link)
const LABEL_PDF = Buffer.from('%PDF-1.4 test label');
const LABEL_B64 = LABEL_PDF.toString('base64');
let labelAs = 'URL'; // what a purchase answer holds: 'URL' (a link, like the real one), 'URL_HTTP' (an insecure link), 'URL_MISSING' (a link to nothing), 'URL_LOGIN' (a link that wants the token), 'URL_FOREIGN' (a link to another host), 'URL_FOREIGN_LOGIN' (another host that wants a login), 'URL_SLOW' (not there on the first try) or 'NONE' (no file at all)
const labelDownloads = []; // every label link the server tried to fetch: { url, auth }
let ratesEmpty = false; // price requests answer 200 with nothing usable in them (a missing price must never read as $0.00)
let slowTries = 0; // 'URL_SLOW' links: how many tries so far
global.fetch = async (url, init) => {
  if (/^https?:\/\/(prv-labels-cls\.gcs\.pitneycloud\.com|labels\.example\.test)\//.test(url)) { // the link a purchase answer holds instead of the file
    const auth = Boolean(init && init.headers && init.headers.Authorization);
    labelDownloads.push({ url, auth });
    const file = (status, ok) => ({ ok, status, headers: { get: () => null }, arrayBuffer: async () => (ok ? LABEL_PDF.buffer.slice(LABEL_PDF.byteOffset, LABEL_PDF.byteOffset + LABEL_PDF.length) : new ArrayBuffer(0)) });
    if (/missing/.test(url)) return file(404, false);
    if (/slow/.test(url) && (slowTries += 1) < 2) return file(404, false);
    if (/login/.test(url) && !auth) return file(403, false);
    return file(200, true);
  }
  pbCalls.push({ url, init });
  const json = (status, body) => ({ ok: status < 300, status, text: async () => JSON.stringify(body) });
  if (url.endsWith('/auth/api/v1/token')) return json(200, { access_token: 'tok', expires_in: 14400, token_type: 'Bearer' });
  // Like the real gateway: Node's fetch sends "Accept-Language: *" when none is set, and Pitney Bowes refuses it.
  const lang = String((init.headers && init.headers['Accept-Language']) || '*');
  if (!/^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(lang)) return json(400, { errors: [{ errorCode: '1000', message: 'Invalid value for Accept-Language in http header, ex: en-US.' }] });
  if (url.endsWith('/shipping/api/v1/carrierAccounts')) return json(200, { data: { carrierAccounts: [{ carrierAccountId: 'acct_ups', carrierName: 'UPS' }, { carrierAccountId: 'acct_usps', carrierName: 'USPS' }] } });
  if (url.endsWith('/shipping/api/v2/rates')) {
    if (rates429 > 0) { rates429 -= 1; return json(429, { message: 'Too Many Requests' }); }
    if (ratesEmpty) return json(200, { rates: [{ rate: {} }], fromAddress: {}, toAddress: {} });
    return json(200, { rates: [{ rate: { serviceId: 'FCM', baseCharge: 0.78, totalCarrierCharge: 0.78 } }] }); // the live sandbox's shape
  }
  if (url.endsWith('/shipping/api/v2/shipments') && init.method === 'POST') {
    const b = JSON.parse(init.body);
    if (b.byCarrier.service === 'FCM' && !/^DOC_(6X4|9X4)$/.test(String(b.labelSize))) return json(400, { errors: [{ errorCode: '1001', message: 'Invalid label paper size.' }] }); // IMb letters only
    if (b.toAddress.postalCode === '00000') return json(400, { errors: [{ errorCode: '1001', message: 'Invalid address' }] });
    // Like the real gateway (Oct 17 sandbox rehearsal): a PDF label can only be a link; BASE64 is for ZPL2, PNG and GIF.
    if (b.contentType === 'BASE64' && b.labelFormat === 'PDF') return json(400, { errors: [{ errorCode: '1002', message: 'Invalid label file output format.' }] });
    shipSeq++;
    const link = (host, scheme, name) => ({ contentType: 'URL', contents: (scheme || 'https') + '://' + (host || LABEL_HOST) + '/usps/910187923/outbound/label/' + name + shipSeq + '.pdf' });
    const doc = labelAs === 'URL_HTTP' ? link(null, 'http', 'l')
      : labelAs === 'NONE' ? null
      : labelAs === 'URL_FOREIGN' ? link('labels.example.test', null, 'l')
      : labelAs === 'URL_FOREIGN_LOGIN' ? link('labels.example.test', null, 'login')
      : link(null, null, labelAs === 'URL_MISSING' ? 'missing' : labelAs === 'URL_LOGIN' ? 'login' : labelAs === 'URL_SLOW' ? 'slow' : 'l');
    return json(200, { shipmentId: 'USPS' + shipSeq, parcelTrackingNumber: '9400' + shipSeq, rate: { serviceId: b.byCarrier.service, totalCarrierCharge: b.byCarrier.service === 'UGA' ? 4.5 : 0.78 }, labelLayout: doc ? [Object.assign({ fileFormat: 'PDF', size: b.labelSize, type: 'SHIPPING_LABEL' }, doc)] : [] });
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

const FROM = { name: 'Card Shop Co', addr1: '123 Seller St', city: 'Springfield', state: 'IL', zip: '62701', phone: '(555) 123-4567' };
const FROM_NO_PHONE = Object.assign({}, FROM, { phone: '' });
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
    let np = pbCalls.length;
    r = await req('POST', '/api/postage/labels', { from: FROM_NO_PHONE, labels: [{ to: TO, service: 'letter' }] }, 'pilot-token');
    check('no sender phone: one clear error up front, PB never called', r.status === 400 && r.body.field === 'phone' && /phone/i.test(r.body.error) && pbCalls.length === np, JSON.stringify(r.body));
    r = await req('POST', '/api/postage/quote', { from: FROM, labels: [{ ref: 'Q1', to: TO, service: 'letter', weightOz: 1 }, { ref: 'Q2', to: TO, service: 'ground', weightOz: 3 }] }, 'pilot-token');
    check('quote prices the whole batch and buys nothing', r.status === 200 && r.body.items.length === 2 && r.body.items.every((x) => x.ok && x.price > 0) && Math.abs(r.body.total - (r.body.items[0].price + r.body.items[1].price)) < 0.001 && !pbCalls.slice(np).some((c) => /\/shipments(\?|$)/.test(String(c.url))) && pbCalls.slice(np).some((c) => /\/rates/.test(String(c.url))), JSON.stringify(r.body));
    // Pitney Bowes rate limit: retried quietly, then said kindly; repeated quotes come from memory.
    const TO2 = Object.assign({}, TO, { addr1: '789 Pine Rd', zip: '60602' });
    const TO3 = Object.assign({}, TO, { addr1: '12 Elm Ct', zip: '60603' });
    const rateCalls = () => pbCalls.filter((c) => c.url.endsWith('/shipping/api/v2/rates')).length;
    rates429 = 2;
    r = await req('POST', '/api/postage/quote', { from: FROM, labels: [{ ref: 'R1', to: TO2, service: 'letter', weightOz: 1 }] }, 'pilot-token');
    check('PB says Too Many Requests twice: the quote still comes back (retried inside)', r.status === 200 && r.body.items[0].ok === true && rates429 === 0, JSON.stringify(r.body));
    rates429 = 1000;
    r = await req('POST', '/api/postage/quote', { from: FROM, labels: [{ ref: 'R2', to: TO3, service: 'letter', weightOz: 1 }] }, 'pilot-token');
    check('PB keeps saying Too Many Requests: plain words for the seller, not the raw error', r.status === 200 && r.body.items[0].ok === false && /busy/i.test(r.body.items[0].error) && !/Too Many Requests/.test(r.body.items[0].error), JSON.stringify(r.body));
    rates429 = 0;
    ratesEmpty = true;
    r = await req('POST', '/api/postage/quote', { from: FROM, labels: [{ ref: 'E1', to: Object.assign({}, TO, { addr1: '1 Empty Way', zip: '60604' }), service: 'letter', weightOz: 1 }] }, 'pilot-token');
    check('an answer with no price in it is "No price came back", never $0.00 postage', r.status === 200 && r.body.items[0].ok === false && /no price/i.test(r.body.items[0].error) && r.body.total === 0, JSON.stringify(r.body));
    r = await req('POST', '/api/postage/rates', { from: FROM, to: Object.assign({}, TO, { addr1: '2 Empty Way', zip: '60605' }), service: 'letter', weightOz: 1 }, 'owner-token');
    check('the single-rate route does not turn a missing price into a free label either', r.status === 200 && r.body.postage == null && r.body.price == null, JSON.stringify(r.body));
    ratesEmpty = false;
    const callsBefore = rateCalls();
    r = await req('POST', '/api/postage/quote', { from: FROM, labels: [{ ref: 'R3', to: TO2, service: 'letter', weightOz: 1 }] }, 'pilot-token');
    check('the same quote asked again comes from memory (no new call to PB)', r.status === 200 && r.body.items[0].ok === true && rateCalls() === callsBefore, 'calls ' + (rateCalls() - callsBefore));
    r = await req('POST', '/api/postage/rates', { from: FROM, to: TO, service: 'letter', weightOz: 1 }, 'owner-token');
    check('rate quote shows postage, our fee and the price (Premium-rate owner: 12 cents)', r.status === 200 && r.body.postage === 0.78 && r.body.fee === 0.12 && r.body.price === 0.9, JSON.stringify(r.body));
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
    check('labels come back with tracking and the PDF (fetched from the link Pitney Bowes answers with)', res3[0].trackingNumber && res3[0].labelPdfBase64 === LABEL_B64);
    check('total = postage + fees, purchased labels only', r.body.postage === 5.28 && r.body.fees === 0.65 && r.body.total === 5.93, JSON.stringify([r.body.postage, r.body.fees, r.body.total]));
    check('each label carries its price (Base: 15 cent letter fee, 50 cent package fee)', res3[0].price === 0.93 && res3[0].fee === 0.15 && res3[2].price === 5 && res3[2].fee === 0.5);
    const ships = pbCalls.filter((c) => c.url.endsWith('/shipping/api/v2/shipments')).map((c) => JSON.parse(c.init.body));
    check('letter → USPS FCM LETTER on a 6x4 PDF label (Pitney Bowes: IMb letters use DOC_6X4 or DOC_9X4, DOC_4X6 is refused)', ships[0].byCarrier.carrier === 'USPS' && ships[0].byCarrier.service === 'FCM' && ships[0].parcels[0].parcelType === 'LETTER' && ships[0].labelSize === 'DOC_6X4' && ships[0].labelFormat === 'PDF' && !ships[0].specialServices);
    check('no purchase asks for BASE64 with a PDF (Pitney Bowes refuses it: "Invalid label file output format"); the PDF comes as a link', ships.every((x) => x.contentType !== 'BASE64' && x.labelFormat === 'PDF'));
    check('ground → USPS Ground Advantage package on a 4x6 label', ships[2].byCarrier.service === 'UGA' && ships[2].parcels[0].parcelType === 'PKG' && ships[2].labelSize === 'DOC_4X6');
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
    check('the ledger records postage, fee and price separately', ledger[0].amount === 0.78 && ledger[0].fee === 0.15 && ledger[0].price === 0.93);
    const { feeFor } = require(path.join(__dirname, '..', 'postage.js'));
    check('fees can be changed with env vars', feeFor('ground', { PB_FEE_GROUND: '0.4' }) === 0.4 && feeFor('letter', { PB_FEE_LETTER: 'junk' }) === 0.15 && feeFor('letter', { PB_FEE_LETTER: '99' }) === 0.15);
    const { effectivePlan } = require(path.join(__dirname, '..', 'postage.js'));
    check('letter fee by plan: Free and Base 15c, Premium 12c, Pro 10c', ['free', 'base', 'premium', 'pro'].map((pl) => feeFor('letter', {}, pl)).join() === '0.15,0.15,0.12,0.1');
    check('an unknown plan or none pays the Free/Base letter fee', feeFor('letter', {}, 'mystery') === 0.15 && feeFor('letter', {}) === 0.15);
    check('package fee does not depend on the plan yet', ['free', 'base', 'premium', 'pro'].every((pl) => feeFor('ground', {}, pl) === 0.5));
    check('an env override wins for every plan', ['free', 'premium', 'pro'].every((pl) => feeFor('letter', { PB_FEE_LETTER: '0.2' }, pl) === 0.2));
    const now = Date.parse('2026-10-14T12:00:00Z');
    check('effective plan: lifetime-free and a live free_until window count as Premium', effectivePlan({ plan: 'free', is_lifetime_free: true }, now) === 'premium' && effectivePlan({ plan: 'free', free_until: '2026-10-20T00:00:00Z' }, now) === 'premium');
    check('effective plan: an expired window falls back to the paid plan; no profile is Free', effectivePlan({ plan: 'base', free_until: '2026-10-01T00:00:00Z' }, now) === 'base' && effectivePlan(null, now) === 'free' && effectivePlan({ plan: 'weird' }, now) === 'free');
    r = await req('GET', '/api/postage/status', undefined, 'pilot-token');
    const feesFor = (rr) => Object.fromEntries((rr.body.services || []).map((x) => [x.id, x.fee]));
    check('the postage panel shows the fees for the seller\'s own plan', r.status === 200 && feesFor(r).letter === 0.15 && feesFor(r).ground === 0.5, JSON.stringify(r.body));
    r = await req('GET', '/api/postage/status', undefined, 'owner-token');
    check('the owner (Premium rates) sees 12 cents on letters', r.status === 200 && feesFor(r).letter === 0.12, JSON.stringify(r.body));
    r = await req('POST', '/api/postage/labels', { from: FROM, labels: new Array(51).fill({ to: TO, service: 'letter' }) }, 'owner-token');
    check('more than 50 labels at once is refused', r.status === 400);

    console.log('\n-- Label history and reprint --');
    check('the label PDF is saved for reprints', ledger.every((x) => x.label_pdf === LABEL_B64));
    r = await req('GET', '/api/postage/labels/' + res3[0].shipmentId + '/pdf', undefined, 'pilot-token');
    check('the buyer can reprint a label', r.status === 200 && r.body.labelPdfBase64 === LABEL_B64);

    console.log('\n-- the label is a link to the PDF (live sandbox, Oct 17); what happens when the link misbehaves --');
    const cancels = () => pbCalls.filter((c) => c.url.endsWith('/shipping/api/v2/shipments/cancel')).length;
    const buy = (ref, service, token) => req('POST', '/api/postage/labels', { from: FROM, labels: [{ ref, to: TO, service, weightOz: service === 'ground' ? 3 : 1 }] }, token || 'pilot-token');
    labelAs = 'URL'; labelDownloads.length = 0;
    r = await buy('U1', 'letter');
    const u1 = (r.body.results || [])[0] || {};
    check('the normal case: the link is fetched at once with no login, and what is kept is a real PDF', u1.ok === true && Buffer.from(String(u1.labelPdfBase64), 'base64').toString().startsWith('%PDF') && labelDownloads.length === 1 && labelDownloads[0].auth === false && !u1.warning, JSON.stringify(r.body).slice(0, 220));
    check('and the ledger keeps that file, so the label can be reprinted', (ledger.find((x) => x.shipment_id === u1.shipmentId) || {}).label_pdf === u1.labelPdfBase64);
    labelAs = 'URL_LOGIN'; labelDownloads.length = 0;
    r = await buy('U1b', 'letter');
    check('a Pitney Bowes link that asks for a login is fetched again with the token, and the file is kept', r.body.results[0].ok === true && r.body.results[0].labelPdfBase64 === LABEL_B64 && labelDownloads.length === 2 && labelDownloads[0].auth === false && labelDownloads[1].auth === true, JSON.stringify(labelDownloads));
    labelAs = 'URL_SLOW'; labelDownloads.length = 0; slowTries = 0;
    r = await buy('U1c', 'letter');
    check('a file that is not there on the first try (404) is tried again and then kept', r.body.results[0].ok === true && r.body.results[0].labelPdfBase64 === LABEL_B64 && labelDownloads.length === 2, JSON.stringify(labelDownloads));
    labelAs = 'URL_FOREIGN'; labelDownloads.length = 0;
    r = await buy('U1d', 'letter');
    check('a link on some other host is fetched with no credentials at all', r.body.results[0].labelPdfBase64 === LABEL_B64 && labelDownloads.length === 1 && labelDownloads[0].auth === false, JSON.stringify(labelDownloads));
    labelAs = 'URL_FOREIGN_LOGIN'; labelDownloads.length = 0;
    r = await buy('U1e', 'letter');
    check('the token is NEVER sent to another host, even if it asks for a login (the letter is kept and flagged)', labelDownloads.length >= 1 && labelDownloads.every((d) => d.auth === false) && /did not come back/.test(r.body.results[0].warning || ''), JSON.stringify(labelDownloads));
    labelAs = 'URL_HTTP'; labelDownloads.length = 0;
    r = await buy('U2', 'letter');
    check('an insecure (http) link is never fetched; the letter is kept and flagged for support with its tracking number', labelDownloads.length === 0 && r.body.results[0].ok === true && !r.body.results[0].labelPdfBase64 && /tracking number 9400\d+/.test(r.body.results[0].warning || ''), JSON.stringify(r.body.results[0]).slice(0, 200));
    labelAs = 'URL_MISSING'; labelDownloads.length = 0;
    const cancelsBefore = cancels();
    r = await buy('U3', 'ground');
    check('a package whose file never arrives (404 three times) is cancelled at once and reported, not kept', r.body.results[0].ok === false && /did not come back/.test(r.body.results[0].error) && cancels() === cancelsBefore + 1 && labelDownloads.length === 3, JSON.stringify([r.body.results[0], labelDownloads.length]).slice(0, 240));
    check('and it is not in the ledger as bought', !ledger.some((x) => x.order_ref === 'U3'));
    labelAs = 'NONE';
    r = await buy('U4', 'letter');
    check('no file at all on a letter: kept and flagged (a letter cannot be cancelled), never a crash', r.status === 200 && r.body.results[0].ok === true && /did not come back/.test(r.body.results[0].warning || ''), JSON.stringify(r.body).slice(0, 200));
    labelAs = 'URL';
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
    check('labels draw down the balance with no checkout', rb[0].ok && rb[1].ok && r.body.balanceCents === 600 - 500 - 93, JSON.stringify(r.body));
    check('when the balance runs out, the next label is quoted and never bought', !rb[2].ok && /balance/.test(rb[2].error) && pbCalls.filter((c) => c.url.endsWith('/shipping/api/v2/shipments')).length === 2);
    check('balance never goes negative', bal('u_pilot') >= 0);
    r = await req('POST', '/api/postage/labels/' + rb[0].shipmentId + '/refund', {}, 'pilot-token');
    check('a refund puts the label price back', r.status === 200 && bal('u_pilot') === 600 - 93, String(bal('u_pilot')));
    r = await req('GET', '/api/postage/balance', undefined, 'stranger-token');
    check('balance is pilot-only', r.status === 403);
    delete process.env.PB_BALANCE;

    r = await req('GET', '/api/health');
    check('health shows PB keys present without values', r.body.config.pb_keys === true && r.body.config.pb_mode === 'sandbox' && !JSON.stringify(r.body).includes('pbsecret'));
  } catch (e) { failed++; console.log('  FAIL  threw: ' + e.stack); }
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  server.close(); process.exit(failed ? 1 : 0);
});
