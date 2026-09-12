/* A 100%-off promo code is a give-it-away-free redemption: no card should be
   collected, and the same connection shouldn't be able to claim it more than
   once. This drives create-checkout-session, validate-promo-code, and the
   webhook's completion-time recording against a stubbed Stripe/Supabase. */
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
  profile: null,
  promo: null,          // the promotion code findPromotionCode() should return
  redemptions: [],       // rows in tcgss_promo_ip_redemptions: {promotion_code_id, ip_hash}
  checkoutShouldFail: false,
};

const stripeStub = {
  customers: { create: async (p) => { calls.push(['customers.create', p]); return { id: 'cus_new' }; } },
  checkout: {
    sessions: {
      create: async (p) => {
        calls.push(['checkout.sessions.create', p]);
        if (state.checkoutShouldFail && p.discounts) { state.checkoutShouldFail = false; throw new Error('coupon not applicable to this price'); }
        return { url: 'https://checkout.stripe.com/x', id: 'cs_test_1' };
      },
    },
  },
  subscriptions: { list: async () => ({ data: [] }) }, // nobody has an existing subscription in this file
  promotionCodes: { list: async (p) => { calls.push(['promotionCodes.list', p]); return { data: state.promo ? [state.promo] : [] }; } },
  webhooks: { constructEvent: (body) => JSON.parse(body.toString('utf8')) },
};

function chain() {
  const q = {};
  q.select = () => q;
  q.eq = () => q;
  q.maybeSingle = async () => ({ data: state.profile, error: null });
  return q;
}

const supabaseStub = {
  from: (table) => {
    if (table === 'tcgss_promo_ip_redemptions') {
      return {
        select: () => {
          const q = { _f: {} };
          q.eq = (k, v) => { q._f[k] = v; return q; };
          q.maybeSingle = async () => {
            const hit = state.redemptions.find((r) => r.promotion_code_id === q._f.promotion_code_id && r.ip_hash === q._f.ip_hash);
            return { data: hit ? { id: 1 } : null, error: null };
          };
          return q;
        },
        insert: async (row) => {
          calls.push(['redemptions.insert', row]);
          const dup = state.redemptions.some((r) => r.promotion_code_id === row.promotion_code_id && r.ip_hash === row.ip_hash);
          if (dup) return { error: { code: '23505', message: 'duplicate' } };
          state.redemptions.push(row);
          return { error: null };
        },
      };
    }
    return {
      select: () => chain(),
      update: () => {
        const q = { _f: {} };
        q.eq = (k, v) => { q._f[k] = v; return q; };
        q.select = () => q;
        q.maybeSingle = async () => ({ data: { id: 'stub_profile_id' }, error: null });
        q.then = (resolve) => resolve({ error: null });
        return q;
      },
      upsert: async (vals) => { calls.push(['profiles.upsert', vals]); return { error: null }; },
    };
  },
  auth: {
    getUser: async () => ({ data: { user: { id: 'user_1', email: 'buyer@example.com' } }, error: null }),
    admin: {},
  },
  rpc: async () => ({ data: null, error: null }),
};

const origLoad = Module._load;
Module._load = function (request) {
  if (request === 'stripe') return function StripeStub() { return stripeStub; };
  if (request === '@supabase/supabase-js') return { createClient: () => supabaseStub };
  return origLoad.apply(this, arguments);
};
const app = require(path.join(__dirname, '..', 'server.js'));
const { handler } = require(path.join(__dirname, '..', 'netlify', 'functions', 'api.js'));
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

const AUTH = { Authorization: 'Bearer stub-token' };
function fromIp(ip) { return { Authorization: 'Bearer stub-token', 'x-forwarded-for': ip }; }

function reset() {
  state.profile = { stripe_customer_id: null, is_lifetime_free: false };
  state.promo = { id: 'promo_free', code: 'FREEMONTH', coupon: { percent_off: 100, duration: 'once' } };
  state.redemptions.length = 0;
  state.checkoutShouldFail = false;
  calls.length = 0;
}

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (detail ? '\n        ' + detail : '')); }
}

(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));

  console.log('\n-- A 100%-off code skips card collection --');
  reset();
  let res = await req('POST', '/api/create-checkout-session', { plan: 'base', promoCode: 'FREEMONTH' }, fromIp('1.1.1.1'));
  const sessionCall = calls.find((c) => c[0] === 'checkout.sessions.create');
  check('checkout session requests if_required payment collection', sessionCall && sessionCall[1].payment_method_collection === 'if_required');
  check('discount is attached', sessionCall && JSON.stringify(sessionCall[1].discounts) === JSON.stringify([{ promotion_code: 'promo_free' }]));
  check('IP hash is stamped into session metadata for later recording', sessionCall && sessionCall[1].metadata && sessionCall[1].metadata.promo_code_id === 'promo_free' && !!sessionCall[1].metadata.promo_ip_hash);
  check('response says the promo applied', res.status === 200 && res.body.promoApplied === true);

  console.log('\n-- A normal (non-100%) paid checkout still collects a card the same way --');
  reset();
  state.promo = null;
  res = await req('POST', '/api/create-checkout-session', { plan: 'base' }, fromIp('2.2.2.2'));
  const normalCall = calls.find((c) => c[0] === 'checkout.sessions.create');
  check('if_required is present but harmless — no discount, no metadata stamped', normalCall && normalCall[1].payment_method_collection === 'if_required' && !normalCall[1].metadata);

  console.log('\n-- Redemption is NOT recorded until checkout actually completes --');
  reset();
  await req('POST', '/api/create-checkout-session', { plan: 'base', promoCode: 'FREEMONTH' }, fromIp('3.3.3.3'));
  check('creating the session alone does not burn the redemption', state.redemptions.length === 0);

  console.log('\n-- Completing that $0 checkout records the redemption --');
  const payload = JSON.stringify({
    type: 'checkout.session.completed',
    data: { object: {
      client_reference_id: 'user_1', subscription: 'sub_1', customer: 'cus_new',
      metadata: { promo_code_id: 'promo_free', promo_ip_hash: 'deadbeef' },
    } },
  });
  // stub subscriptions.retrieve for the webhook path
  stripeStub.subscriptions.retrieve = async () => ({
    id: 'sub_1', status: 'active', items: { data: [{ id: 'si_1', price: { id: 'price_base' } }] },
  });
  const whRes = await handler({
    path: '/api/stripe-webhook', httpMethod: 'POST', headers: { 'stripe-signature': 'stub' },
    queryStringParameters: {}, body: payload, isBase64Encoded: false,
  }, {});
  check('webhook handled cleanly', whRes.statusCode === 200, whRes.body);
  check('redemption recorded on completion', state.redemptions.some((r) => r.promotion_code_id === 'promo_free' && r.ip_hash === 'deadbeef'));

  console.log('\n-- Same code, same connection, tries again: refused before Stripe is even touched --');
  reset();
  state.redemptions.push({ promotion_code_id: 'promo_free', ip_hash: null }); // placeholder, replaced below
  // Compute the real hash the server would produce for '4.4.4.4' by making one
  // legitimate request first, reading it back from what got stamped in metadata.
  state.redemptions.length = 0;
  let first = await req('POST', '/api/create-checkout-session', { plan: 'base', promoCode: 'FREEMONTH' }, fromIp('4.4.4.4'));
  const stampedHash = calls.find((c) => c[0] === 'checkout.sessions.create')[1].metadata.promo_ip_hash;
  state.redemptions.push({ promotion_code_id: 'promo_free', ip_hash: stampedHash });
  calls.length = 0;
  let second = await req('POST', '/api/create-checkout-session', { plan: 'base', promoCode: 'FREEMONTH' }, fromIp('4.4.4.4'));
  check('second attempt from the same IP does not get the discount', second.body.promoApplied === false);
  check('reason is reported as ip_already_used', second.body.promoDeniedReason === 'ip_already_used', JSON.stringify(second.body));
  check('checkout still succeeds, just without the discount', second.status === 200 && typeof second.body.url === 'string');
  check('no metadata stamped on the denied attempt (nothing more to record)', !calls.find((c) => c[0] === 'checkout.sessions.create')[1].metadata);

  console.log('\n-- Different IP, same code: allowed --');
  reset();
  state.redemptions.push({ promotion_code_id: 'promo_free', ip_hash: 'some-other-hash-entirely' });
  res = await req('POST', '/api/create-checkout-session', { plan: 'base', promoCode: 'FREEMONTH' }, fromIp('5.5.5.5'));
  check('a fresh IP can still redeem it', res.body.promoApplied === true);

  console.log('\n-- validate-promo-code gives early feedback for an already-used IP --');
  reset();
  let firstValidate = await req('GET', '/api/validate-promo-code?code=FREEMONTH', undefined, { 'x-forwarded-for': '6.6.6.6' });
  check('first check from this IP says valid', firstValidate.body.valid === true);
  // Simulate that this IP already redeemed it (same hash function as server.js: sha256)
  const crypto = require('crypto');
  const hash6 = crypto.createHash('sha256').update('6.6.6.6').digest('hex');
  state.redemptions.push({ promotion_code_id: 'promo_free', ip_hash: hash6 });
  let secondValidate = await req('GET', '/api/validate-promo-code?code=FREEMONTH', undefined, { 'x-forwarded-for': '6.6.6.6' });
  check('second check from the same IP says already used', secondValidate.body.valid === false && /already been used/i.test(secondValidate.body.error || ''), JSON.stringify(secondValidate.body));

  console.log('\n-- A non-free promo code is never subject to the IP gate --');
  reset();
  state.promo = { id: 'promo_10off', code: 'TENOFF', coupon: { percent_off: 10, duration: 'once' } };
  res = await req('POST', '/api/create-checkout-session', { plan: 'base', promoCode: 'TENOFF' }, fromIp('7.7.7.7'));
  check('a partial discount is never gated by IP', res.body.promoApplied === true);
  check('and no metadata is stamped (only 100%-off codes need recording)', !calls.find((c) => c[0] === 'checkout.sessions.create')[1].metadata);

  console.log('\n-- A promo that fails at Stripe (restricted to a different plan) still falls back cleanly --');
  reset();
  state.checkoutShouldFail = true;
  res = await req('POST', '/api/create-checkout-session', { plan: 'premium', promoCode: 'FREEMONTH' }, fromIp('8.8.8.8'));
  check('falls back to a working checkout without the discount', res.status === 200 && res.body.promoApplied === false && typeof res.body.url === 'string');

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  server.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
