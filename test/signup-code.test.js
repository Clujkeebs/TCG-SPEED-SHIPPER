/* Sign-up email codes (signup-code.js). Off by default; with SIGNUP_EMAIL_CODE=on
   nothing is created until a 6-digit code emailed to the address is entered.
   Pins: no account or password write before the code is right; wrong guesses
   are limited; a code is single-use and expires; a real account is never
   touched and gets no email; stranded accounts can be claimed only with a
   code; resend has a cooldown and an hourly cap; a failed email leaves nothing
   behind. Supabase and Resend are stubbed, nothing touches the network. */
const Module = require('module');
const path = require('path');

process.env.STRIPE_SECRET_KEY = 'sk_test_stub';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_stub';
process.env.SUPABASE_URL = 'https://stub.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'stub-key';
process.env.PUBLIC_SITE_URL = 'https://tcg-speed-shipper.netlify.app';
process.env.RESEND_API_KEY = 're_test_123';
process.env.EMAIL_FROM = 'TCG Speed Shipper <hello@tcgspeedshipper.com>';
process.env.SIGNUP_EMAIL_CODE = 'on';

const state = { existing: null, created: [], passwordWrites: [] };
const rows = new Map(); // tcgss_signup_codes, keyed by email
const sent = [];        // every email the Resend stub received
let resendStatus = 200;

function tableBuilder() {
  const q = { op: 'select', filters: {}, patch: null, wantRows: false };
  q.select = () => { if (q.op === 'delete') q.wantRows = true; return q; };
  q.eq = (k, v) => { q.filters[k] = v; return q; };
  q.maybeSingle = async () => ({ data: rows.get(q.filters.email) || null, error: null });
  q.upsert = async (r) => { rows.set(r.email, Object.assign({}, r)); return { error: null }; };
  q.insert = async () => ({ error: null });
  q.update = (p) => { q.op = 'update'; q.patch = p; return q; };
  q.delete = () => { q.op = 'delete'; return q; };
  q.then = (resolve) => {
    const row = rows.get(q.filters.email);
    const match = !!row && (q.filters.code_hash === undefined || row.code_hash === q.filters.code_hash);
    const out = { data: null, error: null };
    if (q.op === 'update' && match) Object.assign(row, q.patch);
    if (q.op === 'delete') {
      if (match) rows.delete(q.filters.email);
      if (q.wantRows) out.data = match ? [{ email: q.filters.email }] : [];
    }
    return Promise.resolve(out).then(resolve);
  };
  return q;
}

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
  from: () => tableBuilder(),
};

// Fake Resend.
global.fetch = async (url, init) => {
  if (String(url) === 'https://api.resend.com/emails') {
    const body = JSON.parse(init.body);
    if (resendStatus !== 200) return { ok: false, status: resendStatus, json: async () => ({ message: 'The domain is not verified' }) };
    sent.push({ to: body.to, from: body.from, subject: body.subject, text: body.text, html: body.html });
    return { ok: true, status: 200, json: async () => ({ id: 'em_' + sent.length }) };
  }
  return { ok: false, status: 404, json: async () => ({}) };
};

const origLoad = Module._load;
Module._load = function (request) {
  if (request === 'stripe') return function StripeStub() { return { webhooks: {} }; };
  if (request === '@supabase/supabase-js') return { createClient: () => supabaseStub };
  return origLoad.apply(this, arguments);
};
const app = require(path.join(__dirname, '..', 'server.js'));
Module._load = origLoad;
const signupCode = require(path.join(__dirname, '..', 'signup-code.js'));

const http = require('http');
const server = http.createServer(app);
function post(urlPath, body, ip) {
  return new Promise((resolve, reject) => {
    const payload = Buffer.from(JSON.stringify(body));
    const r = http.request({
      host: '127.0.0.1', port: server.address().port, method: 'POST', path: urlPath,
      headers: { 'Content-Type': 'application/json', 'Content-Length': payload.length, 'x-forwarded-for': ip || ('10.1.0.' + Math.floor(Math.random() * 250)) },
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
const reset = (existing) => { state.existing = existing || null; state.created.length = 0; state.passwordWrites.length = 0; rows.clear(); sent.length = 0; resendStatus = 200; };
const lastCode = () => { const m = sent.length && /^(\d{6}) is your/.exec(sent[sent.length - 1].subject); return m ? m[1] : null; };
const account = (over) => Object.assign({ id: 'existing_1', email: 'someone@example.com', created_at: '2026-08-14T21:35:21Z', email_confirmed_at: '2026-08-14T21:40:00Z', user_metadata: {} }, over);
const PW = 'correcthorse';

(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));

  console.log('\n-- Mode (what /api/health reports) --');
  check('off unless SIGNUP_EMAIL_CODE=on', signupCode.mode({}) === 'off' && signupCode.mode({ SIGNUP_EMAIL_CODE: 'yes' }) === 'off');
  check('on with a verified sender', signupCode.mode({ SIGNUP_EMAIL_CODE: 'on', EMAIL_FROM: 'Me <hello@tcgspeedshipper.com>' }) === 'on');
  check('flags the Resend test sender, which only reaches the owner', signupCode.mode({ SIGNUP_EMAIL_CODE: 'on', EMAIL_FROM: 'x <onboarding@resend.dev>' }) === 'on_default_sender' && signupCode.mode({ SIGNUP_EMAIL_CODE: 'on' }) === 'on_default_sender');

  console.log('\n-- Step 1: a brand new email --');
  reset(null);
  let r = await post('/api/signup', { email: 'New@Example.com', password: PW });
  check('asks for a code', r.status === 200 && r.body.needsCode === true, JSON.stringify(r.body));
  check('no account yet, no password written', state.created.length === 0 && state.passwordWrites.length === 0);
  check('exactly one email, to that one address, from the verified sender', sent.length === 1 && sent[0].to.length === 1 && sent[0].to[0] === 'new@example.com' && /hello@tcgspeedshipper\.com/.test(sent[0].from));
  const code1 = lastCode();
  check('the subject carries a 6-digit code and the body repeats it', /^\d{6}$/.test(code1 || '') && sent[0].text.includes(code1) && sent[0].html.includes(code1));
  const stored = rows.get('new@example.com');
  check('only a hash is stored, never the code or the password', stored && !JSON.stringify(stored).includes(code1) && !JSON.stringify(stored).includes(PW) && /^[0-9a-f]{64}$/.test(stored.code_hash));
  check('the code expires in about 10 minutes', Math.abs(Date.parse(stored.expires_at) - Date.now() - 10 * 60 * 1000) < 5000);
  r = await post('/api/signup', { email: 'new@example.com', password: PW });
  check('asking again right away does not send another email', r.status === 200 && r.body.needsCode === true && sent.length === 1);

  console.log('\n-- Step 2: wrong codes, then the right one --');
  const wrong = code1 === '000000' ? '111111' : '000000';
  r = await post('/api/signup/verify', { email: 'new@example.com', password: PW, code: wrong });
  check('a wrong code is refused and counted', r.status === 400 && /4 tries left/.test(r.body.error) && rows.get('new@example.com').attempts === 1, JSON.stringify(r.body));
  check('still no account', state.created.length === 0);
  r = await post('/api/signup/verify', { email: 'new@example.com', password: PW, code: 'abc' });
  check('a non-numeric code is refused before anything is checked', r.status === 400 && /6-digit/.test(r.body.error));
  r = await post('/api/signup/verify', { email: 'new@example.com', password: 'short', code: code1 });
  check('a short password is refused', r.status === 400 && /8 characters/.test(r.body.error));
  r = await post('/api/signup/verify', { email: 'new@example.com', password: PW, code: code1 });
  check('the right code creates the account', r.status === 200 && r.body.ok === true, JSON.stringify(r.body));
  check('created already confirmed and tagged as having a real password', state.created.length === 1 && state.created[0].email === 'new@example.com' && state.created[0].email_confirm === true && state.created[0].user_metadata.password_set_by_user === true);
  check('the code is gone once used', !rows.has('new@example.com'));
  r = await post('/api/signup/verify', { email: 'new@example.com', password: PW, code: code1 });
  check('the same code cannot be used twice', r.status === 400 && /expired/.test(r.body.error) && state.created.length === 1);

  console.log('\n-- Guessing is limited --');
  reset(null);
  await post('/api/signup', { email: 'guess@example.com', password: PW });
  const real = lastCode();
  const bad = real === '123456' ? '654321' : '123456';
  let last;
  for (let i = 0; i < 5; i++) last = await post('/api/signup/verify', { email: 'guess@example.com', password: PW, code: bad });
  check('five wrong codes burn the code', last.status === 400 && /Too many wrong codes/.test(last.body.error) && !rows.has('guess@example.com'), JSON.stringify(last.body));
  r = await post('/api/signup/verify', { email: 'guess@example.com', password: PW, code: real });
  check('even the right code no longer works after that', r.status === 400 && state.created.length === 0, JSON.stringify(r.body));

  console.log('\n-- Expiry --');
  reset(null);
  await post('/api/signup', { email: 'late@example.com', password: PW });
  const lateCode = lastCode();
  rows.get('late@example.com').expires_at = new Date(Date.now() - 1000).toISOString();
  r = await post('/api/signup/verify', { email: 'late@example.com', password: PW, code: lateCode });
  check('an expired code is refused', r.status === 400 && /expired/.test(r.body.error) && state.created.length === 0, JSON.stringify(r.body));

  console.log('\n-- Existing accounts --');
  reset(account({ created_at: '2026-08-14T21:35:21Z', user_metadata: { password_set_by_user: true } }));
  r = await post('/api/signup', { email: 'someone@example.com', password: 'attackerpass' });
  check('a real account is refused, and gets no email (no email bombing)', r.status === 409 && sent.length === 0 && rows.size === 0, JSON.stringify(r.body));
  reset(account({ created_at: '2026-09-11T10:00:00Z', user_metadata: {} }));
  r = await post('/api/signup', { email: 'someone@example.com', password: 'attackerpass' });
  check('a confirmed account made after password auth shipped is refused', r.status === 409 && sent.length === 0 && state.passwordWrites.length === 0);

  console.log('\n-- Stranded accounts can be claimed, but only with a code --');
  reset(account({ created_at: '2026-08-14T21:35:21Z', user_metadata: {} }));
  r = await post('/api/signup', { email: 'someone@example.com', password: 'newpassword1' });
  check('a legacy account gets a code first', r.status === 200 && r.body.needsCode === true && sent.length === 1);
  check('and its password is NOT changed yet', state.passwordWrites.length === 0);
  r = await post('/api/signup/verify', { email: 'someone@example.com', password: 'newpassword1', code: lastCode() });
  check('the code sets the password, confirms, and tags it', r.status === 200 && r.body.repaired === true && state.passwordWrites.length === 1 && state.passwordWrites[0].p.password === 'newpassword1' && state.passwordWrites[0].p.email_confirm === true && state.passwordWrites[0].p.user_metadata.password_set_by_user === true, JSON.stringify([r.body, state.passwordWrites]));
  reset(account({ created_at: '2026-10-01T10:00:00Z', email_confirmed_at: null, user_metadata: {} }));
  r = await post('/api/signup', { email: 'someone@example.com', password: 'newpassword1' });
  check('an unconfirmed account (a stuck sign-up) can be claimed with a code', r.status === 200 && r.body.needsCode === true && sent.length === 1);
  r = await post('/api/signup/verify', { email: 'someone@example.com', password: 'newpassword1', code: lastCode() });
  check('and the code takes it over only after proving the email', r.status === 200 && state.passwordWrites.length === 1);

  console.log('\n-- A real account appears between the two steps --');
  reset(null);
  await post('/api/signup', { email: 'race@example.com', password: PW });
  const raceCode = lastCode();
  state.existing = account({ email: 'race@example.com', created_at: '2026-10-14T10:00:00Z', user_metadata: { password_set_by_user: true } });
  r = await post('/api/signup/verify', { email: 'race@example.com', password: 'attackerpass', code: raceCode });
  check('verify re-checks and refuses to touch it', r.status === 409 && state.passwordWrites.length === 0 && state.created.length === 0, JSON.stringify(r.body));

  console.log('\n-- Resend --');
  reset(null);
  r = await post('/api/signup/resend', { email: 'nobody@example.com' });
  check('resend needs a recent sign-up for that email', r.status === 400 && sent.length === 0);
  await post('/api/signup', { email: 'again@example.com', password: PW });
  const first = lastCode();
  r = await post('/api/signup/resend', { email: 'again@example.com' });
  check('resend inside the cooldown is refused', r.status === 429 && sent.length === 1, JSON.stringify(r.body));
  rows.get('again@example.com').created_at = new Date(Date.now() - 60 * 1000).toISOString();
  r = await post('/api/signup/resend', { email: 'again@example.com' });
  check('after the cooldown a new code goes out', r.status === 200 && sent.length === 2 && lastCode() !== null, JSON.stringify(r.body));
  const second = lastCode();
  if (first !== second) {
    r = await post('/api/signup/verify', { email: 'again@example.com', password: PW, code: first });
    check('the old code stops working', r.status === 400 && state.created.length === 0);
  } else check('the old code stops working (new code happened to match; skipped)', true);
  for (let i = 0; i < 6; i++) {
    rows.get('again@example.com').created_at = new Date(Date.now() - 60 * 1000).toISOString();
    r = await post('/api/signup/resend', { email: 'again@example.com' }, '10.9.0.' + i);
  }
  check('an email gets at most 5 codes an hour', r.status === 429 && /Too many codes/.test(r.body.error) && sent.length === 5, JSON.stringify([r.status, r.body, sent.length]));

  console.log('\n-- If the email cannot be sent --');
  reset(null);
  resendStatus = 403;
  r = await post('/api/signup', { email: 'fail@example.com', password: PW });
  check('the person is told to retry, and nothing is left behind', r.status === 503 && /could not send/i.test(r.body.error) && !rows.has('fail@example.com') && state.created.length === 0, JSON.stringify(r.body));
  resendStatus = 200;

  console.log('\n-- Off means off --');
  process.env.SIGNUP_EMAIL_CODE = 'off';
  reset(null);
  r = await post('/api/signup/verify', { email: 'x@example.com', password: PW, code: '123456' });
  check('verify and resend do not exist while the flag is off', r.status === 404);
  r = await post('/api/signup/resend', { email: 'x@example.com' });
  check('resend neither', r.status === 404);
  r = await post('/api/signup', { email: 'plain@example.com', password: PW });
  check('sign-up works exactly as before: confirmed at once, no email', r.status === 200 && r.body.ok === true && !r.body.needsCode && state.created.length === 1 && state.created[0].email_confirm === true && sent.length === 0, JSON.stringify(r.body));

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  server.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
