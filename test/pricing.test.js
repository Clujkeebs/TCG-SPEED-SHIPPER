/* Pins the pricing change: new customers are sold the new prices (monthly or
   yearly), existing customers on the launch prices keep their plan
   (grandfathered), the public price list comes from Stripe, and a referral
   "free month" on a yearly plan is one month of credit, not a whole year. */
const Module = require('module');
const path = require('path');

process.env.STRIPE_SECRET_KEY = 'sk_test_stub';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_stub';
process.env.STRIPE_PRICE_BASE = 'price_base_299';            // the new monthly Base price
process.env.STRIPE_PRICE_PREMIUM = 'price_1U00srPpFiI6sg2W7Ps9Z7qK'; // unchanged launch Premium
process.env.STRIPE_PRICE_BASE_ANNUAL = 'price_base_year';
process.env.STRIPE_PRICE_PREMIUM_ANNUAL = '';                // not configured
process.env.SUPABASE_URL = 'https://stub.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'stub-key';
process.env.PUBLIC_SITE_URL = 'https://tcgspeedshipper.com';

const LAUNCH_BASE = 'price_1U00soPpFiI6sg2WQvzev0Rm';
const PRICES = {
  price_base_299: { id: 'price_base_299', unit_amount: 299, currency: 'usd', recurring: { interval: 'month' } },
  price_base_year: { id: 'price_base_year', unit_amount: 2900, currency: 'usd', recurring: { interval: 'year' } },
  price_1U00srPpFiI6sg2W7Ps9Z7qK: { id: 'price_1U00srPpFiI6sg2W7Ps9Z7qK', unit_amount: 599, currency: 'usd', recurring: { interval: 'month' } },
};

const calls = [];
const state = { profile: null, subs: [], updates: [], claimed: [] };
function sub(priceId, over) {
  return Object.assign({ id: 'sub_1', customer: 'cus_1', status: 'active', current_period_end: 1800000000,
    items: { data: [{ id: 'si_1', price: Object.assign({ id: priceId }, PRICES[priceId] || {}) }] } }, over);
}

const stripeStub = {
  prices: { retrieve: async (id) => { calls.push(['prices.retrieve', id]); return PRICES[id]; } },
  subscriptions: {
    list: async () => ({ data: state.subs }),
    retrieve: async () => state.subs[0],
    update: async (id, p) => { calls.push(['subscriptions.update', id, p]); return sub(p.items[0].price, { id }); },
  },
  customers: {
    create: async () => ({ id: 'cus_new' }),
    retrieve: async (id) => ({ id, metadata: { supabase_user_id: state.metaUser || undefined } }),
    createBalanceTransaction: async (cus, p) => { calls.push(['balance', cus, p]); return { id: 'cbtxn_1' }; },
  },
  checkout: { sessions: { create: async (p) => { calls.push(['checkout', p]); return { url: 'https://checkout.stripe.com/x' }; } } },
  promotionCodes: { list: async () => ({ data: [] }) },
  webhooks: { constructEvent: (body) => JSON.parse(body.toString('utf8')) },
};

function chainFor() {
  const q = { f: {} };
  q.select = () => q; q.eq = (k, v) => { q.f[k] = v; return q; };
  q.maybeSingle = async () => ({ data: state.profile, error: null });
  return q;
}
const supabaseStub = {
  from: () => ({
    select: () => chainFor(),
    update: (vals) => {
      const q = { f: {} };
      q.eq = (k, v) => { q.f[k] = v; return q; };
      q.select = () => q;
      q.maybeSingle = async () => { state.updates.push({ vals, f: q.f }); return { data: { id: 'referrer_1' }, error: null }; };
      q.then = (res) => { state.updates.push({ vals, f: q.f }); res({ error: null }); };
      return q;
    },
    upsert: async () => ({ error: null }),
    insert: async () => ({ error: null }),
  }),
  rpc: async (name) => {
    calls.push(['rpc', name]);
    if (name === 'tcgss_claim_pending_referral_credits') { const c = state.claimed; state.claimed = []; return { data: c, error: null }; }
    return { data: null, error: null };
  },
  auth: { getUser: async () => ({ data: { user: { id: 'user_1', email: 'buyer@example.com' } }, error: null }), admin: {} },
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
    const r = http.request({ host: '127.0.0.1', port: server.address().port, method, path: urlPath,
      headers: Object.assign({ 'Content-Type': 'application/json', 'Content-Length': payload ? payload.length : 0 }, headers || {}) }, (res) => {
      let d = ''; res.on('data', (c) => { d += c; });
      res.on('end', () => { let j; try { j = JSON.parse(d); } catch (e) { j = d; } resolve({ status: res.statusCode, body: j }); });
    });
    r.on('error', reject); if (payload) r.write(payload); r.end();
  });
}
let passed = 0, failed = 0;
function check(name, cond, extra) {
  if (cond) { passed++; console.log('  PASS  ' + name); }
  else { failed++; console.log('  FAIL  ' + name + (extra ? '  — ' + extra : '')); }
}
const AUTH = { Authorization: 'Bearer t' };
function reset() { calls.length = 0; state.updates.length = 0; state.subs = []; state.profile = null; state.claimed = []; state.metaUser = null; }

server.listen(0, async () => {
  try {
    console.log('\n-- New customers --');
    reset(); state.profile = { stripe_customer_id: null, is_lifetime_free: false };
    let r = await req('POST', '/api/create-checkout-session', { plan: 'base' }, AUTH);
    let co = calls.find((c) => c[0] === 'checkout');
    check('monthly Base checkout sells the new price', r.status === 200 && co && co[1].line_items[0].price === 'price_base_299', JSON.stringify(r.body));

    reset(); state.profile = { stripe_customer_id: null, is_lifetime_free: false };
    r = await req('POST', '/api/create-checkout-session', { plan: 'base', interval: 'year' }, AUTH);
    co = calls.find((c) => c[0] === 'checkout');
    check('yearly Base checkout sells the yearly price', co && co[1].line_items[0].price === 'price_base_year');

    reset(); state.profile = { stripe_customer_id: null, is_lifetime_free: false };
    r = await req('POST', '/api/create-checkout-session', { plan: 'premium', interval: 'year' }, AUTH);
    check('yearly Premium is refused while its price isn\'t configured', r.status === 400 && /yearly/i.test(r.body.error) && !calls.some((c) => c[0] === 'checkout'));

    reset(); state.profile = { stripe_customer_id: null, is_lifetime_free: false };
    r = await req('POST', '/api/create-checkout-session', { plan: 'gold' }, AUTH);
    check('unknown plan refused', r.status === 400);

    console.log('\n-- Existing customers (grandfathered) --');
    reset();
    await req('POST', '/api/stripe-webhook', { type: 'customer.subscription.updated', data: { object: sub(LAUNCH_BASE) } }, { 'stripe-signature': 'x' });
    const u = state.updates.find((x) => x.vals.plan !== undefined);
    check('a subscriber still on the $1.99 launch price keeps Base', u && u.vals.plan === 'base' && u.vals.stripe_price_id === LAUNCH_BASE, JSON.stringify(state.updates));

    reset(); state.profile = { stripe_customer_id: 'cus_1', is_lifetime_free: false }; state.subs = [sub(LAUNCH_BASE)];
    r = await req('POST', '/api/create-checkout-session', { plan: 'base', interval: 'year' }, AUTH);
    const up = calls.find((c) => c[0] === 'subscriptions.update');
    check('a monthly Base subscriber can switch to yearly on the same subscription', r.body.switched === true && up && up[2].items[0].price === 'price_base_year' && !calls.some((c) => c[0] === 'checkout'));

    console.log('\n-- Public price list --');
    reset();
    r = await req('GET', '/api/plans');
    check('prices come from Stripe', r.status === 200 && r.body.plans.base.month.amount === 299 && r.body.plans.base.year.amount === 2900 && r.body.plans.premium.month.amount === 599, JSON.stringify(r.body));
    check('an unconfigured yearly price is simply absent', r.body.plans.premium.year === undefined);

    console.log('\n-- Referral credit on a yearly plan --');
    reset(); state.subs = [sub('price_base_year')]; state.claimed = [{ id: 7 }];
    // A yearly subscription going active triggers the referrer's pending credits.
    await req('POST', '/api/stripe-webhook', { type: 'customer.subscription.updated', data: { object: sub('price_base_year') } }, { 'stripe-signature': 'x' });
    const bal = calls.find((c) => c[0] === 'balance');
    check('credit is one month ($29 / 12 = $2.42), not a year', bal && bal[2].amount === -242, JSON.stringify(bal));

    console.log('\n-- Two-sided referrals: the friend gets a free first month --');
    reset(); state.profile = { stripe_customer_id: null, is_lifetime_free: false, referred_by: 'referrer_1' };
    r = await req('POST', '/api/create-checkout-session', { plan: 'base' }, AUTH);
    co = calls.find((c) => c[0] === 'checkout');
    check('a referred friend\'s first checkout starts with a 30-day free month and collects a card',
      co && co[1].subscription_data && co[1].subscription_data.trial_period_days === 30 && co[1].payment_method_collection === 'always', JSON.stringify(co && co[1]));
    check('the free month is disclosed at checkout', co && /first 30 days are free/.test(co[1].custom_text.submit.message));

    reset(); state.profile = { stripe_customer_id: null, is_lifetime_free: false, affiliate_id: 'aff_1' };
    r = await req('POST', '/api/create-checkout-session', { plan: 'premium' }, AUTH);
    co = calls.find((c) => c[0] === 'checkout');
    check('a creator-link signup gets the same free month', co && co[1].subscription_data && co[1].subscription_data.trial_period_days === 30);

    reset(); state.profile = { stripe_customer_id: 'cus_1', is_lifetime_free: false, referred_by: 'referrer_1' };
    state.subs = [sub(LAUNCH_BASE, { status: 'canceled' })];
    r = await req('POST', '/api/create-checkout-session', { plan: 'base' }, AUTH);
    co = calls.find((c) => c[0] === 'checkout');
    check('no second free month after cancelling and coming back', co && !co[1].subscription_data && co[1].payment_method_collection === 'if_required');

    reset(); state.profile = { stripe_customer_id: null, is_lifetime_free: false };
    r = await req('POST', '/api/create-checkout-session', { plan: 'base' }, AUTH);
    co = calls.find((c) => c[0] === 'checkout');
    check('an unreferred customer gets no free month', co && !co[1].subscription_data);

    console.log('\n-- The referrer is rewarded only once the friend actually pays --');
    reset(); state.subs = [sub('price_base_299', { status: 'trialing' })];
    await req('POST', '/api/stripe-webhook', { type: 'checkout.session.completed', data: { object: { client_reference_id: 'user_1', subscription: 'sub_1', customer: 'cus_1' } } }, { 'stripe-signature': 'x' });
    check('a friend starting their free month earns the referrer nothing yet', !calls.some((c) => c[0] === 'rpc' && c[1] === 'tcgss_record_referral_conversion'));

    const paid = (over) => ({ type: 'invoice.payment_succeeded', data: { object: Object.assign({ id: 'in_1', customer: 'cus_1', subscription: 'sub_1', amount_paid: 299, currency: 'usd', period_start: 1800000000 }, over) } });
    const converted = () => calls.some((c) => c[0] === 'rpc' && c[1] === 'tcgss_record_referral_conversion');

    reset(); state.profile = { id: 'user_1', referred_by: 'referrer_1' }; state.subs = [sub('price_base_299')];
    await req('POST', '/api/stripe-webhook', paid(), { 'stripe-signature': 'x' });
    check('their first real payment records the referral conversion', converted());

    reset(); state.profile = { id: 'user_1', referred_by: 'referrer_1' }; state.subs = [sub('price_base_299')];
    await req('POST', '/api/stripe-webhook', { type: 'checkout.session.completed', data: { object: { client_reference_id: 'user_1', subscription: 'sub_1', customer: 'cus_1' } } }, { 'stripe-signature': 'x' });
    check('an active $0 checkout (100%-off code) earns the referrer nothing', !converted());

    reset(); state.profile = { id: 'user_1', referred_by: 'referrer_1' }; state.subs = [sub('price_base_299')];
    await req('POST', '/api/stripe-webhook', paid({ subscription: null }), { 'stripe-signature': 'x' });
    check('a paid one-off invoice (no subscription) earns the referrer nothing', !converted());

    reset(); state.profile = { id: 'user_1', referred_by: 'referrer_1' }; state.subs = [sub('price_unknown')];
    await req('POST', '/api/stripe-webhook', paid(), { 'stripe-signature': 'x' });
    check('a paid invoice on a price that isn\'t one of our plans earns nothing', !converted());

    reset(); state.profile = { id: 'user_1' }; state.subs = [sub('price_base_299')];
    await req('POST', '/api/stripe-webhook', paid(), { 'stripe-signature': 'x' });
    check('an unreferred customer\'s payment records no conversion', !converted());

    reset(); state.profile = { id: 'user_1', referred_by: 'referrer_1' };
    await req('POST', '/api/stripe-webhook', { type: 'invoice.payment_succeeded', data: { object: { id: 'in_0', customer: 'cus_1', amount_paid: 0, currency: 'usd' } } }, { 'stripe-signature': 'x' });
    check('a $0 trial invoice does not', !calls.some((c) => c[0] === 'rpc' && c[1] === 'tcgss_record_referral_conversion'));

    console.log('\n-- Health --');
    const h = await req('GET', '/api/health');
    check('a missing yearly price does not mark the deploy unhealthy', h.body.ok === true && h.body.config.price_premium_annual === false);
  } catch (e) { failed++; console.error(e); }
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  server.close(); process.exit(failed ? 1 : 0);
});
