/* Newsletter signup and unsubscribe (server.js). Pinned: the list can't be
   probed or spammed through the form, and a link scanner opening the
   unsubscribe link (GET) never removes anyone; only the button (POST) does. */
const Module = require('module');
const path = require('path');

process.env.STRIPE_SECRET_KEY = 'sk_test_stub';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_stub';
process.env.SUPABASE_URL = 'https://stub.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'stub-key';
process.env.PUBLIC_SITE_URL = 'https://tcgspeedshipper.com';

const state = { upserts: [], updates: [], failNext: false };
const supabaseStub = {
  auth: { admin: {}, getUser: async () => ({ data: {}, error: null }) },
  rpc: async () => ({ data: null, error: null }),
  from: (table) => ({
    upsert: async (row, opts) => {
      if (state.failNext) { state.failNext = false; return { error: new Error('db down') }; }
      state.upserts.push({ table, row, opts }); return { error: null };
    },
    update: (row) => ({ eq: async (col, val) => { state.updates.push({ table, row, col, val }); return { error: null }; } }),
    insert: async () => ({ error: null }),
  }),
};

const origLoad = Module._load;
Module._load = function (request) {
  if (request === 'stripe') return function StripeStub() { return { webhooks: {} }; };
  if (request === '@supabase/supabase-js') return { createClient: () => supabaseStub };
  return origLoad.apply(this, arguments);
};
const app = require(path.join(__dirname, '..', 'server.js'));
Module._load = origLoad;

const http = require('http');
const server = http.createServer(app);
function req(method, urlPath, body, opts) {
  opts = opts || {};
  return new Promise((resolve, reject) => {
    const payload = body == null ? null : Buffer.from(opts.form ? body : JSON.stringify(body));
    const headers = { 'x-forwarded-for': opts.ip || ('10.1.0.' + Math.floor(Math.random() * 250)) };
    if (payload) { headers['Content-Type'] = opts.form ? 'application/x-www-form-urlencoded' : 'application/json'; headers['Content-Length'] = payload.length; }
    const r = http.request({ host: '127.0.0.1', port: server.address().port, method, path: urlPath, headers }, (res) => {
      let d = ''; res.on('data', (c) => { d += c; });
      res.on('end', () => { let j; try { j = JSON.parse(d); } catch (e) { j = d; } resolve({ status: res.statusCode, body: j }); });
    });
    r.on('error', reject); if (payload) r.write(payload); r.end();
  });
}

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (detail ? '\n        ' + detail : '')); }
}
const TOKEN = '3f2b8a4e-1c2d-4e5f-8a9b-0c1d2e3f4a5b';

server.listen(0, async () => {
  try {
    console.log('\n-- Subscribe --');
    let r = await req('POST', '/api/newsletter/subscribe', { email: '  Seller@Example.COM ', source: 'blog' });
    check('valid email is accepted', r.status === 200 && r.body.ok === true, JSON.stringify(r.body));
    const u = state.upserts[0];
    check('stored lowercased and trimmed', u && u.row.email === 'seller@example.com');
    check('upsert on email re-subscribes instead of duplicating', u && u.opts.onConflict === 'email' && u.row.status === 'subscribed' && u.row.unsubscribed_at === null);
    check('source kept when known', u && u.row.source === 'blog');
    check('IP is stored hashed, never raw', u && /^[0-9a-f]{64}$/.test(u.row.ip_hash));
    check('unsub token is not client-controlled', u && !('unsub_token' in u.row));

    await req('POST', '/api/newsletter/subscribe', { email: 'a@b.co', source: 'evil<script>' });
    check('unknown source becomes "other"', state.upserts[1] && state.upserts[1].row.source === 'other');
    await req('POST', '/api/newsletter/subscribe', { email: 'c@d.co', source: 'post_download' });
    await req('POST', '/api/newsletter/subscribe', { email: 'e@f.co', source: 'newsletter_page' });
    check('post-download popup and /newsletter page sources are kept', state.upserts[2] && state.upserts[2].row.source === 'post_download' && state.upserts[3] && state.upserts[3].row.source === 'newsletter_page');

    r = await req('POST', '/api/newsletter/subscribe', { email: 'not-an-email' });
    check('invalid email rejected', r.status === 400);

    const before = state.upserts.length;
    r = await req('POST', '/api/newsletter/subscribe', { email: 'bot@spam.io', website: 'http://spam' });
    check('honeypot: answers ok but stores nothing', r.status === 200 && state.upserts.length === before);

    let last;
    for (let i = 0; i < 6; i++) last = await req('POST', '/api/newsletter/subscribe', { email: 'x' + i + '@y.co' }, { ip: '10.9.9.9' });
    check('6th signup from one IP in 10 min is throttled', last.status === 429);

    state.failNext = true;
    r = await req('POST', '/api/newsletter/subscribe', { email: 'dbdown@y.co' });
    check('database error → 500, no crash', r.status === 500);

    console.log('\n-- Unsubscribe --');
    r = await req('GET', '/api/newsletter/unsubscribe?t=' + TOKEN);
    check('GET shows a confirm button', r.status === 200 && /<form method="post">/.test(r.body) && r.body.includes(TOKEN));
    check('GET changes nothing (link scanners)', state.updates.length === 0);

    r = await req('GET', '/api/newsletter/unsubscribe?t=%22%3E%3Cscript%3E');
    check('GET with a bad token: 400, token not echoed', r.status === 400 && !/<script>/.test(r.body));

    r = await req('POST', '/api/newsletter/unsubscribe', 't=' + TOKEN, { form: true });
    const up = state.updates[0];
    check('POST unsubscribes by token', r.status === 200 && up && up.col === 'unsub_token' && up.val === TOKEN && up.row.status === 'unsubscribed' && !!up.row.unsubscribed_at);

    r = await req('POST', '/api/newsletter/unsubscribe', 't=nope', { form: true });
    check('POST with a bad token: 400, nothing updated', r.status === 400 && state.updates.length === 1);
  } catch (e) {
    fail++; console.log('  FAIL  threw: ' + e.stack);
  }
  server.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
});
