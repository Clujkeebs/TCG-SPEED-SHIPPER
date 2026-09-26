/* The /admin API can read every user's email and delete accounts, so this
   pins: every route is owner-only, destructive commands need explicit
   confirmation and never leave a deleted user being billed, the owner
   account can't be deleted, commands leave an audit row, and the public
   client-error endpoint is throttled and size-capped. */
const Module = require('module');
const path = require('path');

process.env.STRIPE_SECRET_KEY = 'sk_test_stub';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_stub';
process.env.STRIPE_PRICE_BASE = 'price_base';
process.env.STRIPE_PRICE_PREMIUM = 'price_premium';
process.env.SUPABASE_URL = 'https://stub.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'stub-key';
process.env.PUBLIC_SITE_URL = 'https://tcg-speed-shipper.netlify.app';

const ops = [];      // every table write: [table, op, payload, filters]
const calls = [];    // rpc + auth admin + stripe calls
const state = {};
function reset() {
  ops.length = 0; calls.length = 0;
  state.profiles = [
    { id: 'u_owner', email: 'clujkeebs@aol.com', plan: 'premium', is_lifetime_free: true, created_at: '2026-08-01T00:00:00Z' },
    { id: 'u_paid', email: 'paid@example.com', plan: 'base', is_lifetime_free: false, stripe_customer_id: 'cus_paid', subscription_status: 'active', created_at: '2026-09-20T00:00:00Z' },
    { id: 'u_free', email: 'free@example.com', plan: 'free', is_lifetime_free: false, created_at: '2026-09-25T00:00:00Z' },
  ];
  state.liveSubs = { cus_paid: [{ id: 'sub_paid', status: 'active', customer: 'cus_paid', items: { data: [{ id: 'si', price: { id: 'price_base', unit_amount: 199 } }] } }] };
  state.prepare = { ok: true };
}
reset();

function builder(table) {
  const q = { filters: {}, op: 'select', payload: null };
  const chain = ['select', 'eq', 'in', 'gte', 'lte', 'order', 'limit'];
  chain.forEach((m) => { q[m] = (k, v) => { if (m === 'eq') q.filters[k] = v; return q; }; });
  const rows = () => (table === 'tcgss_profiles' ? state.profiles : []);
  const result = () => {
    if (q.op !== 'select') { ops.push([table, q.op, q.payload, q.filters]); return { data: null, error: null }; }
    let r = rows();
    if (q.filters.id) r = r.filter((p) => p.id === q.filters.id);
    return { data: r, error: null, count: r.length };
  };
  q.update = (p) => { q.op = 'update'; q.payload = p; return q; };
  q.delete = () => { q.op = 'delete'; return q; };
  q.insert = async (p) => { ops.push([table, 'insert', p, {}]); return { error: null }; };
  q.upsert = async (p) => { ops.push([table, 'upsert', p, {}]); return { error: null }; };
  q.maybeSingle = async () => { const r = result(); return { data: Array.isArray(r.data) ? (r.data[0] || null) : r.data, error: null }; };
  q.then = (resolve, reject) => Promise.resolve(result()).then(resolve, reject);
  return q;
}

const supabaseStub = {
  from: (t) => builder(t),
  rpc: async (name, args) => {
    calls.push(['rpc', name, args]);
    if (name === 'tcgss_admin_prepare_user_delete') return { data: state.prepare, error: null };
    return { data: null, error: null };
  },
  auth: {
    getUser: async (token) => {
      if (token === 'owner-token') return { data: { user: { id: 'u_owner', email: 'clujkeebs@aol.com' } }, error: null };
      if (token === 'stranger-token') return { data: { user: { id: 'u_free', email: 'free@example.com' } }, error: null };
      return { data: { user: null }, error: new Error('invalid') };
    },
    admin: {
      listUsers: async () => ({ data: { users: state.profiles.map((p) => ({ id: p.id, email: p.email, created_at: p.created_at, email_confirmed_at: p.created_at })) }, error: null }),
      getUserById: async (id) => { const p = state.profiles.find((x) => x.id === id); return { data: { user: p ? { id: p.id, email: p.email } : null }, error: null }; },
      generateLink: async (o) => { calls.push(['generateLink', o]); return { data: { properties: { action_link: 'https://recover/link' } }, error: null }; },
      deleteUser: async (id) => { calls.push(['deleteUser', id]); return { error: null }; },
    },
  },
};

const stripeStub = {
  webhooks: { constructEvent: (b) => JSON.parse(b.toString('utf8')) },
  subscriptions: {
    list: async (p) => {
      if (p.customer) return { data: state.liveSubs[p.customer] || [] };
      return { data: Object.values(state.liveSubs).flat(), has_more: false };
    },
    cancel: async (id) => {
      calls.push(['stripe.cancel', id]);
      for (const k of Object.keys(state.liveSubs)) state.liveSubs[k] = state.liveSubs[k].filter((s) => s.id !== id);
      return { id, status: 'canceled' };
    },
  },
  invoices: { list: async () => ({ data: [{ amount_paid: 199 }, { amount_paid: 599 }], has_more: false }) },
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
    const payload = body === undefined ? null : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
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

let passed = 0, failed = 0;
function check(name, cond, extra) {
  if (cond) { passed++; console.log('  PASS  ' + name); }
  else { failed++; console.log('  FAIL  ' + name + (extra ? '  — ' + extra : '')); }
}
const OWNER = { Authorization: 'Bearer owner-token' };
const STRANGER = { Authorization: 'Bearer stranger-token' };
const audits = () => ops.filter((o) => o[0] === 'tcgss_event_log' && o[2].level === 'admin');

server.listen(0, async () => {
  try {
    console.log('\n-- Access control --');
    const routes = [
      ['GET', '/api/admin/overview'], ['GET', '/api/admin/users'], ['GET', '/api/admin/funnel'], ['GET', '/api/admin/events'], ['GET', '/api/admin/newsletter'],
      ['POST', '/api/admin/events/clear'], ['POST', '/api/admin/users/u_paid/grant-premium'], ['POST', '/api/admin/users/u_paid/revoke-free'],
      ['POST', '/api/admin/users/u_paid/reset-usage'], ['POST', '/api/admin/users/u_paid/sync'], ['POST', '/api/admin/users/u_paid/recovery-link'],
      ['POST', '/api/admin/users/u_paid/delete'],
    ];
    let allLocked = true, detail = '';
    for (const [m, u] of routes) {
      reset();
      const a = await req(m, u, m === 'POST' ? { days: 30, confirmEmail: 'paid@example.com' } : undefined);
      const b = await req(m, u, m === 'POST' ? { days: 30, confirmEmail: 'paid@example.com' } : undefined, STRANGER);
      if (a.status !== 401 || b.status !== 403 || ops.length || calls.length) { allLocked = false; detail += m + ' ' + u + ' ' + a.status + '/' + b.status + '; '; }
    }
    check('every admin route: 401 without a session, 403 for a non-owner, and nothing written', allLocked, detail);
    const also = await req('GET', '/.netlify/functions/api/admin/users', undefined, STRANGER);
    check('also locked under the Netlify function path', also.status === 403);

    console.log('\n-- Read views --');
    reset();
    let r = await req('GET', '/api/admin/overview', undefined, OWNER);
    check('overview counts plans without the owner', r.status === 200 && r.body.users.by_plan.base === 1 && r.body.users.by_plan.free === 1 && r.body.users.by_plan.premium === 0, JSON.stringify(r.body.users));
    check('overview MRR comes from Stripe', r.body.revenue && r.body.revenue.mrr_cents === 199 && r.body.revenue.paid_last_30d_cents === 798, JSON.stringify(r.body.revenue));
    r = await req('GET', '/api/admin/users', undefined, OWNER);
    check('users list includes every account with its email and plan', r.status === 200 && r.body.users.length === 3 && r.body.users.some((u) => u.email === 'paid@example.com' && u.plan === 'base'));

    console.log('\n-- Commands --');
    reset();
    r = await req('POST', '/api/admin/users/u_free/grant-premium', { days: 0 }, OWNER);
    check('grant-premium rejects a bad day count', r.status === 400);
    r = await req('POST', '/api/admin/users/u_free/grant-premium', { days: 30 }, OWNER);
    const upd = ops.find((o) => o[0] === 'tcgss_profiles' && o[1] === 'update');
    const days = upd && (new Date(upd[2].free_until) - Date.now()) / 864e5;
    check('grant-premium sets free_until ~30 days out on that user only', r.status === 200 && upd && upd[3].id === 'u_free' && days > 29.9 && days < 30.1, JSON.stringify(upd));
    check('and writes an audit row', audits().length === 1 && /grant-premium/.test(audits()[0][2].source));

    reset();
    r = await req('POST', '/api/admin/users/u_free/recovery-link', {}, OWNER);
    check('recovery link generated for the right email', r.body.link === 'https://recover/link' && calls.some((c) => c[0] === 'generateLink' && c[1].email === 'free@example.com'));

    reset();
    r = await req('POST', '/api/admin/users/nope/revoke-free', {}, OWNER);
    check('unknown user is a 404, nothing written', r.status === 404 && !ops.some((o) => o[0] === 'tcgss_profiles'));

    console.log('\n-- Delete --');
    reset();
    r = await req('POST', '/api/admin/users/u_paid/delete', { confirmEmail: 'wrong@example.com' }, OWNER);
    check('refused without the exact email typed back', r.status === 400 && !calls.some((c) => c[0] === 'deleteUser' || c[0] === 'stripe.cancel'));
    reset();
    r = await req('POST', '/api/admin/users/u_paid/delete', { confirmEmail: 'PAID@example.com ' }, OWNER);
    const cancelIdx = calls.findIndex((c) => c[0] === 'stripe.cancel');
    const delIdx = calls.findIndex((c) => c[0] === 'deleteUser');
    check('cancels the live subscription BEFORE deleting', r.status === 200 && cancelIdx !== -1 && delIdx > cancelIdx, JSON.stringify(calls));
    check('runs the reference cleanup first', calls.findIndex((c) => c[1] === 'tcgss_admin_prepare_user_delete') < delIdx);
    check('audited', audits().some((a) => /delete-user/.test(a[2].source)));
    reset();
    r = await req('POST', '/api/admin/users/u_owner/delete', { confirmEmail: 'clujkeebs@aol.com' }, OWNER);
    check('the owner account cannot be deleted', r.status === 400 && !calls.some((c) => c[0] === 'deleteUser'));
    reset(); state.prepare = { ok: false, reason: 'has_affiliate_earnings' };
    r = await req('POST', '/api/admin/users/u_free/delete', { confirmEmail: 'free@example.com' }, OWNER);
    check('refused when the database says no (e.g. affiliate earnings)', r.status === 400 && /affiliate/.test(r.body.error) && !calls.some((c) => c[0] === 'deleteUser'));

    console.log('\n-- Anonymous funnel events --');
    reset();
    r = await req('POST', '/api/e', { e: 'csv_loaded', s: 'reddit' });
    check('a known event is counted with its source', r.status === 202 && calls.some((c) => c[1] === 'tcgss_bump_event' && c[2].p_event === 'csv_loaded' && c[2].p_source === 'reddit'));
    reset();
    r = await req('POST', '/api/e', { e: 'visit', s: '<script>' });
    check('an unknown source is bucketed as "other"', calls.some((c) => c[1] === 'tcgss_bump_event' && c[2].p_source === 'other'));
    reset();
    r = await req('POST', '/api/e', { e: 'drop table', s: 'google' });
    check('an unknown event is rejected and nothing is written', r.status === 400 && !calls.some((c) => c[1] === 'tcgss_bump_event'));
    reset();
    r = await req('POST', '/api/e', { e: 'visit', s: 'google', email: 'x@y.z', ip: '1.2.3.4' });
    const bump = calls.find((c) => c[1] === 'tcgss_bump_event');
    check('only event + source ever reach the database', bump && Object.keys(bump[2]).sort().join() === 'p_event,p_source');

    console.log('\n-- Client error reports --');
    reset();
    r = await req('POST', '/api/client-error', { message: 'x'.repeat(5000), page: '/', where: 'app.js:1' }, { 'X-Forwarded-For': '203.0.113.50' });
    const row = ops.find((o) => o[0] === 'tcgss_event_log');
    check('stored, capped at 500 chars, no IP kept', r.status === 200 && row && row[2].message.length === 500 && !JSON.stringify(row[2]).includes('203.0.113.50'));
    r = await req('POST', '/api/client-error', {}, { 'X-Forwarded-For': '203.0.113.50' });
    check('empty report rejected', r.status === 400);
    let last;
    for (let i = 0; i < 31; i++) last = await req('POST', '/api/client-error', { message: 'boom' }, { 'X-Forwarded-For': '203.0.113.51' });
    check('throttled after 30 reports per IP', last.status === 429);
  } catch (e) { failed++; console.error(e); }
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  server.close();
  process.exit(failed ? 1 : 0);
});
