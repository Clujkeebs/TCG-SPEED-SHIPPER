/* The referral reward moves real money (a Stripe balance credit), so this
   pins: a conversion only ever creates one reward per referred user, credit
   is applied immediately when the referrer is already paying, stays pending
   and is picked up later when they aren't yet, and a failed Stripe call
   releases the claim instead of losing the reward. */
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
  subscriptions: [],       // live Stripe subscriptions, keyed by customer via find()
  pendingCredits: [],      // rows tcgss_claim_pending_referral_credits would return
  referrerOf: {},          // referred user id -> referrer id (what tcgss_record_referral_conversion "knows")
  alreadyConverted: {},    // referred user id -> true once "recorded"
  balanceTxnShouldFail: false,
  updates: [],
};

function sub(over) {
  return Object.assign({
    id: 'sub_1', customer: 'cus_referrer', status: 'active',
    current_period_end: 1800000000,
    items: { data: [{ id: 'si_1', price: { id: 'price_premium', unit_amount: 599, currency: 'usd' } }] },
  }, over);
}

const stripeStub = {
  subscriptions: {
    list: async (p) => { calls.push(['subscriptions.list', p]); return { data: state.subscriptions.filter((s) => s.customer === p.customer) }; },
    retrieve: async (id) => { calls.push(['subscriptions.retrieve', id]); return state.subscriptions.find((s) => s.id === id) || sub({ id }); },
  },
  customers: {
    createBalanceTransaction: async (customerId, p) => {
      calls.push(['customers.createBalanceTransaction', customerId, p]);
      if (state.balanceTxnShouldFail) throw new Error('stripe down');
      return { id: 'txn_' + (calls.filter((c) => c[0] === 'customers.createBalanceTransaction').length) };
    },
  },
  prices: { retrieve: async (id) => { calls.push(['prices.retrieve', id]); return { id, unit_amount: 599, currency: 'usd' }; } },
  webhooks: { constructEvent: (body) => JSON.parse(body.toString('utf8')) },
};

function updateChain(table) {
  const q = { _f: {} };
  q.eq = (k, v) => { q._f[k] = v; return q; };
  q.select = () => q;
  q.maybeSingle = async () => ({ data: { id: q._f.stripe_customer_id ? 'referrer_profile' : 'some_id' }, error: null });
  q.then = (resolve) => { state.updates.push({ table, filters: q._f }); resolve({ error: null }); };
  return q;
}

const supabaseStub = {
  from: (table) => ({
    update: () => updateChain(table),
    select: () => ({
      eq: () => ({
        maybeSingle: async () => ({ data: { stripe_customer_id: state.referrerCustomerId }, error: null }),
      }),
    }),
  }),
  rpc: async (name, args) => {
    calls.push(['rpc:' + name, args]);
    if (name === 'tcgss_record_referral_conversion') {
      const referredId = args.p_referred_user_id;
      if (state.alreadyConverted[referredId]) return { data: null, error: null };
      const referrer = state.referrerOf[referredId];
      if (!referrer) return { data: null, error: null };
      state.alreadyConverted[referredId] = true;
      state.pendingCredits.push({ id: state.pendingCredits.length + 1, referrer_id: referrer, referred_user_id: referredId, status: 'pending' });
      return { data: referrer, error: null };
    }
    if (name === 'tcgss_claim_pending_referral_credits') {
      const referrerId = args.p_referrer_id;
      const claimed = state.pendingCredits.filter((c) => c.referrer_id === referrerId && c.status === 'pending');
      claimed.forEach((c) => { c.status = 'processing'; });
      return { data: claimed, error: null };
    }
    if (name === 'tcgss_mark_referral_credit_applied') {
      const row = state.pendingCredits.find((c) => c.id === args.p_credit_id);
      if (row) row.status = 'applied';
      return { data: null, error: null };
    }
    if (name === 'tcgss_release_referral_credit') {
      const row = state.pendingCredits.find((c) => c.id === args.p_credit_id);
      if (row) row.status = 'pending';
      return { data: null, error: null };
    }
    return { data: null, error: null };
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

function checkoutCompleted(userId, customer, subscription) {
  return { type: 'checkout.session.completed', data: { object: { client_reference_id: userId, subscription: subscription.id, customer } } };
}

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (detail ? '\n        ' + detail : '')); }
}

function reset() {
  state.subscriptions.length = 0; state.pendingCredits.length = 0;
  state.referrerOf = {}; state.alreadyConverted = {}; state.balanceTxnShouldFail = false;
  state.updates.length = 0; state.referrerCustomerId = null;
  calls.length = 0;
}

(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));

  console.log('\n-- Referrer is already an active paying customer --');
  reset();
  state.referrerOf['referred_1'] = 'referrer_1';
  state.referrerCustomerId = 'cus_referrer';
  state.subscriptions.push(sub({ id: 'sub_referred', customer: 'cus_referred' }));
  state.subscriptions.push(sub({ id: 'sub_referrer', customer: 'cus_referrer' }));
  await postWebhook(checkoutCompleted('referred_1', 'cus_referred', { id: 'sub_referred' }));
  check('conversion was recorded', calls.some((c) => c[0] === 'rpc:tcgss_record_referral_conversion'));
  check('credit was claimed for the referrer', calls.some((c) => c[0] === 'rpc:tcgss_claim_pending_referral_credits' && c[1].p_referrer_id === 'referrer_1'));
  check('a real Stripe balance credit was created on the referrer\'s customer', calls.some((c) => c[0] === 'customers.createBalanceTransaction' && c[1] === 'cus_referrer' && c[2].amount === -599));
  check('credit marked applied', state.pendingCredits[0].status === 'applied');

  console.log('\n-- Referrer has not subscribed yet: credit stays pending, no phantom charge --');
  reset();
  state.referrerOf['referred_2'] = 'referrer_2';
  state.referrerCustomerId = null; // referrer has no Stripe customer at all yet
  state.subscriptions.push(sub({ id: 'sub_referred2', customer: 'cus_referred2' }));
  await postWebhook(checkoutCompleted('referred_2', 'cus_referred2', { id: 'sub_referred2' }));
  check('conversion recorded', state.pendingCredits.length === 1 && state.pendingCredits[0].status === 'pending');
  check('no attempt to claim credit for the actual referrer, who has no Stripe customer yet',
    !calls.some((c) => c[0] === 'rpc:tcgss_claim_pending_referral_credits' && c[1].p_referrer_id === 'referrer_2'));
  check('nothing charged', !calls.some((c) => c[0] === 'customers.createBalanceTransaction'));

  console.log('\n-- That pending credit is applied once the referrer starts paying --');
  // Same state carried over: referrer_2 now subscribes themselves.
  state.referrerCustomerId = 'cus_referrer2';
  state.subscriptions.push(sub({ id: 'sub_referrer2', customer: 'cus_referrer2' }));
  await postWebhook(checkoutCompleted('referrer_2', 'cus_referrer2', { id: 'sub_referrer2' }));
  check('the earlier pending credit gets claimed once the referrer is live', calls.some((c) => c[0] === 'rpc:tcgss_claim_pending_referral_credits' && c[1].p_referrer_id === 'referrer_2'));
  check('and applied as a real credit', state.pendingCredits[0].status === 'applied');

  console.log('\n-- Resubscribing does not earn a second reward for the same referral --');
  reset();
  state.referrerOf['referred_3'] = 'referrer_3';
  state.referrerCustomerId = 'cus_referrer3';
  state.subscriptions.push(sub({ id: 'sub_referred3a', customer: 'cus_referred3' }));
  state.subscriptions.push(sub({ id: 'sub_referrer3', customer: 'cus_referrer3' }));
  await postWebhook(checkoutCompleted('referred_3', 'cus_referred3', { id: 'sub_referred3a' }));
  check('first conversion created exactly one credit', state.pendingCredits.length === 1);
  // referred_3 cancels and resubscribes — a second, brand new Checkout Session.
  await postWebhook(checkoutCompleted('referred_3', 'cus_referred3', { id: 'sub_referred3b' }));
  check('resubscribing does not create a second credit', state.pendingCredits.length === 1, JSON.stringify(state.pendingCredits));

  console.log('\n-- A referrer who was never referred, or an unreferred signup, earns nothing --');
  reset();
  await postWebhook(checkoutCompleted('nobody_referred_them', 'cus_x', { id: 'sub_x' }));
  check('no credit row created', state.pendingCredits.length === 0);
  check('no Stripe balance call', !calls.some((c) => c[0] === 'customers.createBalanceTransaction'));

  console.log('\n-- A failed Stripe balance call releases the claim instead of losing it --');
  reset();
  state.referrerOf['referred_4'] = 'referrer_4';
  state.referrerCustomerId = 'cus_referrer4';
  state.subscriptions.push(sub({ id: 'sub_referred4', customer: 'cus_referred4' }));
  state.subscriptions.push(sub({ id: 'sub_referrer4', customer: 'cus_referrer4' }));
  state.balanceTxnShouldFail = true;
  await postWebhook(checkoutCompleted('referred_4', 'cus_referred4', { id: 'sub_referred4' }));
  check('credit is released back to pending, not lost, when Stripe fails', state.pendingCredits[0].status === 'pending', JSON.stringify(state.pendingCredits));

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  server.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
