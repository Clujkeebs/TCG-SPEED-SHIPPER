/* The affiliate program moves real cash commission, so this pins: earnings
   are recorded only via invoice.payment_succeeded (idempotent per invoice),
   admin routes are owner-only, and the dashboard never leaks on a bad token. */
const Module = require('module');
const path = require('path');

process.env.STRIPE_SECRET_KEY = 'sk_test_stub';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_stub';
process.env.STRIPE_PRICE_BASE = 'price_base';
process.env.STRIPE_PRICE_PREMIUM = 'price_premium';
process.env.SUPABASE_URL = 'https://stub.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'stub-key';
process.env.PUBLIC_SITE_URL = 'https://tcg-speed-shipper.netlify.app';

const calls = [];
const state = {
  profileByCustomer: {},   // stripe_customer_id -> profile id
  dashboards: {},          // token -> dashboard payload (or undefined = not found)
  affiliatesSummary: [],
};

const stripeStub = { webhooks: { constructEvent: (body) => JSON.parse(body.toString('utf8')) } };

const supabaseStub = {
  from: () => ({
    select: () => ({
      eq: (k, v) => ({
        maybeSingle: async () => {
          const id = state.profileByCustomer[v];
          return { data: id ? { id } : null, error: null };
        },
      }),
    }),
  }),
  rpc: async (name, args) => {
    calls.push([name, args]);
    if (name === 'tcgss_record_affiliate_earning') return { data: 'affiliate_credited_marker', error: null };
    if (name === 'tcgss_get_affiliate_dashboard') return { data: state.dashboards[args.p_token] || null, error: null };
    if (name === 'tcgss_list_affiliates_summary') return { data: state.affiliatesSummary, error: null };
    if (name === 'tcgss_create_affiliate') return { data: { id: 'aff_new', affiliate_code: 'NEWCODE1', dashboard_token: 'tok_new_123' }, error: null };
    if (name === 'tcgss_activate_affiliate') return { data: { id: args.p_affiliate_id, status: 'active' }, error: null };
    if (name === 'tcgss_mark_affiliate_paid') return { data: 3, error: null };
    return { data: null, error: null };
  },
  auth: {
    getUser: async (token) => {
      if (token === 'owner-token') return { data: { user: { id: 'owner_1', email: 'clujkeebs@aol.com' } }, error: null };
      if (token === 'stranger-token') return { data: { user: { id: 'user_2', email: 'someone@example.com' } }, error: null };
      return { data: { user: null }, error: new Error('invalid token') };
    },
    admin: {},
  },
};

const origLoad = Module._load;
Module._load = function (request) {
  if (request === 'stripe') return function StripeStub() { return stripeStub; };
  if (request === '@supabase/supabase-js') return { createClient: () => supabaseStub };
  return origLoad.apply(this, arguments);
};
const app = require(path.join(__dirname, '..', 'server.js'));
Module._load = origLoad;

const http = require('http');
const server = http.createServer(app);

function req(method, urlPath, body, headers) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
    const r = http.request({
      host: '127.0.0.1', port: server.address().port, method, path: urlPath,
      headers: Object.assign({ 'Content-Type': 'application/json', 'Content-Length': payload ? payload.length : 0 }, headers || {}),
    }, (res) => {
      let d = ''; res.on('data', (c) => { d += c; });
      res.on('end', () => { let j; try { j = JSON.parse(d); } catch (e) { j = d; } resolve({ status: res.statusCode, body: j }); });
    });
    r.on('error', reject);
    if (payload) r.write(payload);
    r.end();
  });
}
function postWebhook(payload) {
  return new Promise((resolve, reject) => {
    const body = Buffer.from(JSON.stringify(payload));
    const r = http.request({
      host: '127.0.0.1', port: server.address().port, method: 'POST', path: '/api/stripe-webhook',
      headers: { 'Content-Type': 'application/json', 'Content-Length': body.length, 'stripe-signature': 'stub' },
    }, (res) => { let d = ''; res.on('data', (c) => { d += c; }); res.on('end', () => resolve({ status: res.statusCode })); });
    r.on('error', reject); r.write(body); r.end();
  });
}
function invoiceEvent(over) {
  return { type: 'invoice.payment_succeeded', data: { object: Object.assign({
    id: 'in_1', customer: 'cus_1', amount_paid: 599, currency: 'usd', period_start: 1800000000,
  }, over) } };
}

function reset() {
  state.profileByCustomer = {}; state.dashboards = {}; state.affiliatesSummary = [];
  calls.length = 0;
}

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (detail ? '\n        ' + detail : '')); }
}

(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));

  console.log('\n-- invoice.payment_succeeded credits an attributed customer --');
  reset();
  state.profileByCustomer['cus_1'] = 'user_1';
  let res = await postWebhook(invoiceEvent({}));
  check('webhook handled cleanly', res.status === 200);
  const earningCall = calls.find((c) => c[0] === 'tcgss_record_affiliate_earning');
  check('recorded via the RPC with the right invoice/customer/amount', earningCall &&
    earningCall[1].p_referred_user_id === 'user_1' && earningCall[1].p_stripe_invoice_id === 'in_1' && earningCall[1].p_amount_cents === 599,
    JSON.stringify(earningCall));
  check('period month derived from the invoice period, not "now"',
    earningCall[1].p_period_month === '2027-01-01', earningCall[1].p_period_month);

  console.log('\n-- A customer never attributed to any affiliate is still safe to process --');
  reset();
  state.profileByCustomer['cus_2'] = 'user_2';
  res = await postWebhook(invoiceEvent({ id: 'in_2', customer: 'cus_2' }));
  check('webhook still succeeds (the RPC itself returns null for no affiliate)', res.status === 200);
  check('the RPC was still called — attribution is decided server-side, not skipped client-side',
    calls.some((c) => c[0] === 'tcgss_record_affiliate_earning' && c[1].p_referred_user_id === 'user_2'));

  console.log('\n-- A $0 invoice (fully covered by a promo) records nothing --');
  reset();
  state.profileByCustomer['cus_1'] = 'user_1';
  res = await postWebhook(invoiceEvent({ id: 'in_3', amount_paid: 0 }));
  check('no earning RPC call for a zero-amount invoice', !calls.some((c) => c[0] === 'tcgss_record_affiliate_earning'));

  console.log('\n-- An invoice for an unknown Stripe customer does not crash --');
  reset();
  res = await postWebhook(invoiceEvent({ id: 'in_4', customer: 'cus_unknown' }));
  check('handled without error', res.status === 200);
  check('no earning recorded for a customer we cannot find', !calls.some((c) => c[0] === 'tcgss_record_affiliate_earning'));

  console.log('\n-- Affiliate dashboard: found vs not found --');
  reset();
  state.dashboards['tok_good'] = { name: 'Test Creator', affiliate_code: 'ABC123', status: 'active', commission_rate: 0.3, owed_cents: 500, paid_cents: 0, referred_signups: 2, referred_paying_customers: 1 };
  res = await req('GET', '/api/affiliate-dashboard?token=tok_good');
  check('a valid token returns the dashboard', res.status === 200 && res.body.name === 'Test Creator');
  res = await req('GET', '/api/affiliate-dashboard?token=tok_wrong');
  check('an unknown token is a plain 404, no leak', res.status === 404);
  calls.length = 0;
  res = await req('GET', '/api/affiliate-dashboard');
  check('a missing token is rejected before touching the database', res.status === 400 && !calls.some((c) => c[0] === 'tcgss_get_affiliate_dashboard'));

  console.log('\n-- Admin routes are owner-only --');
  reset();
  res = await req('GET', '/api/admin/affiliates', undefined, { Authorization: 'Bearer stranger-token' });
  check('a non-owner signed-in user is refused', res.status === 403);
  res = await req('GET', '/api/admin/affiliates');
  check('an unauthenticated request is refused', res.status === 401);
  res = await req('GET', '/api/admin/affiliates', undefined, { Authorization: 'Bearer owner-token' });
  check('the owner can list affiliates', res.status === 200 && Array.isArray(res.body.affiliates));

  console.log('\n-- Admin: create, activate, mark paid --');
  reset();
  res = await req('POST', '/api/admin/affiliates', { name: 'New Creator', email: 'new@example.com' }, { Authorization: 'Bearer owner-token' });
  check('creates an affiliate and returns a ready-to-send link', res.status === 200 && res.body.link === 'https://tcg-speed-shipper.netlify.app/?aff=NEWCODE1', JSON.stringify(res.body));
  check('and a dashboard link', res.body.dashboard === 'https://tcg-speed-shipper.netlify.app/affiliate/?token=tok_new_123');

  res = await req('POST', '/api/admin/affiliates', { name: '', email: 'bad' }, { Authorization: 'Bearer owner-token' });
  check('rejects a missing name / invalid email', res.status === 400);

  res = await req('POST', '/api/admin/affiliates/aff_1/activate', {}, { Authorization: 'Bearer owner-token' });
  check('activates an affiliate', res.status === 200 && res.body.affiliate.status === 'active');

  res = await req('POST', '/api/admin/affiliates/aff_1/mark-paid', {}, { Authorization: 'Bearer owner-token' });
  check('marks earnings paid and reports how many rows', res.status === 200 && res.body.rowsMarkedPaid === 3);

  res = await req('POST', '/api/admin/affiliates', { name: 'X', email: 'x@example.com' }, { Authorization: 'Bearer stranger-token' });
  check('a non-owner cannot create an affiliate', res.status === 403);

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  server.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
