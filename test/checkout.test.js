/* Exercises /api/create-checkout-session and the Stripe webhook handlers with
   stubbed Stripe + Supabase clients. Focus: nobody gets billed twice and nobody
   who paid gets recorded as free. */
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
  subscriptions: [],
  profile: null,
  promo: null,
  updates: [],
};

function sub(over) {
  return Object.assign({
    id: 'sub_1', customer: 'cus_1', status: 'active',
    current_period_end: 1800000000,
    items: { data: [{ id: 'si_1', price: { id: 'price_base' }, current_period_end: 1800000000 }] },
  }, over);
}

const stripeStub = {
  subscriptions: {
    list: async (p) => { calls.push(['subscriptions.list', p]); return { data: state.subscriptions }; },
    update: async (id, p) => {
      calls.push(['subscriptions.update', id, p]);
      if (p.promotion_code === 'promo_bad') throw new Error('coupon not applicable');
      const s = sub({ id });
      s.items.data[0].price.id = p.items[0].price;
      return s;
    },
    retrieve: async (id) => { calls.push(['subscriptions.retrieve', id]); return state.subscriptions[0] || sub({ id }); },
  },
  customers: { create: async (p) => { calls.push(['customers.create', p]); return { id: 'cus_new' }; } },
  checkout: { sessions: { create: async (p) => { calls.push(['checkout.sessions.create', p]); return { url: 'https://checkout.stripe.com/x' }; } } },
  promotionCodes: { list: async (p) => { calls.push(['promotionCodes.list', p]); return { data: state.promo ? [state.promo] : [] }; } },
  billingPortal: { sessions: { create: async () => ({ url: 'https://billing.stripe.com/x' }) } },
  webhooks: { constructEvent: (body) => JSON.parse(body.toString('utf8')) },
};

function chain() {
  const q = { _filters: {} };
  q.select = () => q;
  q.eq = (k, v) => { q._filters[k] = v; return q; };
  q.maybeSingle = async () => ({ data: state.profile, error: null });
  q.then = undefined;
  return q;
}

const supabaseStub = {
  from: () => ({
    select: () => chain(),
    update: (vals) => {
      const q = { _f: {} };
      q.eq = (k, v) => { q._f[k] = v; return q; };
      // Supabase client resolves when awaited; record on the terminal eq().
      q.then = (resolve) => { state.updates.push({ vals: JSON.parse(JSON.stringify(vals)), filters: q._f }); resolve({ error: null }); };
      return q;
    },
    upsert: async (vals) => { calls.push(['profiles.upsert', vals]); return { error: null }; },
  }),
  auth: {
    getUser: async () => ({ data: { user: { id: 'user_1', email: 'buyer@example.com' } }, error: null }),
    admin: {},
  },
  rpc: async () => ({ data: null, error: null }),
};

const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
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
    const payload = body === undefined ? null : (Buffer.isBuffer(body) ? body : Buffer.from(JSON.stringify(body)));
    const r = http.request({
      host: '127.0.0.1', port: server.address().port, method, path: urlPath,
      headers: Object.assign({ 'Content-Type': 'application/json', 'Content-Length': payload ? payload.length : 0 }, headers || {}),
    }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => { let j; try { j = JSON.parse(data); } catch (e) { j = data; } resolve({ status: res.statusCode, body: j }); });
    });
    r.on('error', reject);
    if (payload) r.write(payload);
    r.end();
  });
}

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (detail ? '\n        ' + detail : '')); }
}

const AUTH = { Authorization: 'Bearer stub-token' };

function reset(profile, subs, promo) {
  state.profile = profile; state.subscriptions = subs || []; state.promo = promo || null;
  state.updates.length = 0; calls.length = 0;
}

(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));

  console.log('\n-- Upgrading while already subscribed (the double-charge case) --');
  reset({ stripe_customer_id: 'cus_1', is_lifetime_free: false }, [sub()]);
  let res = await req('POST', '/api/create-checkout-session', { plan: 'premium' }, AUTH);
  check('base -> premium does not open a second Checkout',
    !calls.some((c) => c[0] === 'checkout.sessions.create'),
    'calls: ' + JSON.stringify(calls.map((c) => c[0])));
  check('base -> premium updates the existing subscription in place',
    calls.some((c) => c[0] === 'subscriptions.update' && c[1] === 'sub_1' && c[2].items[0].price === 'price_premium'));
  check('switch prorates rather than charging a fresh full period',
    calls.some((c) => c[0] === 'subscriptions.update' && c[2].proration_behavior === 'create_prorations'));
  check('response tells the client no redirect is needed',
    res.status === 200 && res.body.switched === true && res.body.plan === 'premium',
    JSON.stringify(res.body));
  check('profile is written immediately, not left waiting on the webhook',
    state.updates.some((u) => u.vals.plan === 'premium'));

  console.log('\n-- Re-buying the plan you already have --');
  reset({ stripe_customer_id: 'cus_1', is_lifetime_free: false }, [sub()]);
  res = await req('POST', '/api/create-checkout-session', { plan: 'base' }, AUTH);
  check('refused with a clear message', res.status === 400 && /already on that plan/i.test(res.body.error || ''), JSON.stringify(res.body));
  check('nothing charged, nothing changed', !calls.some((c) => c[0] === 'subscriptions.update' || c[0] === 'checkout.sessions.create'));

  console.log('\n-- Cancelled subscriber coming back --');
  reset({ stripe_customer_id: 'cus_1', is_lifetime_free: false }, [sub({ status: 'canceled' })]);
  res = await req('POST', '/api/create-checkout-session', { plan: 'premium' }, AUTH);
  check('goes through Checkout again', calls.some((c) => c[0] === 'checkout.sessions.create'));
  check('reuses the existing Stripe customer', !calls.some((c) => c[0] === 'customers.create'));
  check('returns a redirect url', res.status === 200 && typeof res.body.url === 'string');

  console.log('\n-- Past-due subscriber --');
  reset({ stripe_customer_id: 'cus_1', is_lifetime_free: false }, [sub({ status: 'past_due' })]);
  res = await req('POST', '/api/create-checkout-session', { plan: 'premium' }, AUTH);
  check('still treated as an existing subscription, not a new one',
    !calls.some((c) => c[0] === 'checkout.sessions.create') && res.body.switched === true);

  console.log('\n-- First-time buyer --');
  reset({ stripe_customer_id: null, is_lifetime_free: false }, []);
  res = await req('POST', '/api/create-checkout-session', { plan: 'base' }, AUTH);
  check('creates a Stripe customer', calls.some((c) => c[0] === 'customers.create'));
  check('opens Checkout', calls.some((c) => c[0] === 'checkout.sessions.create'));
  check('links the customer id to the profile before redirecting',
    calls.some((c) => c[0] === 'profiles.upsert' && c[1].stripe_customer_id === 'cus_new'));
  check('lets Stripe collect a promo code when none was pre-applied',
    calls.some((c) => c[0] === 'checkout.sessions.create' && c[1].allow_promotion_codes === true));

  console.log('\n-- Owner account --');
  reset({ stripe_customer_id: null, is_lifetime_free: true }, []);
  res = await req('POST', '/api/create-checkout-session', { plan: 'premium' }, AUTH);
  check('cannot be charged at all', res.status === 400 && /free, permanently/i.test(res.body.error || ''));
  check('no Stripe write of any kind', !calls.some((c) => c[0] !== 'promotionCodes.list'));

  console.log('\n-- Promo code on an in-place switch --');
  reset({ stripe_customer_id: 'cus_1', is_lifetime_free: false }, [sub()], { id: 'promo_ok', code: 'LAUNCH', coupon: { percent_off: 100, duration: 'once' } });
  res = await req('POST', '/api/create-checkout-session', { plan: 'premium', promoCode: 'LAUNCH' }, AUTH);
  check('promo is passed to the subscription update',
    calls.some((c) => c[0] === 'subscriptions.update' && c[2].promotion_code === 'promo_ok'));

  reset({ stripe_customer_id: 'cus_1', is_lifetime_free: false }, [sub()], { id: 'promo_bad', code: 'NOPE', coupon: { percent_off: 50, duration: 'once' } });
  res = await req('POST', '/api/create-checkout-session', { plan: 'premium', promoCode: 'NOPE' }, AUTH);
  check('a promo that Stripe rejects does not block the upgrade',
    res.status === 200 && res.body.switched === true,
    JSON.stringify(res.body));
  check('retried without the promo', calls.filter((c) => c[0] === 'subscriptions.update').length === 2);

  console.log('\n-- Webhook: unrecognised price must never record a payer as free --');
  reset({ stripe_customer_id: 'cus_1', is_lifetime_free: false }, []);
  await req('POST', '/api/stripe-webhook', Buffer.from(JSON.stringify({
    type: 'customer.subscription.updated',
    data: { object: sub({ items: { data: [{ id: 'si_1', price: { id: 'price_WRONG' } }] } }) },
  })), { 'stripe-signature': 'stub' });
  check('active sub on an unknown price leaves the plan untouched',
    state.updates.length === 0, JSON.stringify(state.updates));

  console.log('\n-- Webhook: normal upgrade --');
  reset({ stripe_customer_id: 'cus_1', is_lifetime_free: false }, []);
  await req('POST', '/api/stripe-webhook', Buffer.from(JSON.stringify({
    type: 'customer.subscription.updated',
    data: { object: sub({ items: { data: [{ id: 'si_1', price: { id: 'price_premium' } }] } }) },
  })), { 'stripe-signature': 'stub' });
  check('plan written as premium', state.updates.some((u) => u.vals.plan === 'premium'));
  check('owner accounts excluded from the write', state.updates.every((u) => u.filters.is_lifetime_free === false));

  console.log('\n-- Webhook: stale cancellation of an old subscription --');
  reset({ stripe_customer_id: 'cus_1', is_lifetime_free: false }, []);
  await req('POST', '/api/stripe-webhook', Buffer.from(JSON.stringify({
    type: 'customer.subscription.deleted',
    data: { object: sub({ id: 'sub_OLD', status: 'canceled' }) },
  })), { 'stripe-signature': 'stub' });
  check('downgrade is scoped to the cancelled subscription id',
    state.updates.some((u) => u.filters.stripe_subscription_id === 'sub_OLD'),
    JSON.stringify(state.updates));

  console.log('\n-- Unauthenticated checkout --');
  reset({ stripe_customer_id: null, is_lifetime_free: false }, []);
  res = await req('POST', '/api/create-checkout-session', { plan: 'base' });
  check('rejected without a token', res.status === 401);

  console.log('\n-- Unknown plan name --');
  res = await req('POST', '/api/create-checkout-session', { plan: 'enterprise' }, AUTH);
  check('rejected', res.status === 400 && /unknown plan/i.test(res.body.error || ''));

  console.log('\n-- Both Netlify path prefixes --');
  reset({ stripe_customer_id: 'cus_1', is_lifetime_free: false }, [sub()]);
  res = await req('POST', '/.netlify/functions/api/create-checkout-session', { plan: 'premium' }, AUTH);
  check('rewritten path resolves too', res.status === 200 && res.body.switched === true);

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  server.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
