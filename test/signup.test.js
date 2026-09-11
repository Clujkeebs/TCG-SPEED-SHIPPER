/* The signup collision handler can overwrite an existing account's password.
   That is correct for accounts stranded by the old passwordless flow and is an
   account takeover for anything else, so the two conditions that gate it are
   pinned here. */
const Module = require('module');
const path = require('path');

process.env.STRIPE_SECRET_KEY = 'sk_test_stub';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_stub';
process.env.SUPABASE_URL = 'https://stub.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'stub-key';
process.env.PUBLIC_SITE_URL = 'https://tcg-speed-shipper.netlify.app';

const state = { existing: null, created: [], passwordWrites: [] };

const supabaseStub = {
  auth: {
    admin: {
      createUser: async (p) => {
        if (state.existing && state.existing.email.toLowerCase() === p.email.toLowerCase()) {
          return { error: new Error('A user with this email address has already been registered') };
        }
        state.created.push(p);
        return { data: { user: { id: 'new_user' } }, error: null };
      },
      getUserById: async () => ({ data: { user: state.existing }, error: null }),
      updateUserById: async (id, p) => { state.passwordWrites.push({ id, p }); return { error: null }; },
    },
  },
  rpc: async (name, args) => {
    if (name === 'tcgss_find_auth_user_id') {
      const hit = state.existing && state.existing.email.toLowerCase() === String(args.p_email).toLowerCase();
      return { data: hit ? state.existing.id : null, error: null };
    }
    return { data: null, error: null };
  },
  from: () => ({ update: () => ({ eq: () => ({ eq: () => ({ then: (r) => r({ error: null }) }) }) }) }),
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

function post(urlPath, body, ip) {
  return new Promise((resolve, reject) => {
    const payload = Buffer.from(JSON.stringify(body));
    const r = http.request({
      host: '127.0.0.1', port: server.address().port, method: 'POST', path: urlPath,
      headers: { 'Content-Type': 'application/json', 'Content-Length': payload.length, 'x-forwarded-for': ip || ('10.0.0.' + Math.floor(Math.random() * 250)) },
    }, (res) => {
      let d = ''; res.on('data', (c) => { d += c; });
      res.on('end', () => { let j; try { j = JSON.parse(d); } catch (e) { j = d; } resolve({ status: res.statusCode, body: j }); });
    });
    r.on('error', reject); r.write(payload); r.end();
  });
}

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (detail ? '\n        ' + detail : '')); }
}

function account(over) {
  return Object.assign({
    id: 'existing_1', email: 'someone@example.com',
    created_at: '2026-08-14T21:35:21Z', user_metadata: {},
  }, over);
}

function reset(existing) { state.existing = existing || null; state.created.length = 0; state.passwordWrites.length = 0; }

(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));

  console.log('\n-- A brand new email --');
  reset(null);
  let res = await post('/api/signup', { email: 'New@Example.com', password: 'correcthorse' });
  check('account is created', res.status === 200 && res.body.ok === true, JSON.stringify(res.body));
  check('email is normalised to lowercase', state.created[0].email === 'new@example.com');
  check('created already confirmed, so no email is needed', state.created[0].email_confirm === true);
  check('tagged as having a real password', state.created[0].user_metadata.password_set_by_user === true);

  console.log('\n-- Stranded legacy account: no tag, created before password auth --');
  reset(account({ created_at: '2026-08-14T21:35:21Z', user_metadata: {} }));
  res = await post('/api/signup', { email: 'someone@example.com', password: 'newpassword1' });
  check('repaired', res.status === 200 && res.body.repaired === true, JSON.stringify(res.body));
  check('password was set', state.passwordWrites.length === 1 && state.passwordWrites[0].p.password === 'newpassword1');
  check('and tagged so it can never be repaired again',
    state.passwordWrites[0].p.user_metadata.password_set_by_user === true);

  console.log('\n-- Takeover attempt: untagged but created after password auth shipped --');
  reset(account({ created_at: '2026-09-11T10:00:00Z', user_metadata: {} }));
  res = await post('/api/signup', { email: 'someone@example.com', password: 'attackerpass' });
  check('refused', res.status === 409, JSON.stringify(res.body));
  check('no password was written', state.passwordWrites.length === 0);

  console.log('\n-- Takeover attempt: a normal account with a real password --');
  reset(account({ created_at: '2026-08-14T21:35:21Z', user_metadata: { password_set_by_user: true } }));
  res = await post('/api/signup', { email: 'someone@example.com', password: 'attackerpass' });
  check('refused', res.status === 409);
  check('no password was written', state.passwordWrites.length === 0);
  check('told to log in or reset instead', /log in|forgot password/i.test(res.body.error || ''), res.body.error);

  console.log('\n-- Case does not open a hole --');
  reset(account({ email: 'Someone@Example.com', created_at: '2026-09-11T10:00:00Z', user_metadata: {} }));
  res = await post('/api/signup', { email: 'SOMEONE@example.com', password: 'attackerpass' });
  check('a differently-cased address is still the same account', res.status === 409, JSON.stringify(res.body));
  check('no password was written', state.passwordWrites.length === 0);

  console.log('\n-- Input validation --');
  reset(null);
  res = await post('/api/signup', { email: 'not-an-email', password: 'longenough1' });
  check('rejects a malformed email', res.status === 400);
  res = await post('/api/signup', { email: 'a@b.co', password: 'short' });
  check('rejects a short password', res.status === 400 && /8 characters/.test(res.body.error || ''));
  res = await post('/api/signup', {});
  check('rejects an empty body', res.status === 400);
  check('nothing was created by any invalid request', state.created.length === 0);

  console.log('\n-- Abuse throttle --');
  reset(null);
  let last;
  for (let i = 0; i < 12; i++) last = await post('/api/signup', { email: 'flood' + i + '@example.com', password: 'longenough1' }, '203.0.113.9');
  check('a burst from one address is throttled', last.status === 429, JSON.stringify(last.body));

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  server.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
