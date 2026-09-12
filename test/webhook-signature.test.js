/* The Stripe webhook is the only thing that turns a completed payment into a
   paid plan, and it fails closed: if the raw request body is altered anywhere
   between Netlify and Express, every signature check fails and nobody's plan
   ever updates. This drives the real function handler with real Stripe
   signatures to prove the bytes survive the trip. No network is used —
   signature generation and verification are both local crypto. */
const Module = require('module');
const path = require('path');
const RealStripe = require('stripe');

const WEBHOOK_SECRET = 'whsec_test_' + 'a'.repeat(24);
process.env.STRIPE_SECRET_KEY = 'sk_test_stub';
process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET;
process.env.STRIPE_PRICE_BASE = 'price_base';
process.env.STRIPE_PRICE_PREMIUM = 'price_premium';
process.env.SUPABASE_URL = 'https://stub.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'stub-key';
process.env.PUBLIC_SITE_URL = 'https://tcg-speed-shipper.netlify.app';

const realStripeClient = new RealStripe('sk_test_stub');
const writes = [];

// Only the API calls are stubbed. constructEvent and generateTestHeaderString
// are the genuine Stripe implementations, so the signature check is real.
const stripeStub = {
  webhooks: realStripeClient.webhooks,
  subscriptions: {
    retrieve: async (id) => ({
      id, customer: 'cus_1', status: 'active', current_period_end: 1800000000,
      items: { data: [{ id: 'si_1', price: { id: 'price_premium' } }] },
    }),
  },
};

const supabaseStub = {
  from: () => ({
    update: (vals) => {
      const q = { _f: {} };
      q.eq = (k, v) => { q._f[k] = v; return q; };
      var record = function () { writes.push({ vals, filters: q._f }); };
      // checkout.session.completed's handler now also does
      // .select('id').maybeSingle() on the subscription-update path; the
      // webhook fixture here only exercises the referral-free case, so a
      // stub id with no referrer is enough to keep that path a no-op.
      q.select = () => q;
      q.maybeSingle = async () => { record(); return { data: { id: 'stub_profile_id' }, error: null }; };
      q.then = (resolve) => { record(); resolve({ error: null }); };
      return q;
    },
  }),
  auth: { admin: {} },
  // No referrer in this fixture set — every referral RPC is a safe no-op.
  rpc: async () => ({ data: null, error: null }),
};

const origLoad = Module._load;
Module._load = function (request) {
  if (request === 'stripe') return function StripeStub() { return stripeStub; };
  if (request === '@supabase/supabase-js') return { createClient: () => supabaseStub };
  return origLoad.apply(this, arguments);
};
const { handler } = require(path.join(__dirname, '..', 'netlify', 'functions', 'api.js'));
Module._load = origLoad;

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (detail ? '\n        ' + detail : '')); }
}

// Shaped like a real Netlify Functions v1 event.
function netlifyEvent(rawPath, bodyString, headers, base64) {
  return {
    path: rawPath,
    httpMethod: 'POST',
    headers: Object.assign({ 'content-type': 'application/json' }, headers || {}),
    queryStringParameters: {},
    body: base64 ? Buffer.from(bodyString, 'utf8').toString('base64') : bodyString,
    isBase64Encoded: !!base64,
  };
}

const payload = JSON.stringify({
  id: 'evt_1',
  type: 'checkout.session.completed',
  data: { object: { client_reference_id: 'user_1', subscription: 'sub_1', customer: 'cus_1' } },
});

function sign(body) {
  return realStripeClient.webhooks.generateTestHeaderString({ payload: body, secret: WEBHOOK_SECRET });
}

(async () => {
  for (const [label, base64] of [['plain body', false], ['base64 body', true]]) {
    console.log('\n-- Netlify delivers a ' + label + ' --');
    for (const p of ['/api/stripe-webhook', '/.netlify/functions/api/stripe-webhook']) {
      writes.length = 0;
      const res = await handler(netlifyEvent(p, payload, { 'stripe-signature': sign(payload) }, base64), {});
      check('signature verifies at ' + p, res.statusCode === 200,
        'status ' + res.statusCode + ' body ' + res.body);
      check('plan written at ' + p, writes.some((w) => w.vals.plan === 'premium'),
        JSON.stringify(writes));
      check('owner accounts still excluded at ' + p,
        writes.every((w) => w.filters.is_lifetime_free === false));
    }
  }

  console.log('\n-- Forged and tampered deliveries --');
  writes.length = 0;
  let res = await handler(netlifyEvent('/api/stripe-webhook', payload, { 'stripe-signature': 't=1,v1=deadbeef' }), {});
  check('a bad signature is rejected', res.statusCode === 400, 'status ' + res.statusCode);
  check('and writes nothing', writes.length === 0);

  writes.length = 0;
  res = await handler(netlifyEvent('/api/stripe-webhook', payload, {}), {});
  check('a missing signature header is rejected', res.statusCode === 400, 'status ' + res.statusCode);

  writes.length = 0;
  const tampered = payload.replace('user_1', 'user_2');
  res = await handler(netlifyEvent('/api/stripe-webhook', tampered, { 'stripe-signature': sign(payload) }), {});
  check('a body edited after signing is rejected', res.statusCode === 400, 'status ' + res.statusCode);
  check('and writes nothing', writes.length === 0);

  console.log('\n-- Health check through the real handler --');
  const health = await handler({
    path: '/api/health', httpMethod: 'GET', headers: {}, queryStringParameters: {}, body: null, isBase64Encoded: false,
  }, {});
  const parsed = JSON.parse(health.body);
  check('reports ok with every var present', health.statusCode === 200 && parsed.ok === true, health.body);
  check('reports both clients built', parsed.clients.stripe === true && parsed.clients.supabase_admin === true);
  check('never echoes a secret value', !health.body.includes(WEBHOOK_SECRET) && !health.body.includes('stub-key'));

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
