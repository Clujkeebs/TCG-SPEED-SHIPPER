/* Sign-up email codes: a person proves they own the email before an account
   exists. Off until SIGNUP_EMAIL_CODE=on in Railway (turn it on only after
   tcgspeedshipper.com is verified in Resend and EMAIL_FROM is set; until then
   Resend only delivers to the owner's own address).

   Flow (nothing is created until the code is right, so there are no half-made
   or unconfirmed accounts, and the password is never stored):
     1. POST /api/signup           email + password (+ Turnstile) -> emails a
                                    6-digit code, returns { needsCode: true }.
     2. POST /api/signup/verify    email + password + code -> creates the
                                    confirmed account (or claims a stranded one).
     3. POST /api/signup/resend    email -> a fresh code (cooldown and hourly cap).

   Limits: a code lasts 10 minutes, allows 5 wrong guesses, is single-use, and
   an email gets at most 5 codes an hour with 45 seconds between them. Codes are
   stored only as an HMAC, in a server-only table (tcgss_signup_codes). */
const crypto = require('crypto');
const { emailConfig, sendEmail } = require('./email');

const TABLE = 'tcgss_signup_codes';
const CODE_TTL_MS = 10 * 60 * 1000;
const RESEND_COOLDOWN_MS = 45 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const MAX_SENDS_PER_HOUR = 5;
const MAX_ATTEMPTS = 5;

const EXISTS_MSG = 'An account with that email already exists — log in instead, or use Forgot Password if you don’t know the password.';
const EXPIRED_MSG = 'That code has expired. Click Create Account to get a new one.';

// 'off' | 'on' | 'on_default_sender' (flag on, but EMAIL_FROM is still the
// Resend test sender, so only the owner's own address can receive codes) |
// 'on_no_email_key' (flag on, but RESEND_API_KEY is missing).
function mode(env = process.env) {
  if (env.SIGNUP_EMAIL_CODE !== 'on') return 'off';
  if (!emailConfig().configured) return 'on_no_email_key';
  if (!env.EMAIL_FROM || /@resend\.dev/i.test(env.EMAIL_FROM)) return 'on_default_sender';
  return 'on';
}
const enabled = (env = process.env) => env.SIGNUP_EMAIL_CODE === 'on';

const makeCode = () => String(crypto.randomInt(0, 1000000)).padStart(6, '0');
function hashCode(email, code, env = process.env) {
  const secret = env.SIGNUP_CODE_SECRET || env.SUPABASE_SERVICE_ROLE_KEY || '';
  return crypto.createHmac('sha256', secret).update(email + ':' + code).digest('hex');
}
function sameHash(a, b) {
  const x = Buffer.from(String(a), 'hex'), y = Buffer.from(String(b), 'hex');
  return x.length > 0 && x.length === y.length && crypto.timingSafeEqual(x, y);
}

function emailContent(code) {
  const text = 'Your TCG Speed Shipper sign-up code is ' + code + '.\n\nIt works for 10 minutes. If you did not try to create an account, you can ignore this email.\n\nTCG Speed Shipper\n';
  const html = '<!doctype html><html><head><meta charset="utf-8"><meta name="color-scheme" content="light only"><meta name="supported-color-schemes" content="light only"></head>' +
    '<body style="margin:0;padding:24px;background:#f4f4f5;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#1a1a1a;">' +
    '<div style="max-width:420px;margin:0 auto;background:#ffffff;border-radius:10px;padding:26px;">' +
    '<p style="margin:0 0 14px;font-size:16px;line-height:1.5;">Your TCG Speed Shipper sign-up code:</p>' +
    '<p style="margin:0 0 18px;font-size:34px;letter-spacing:6px;font-weight:700;">' + code + '</p>' +
    '<p style="margin:0;font-size:13px;line-height:1.5;color:#52525b;">It works for 10 minutes. If you did not try to create an account, you can ignore this email.</p>' +
    '</div></body></html>';
  return { subject: code + ' is your TCG Speed Shipper code', text, html };
}

module.exports = function makeSignupCode(d) {
  const { logError, findAuthUserId, makeThrottle, getClientIp, EMAIL_RE, LEGACY_ACCOUNT_CUTOFF } = d;
  const db = () => d.db();
  const tooManyChecks = makeThrottle(30, 10 * 60 * 1000);
  const tooManyResends = makeThrottle(10, 10 * 60 * 1000);

  async function getRow(email) {
    const { data, error } = await db().from(TABLE).select('*').eq('email', email).maybeSingle();
    if (error) throw error;
    return data || null;
  }
  async function dropRow(email) {
    try { await db().from(TABLE).delete().eq('email', email); } catch (e) { /* best effort */ }
  }

  // new: no account yet. claim: an old or stranded account nobody has a real
  // password for (the same two gates the password-repair path always used).
  // exists: a real account; never touched.
  async function eligibility(email) {
    const id = await findAuthUserId(email);
    if (!id) return { kind: 'new' };
    const { data, error } = await db().auth.admin.getUserById(id);
    if (error) throw error;
    const u = (data && data.user) || null;
    const meta = (u && u.user_metadata) || {};
    const createdAt = u && u.created_at ? new Date(u.created_at) : null;
    const predates = !!createdAt && createdAt < LEGACY_ACCOUNT_CUTOFF;
    const unconfirmed = !(u && u.email_confirmed_at);
    if (!meta.password_set_by_user && (predates || unconfirmed)) return { kind: 'claim', id, meta };
    return { kind: 'exists' };
  }

  // Makes and sends a fresh code, unless one was just sent or the hourly cap is
  // hit. Returns { sent: true } | { sent: false, reason: 'cooldown' | 'cap' }.
  async function issue(email, prev) {
    const now = Date.now();
    if (prev && now - Date.parse(prev.created_at) < RESEND_COOLDOWN_MS && Date.parse(prev.expires_at) > now) return { sent: false, reason: 'cooldown' };
    const inWindow = prev && now - Date.parse(prev.window_start) < HOUR_MS;
    if (inWindow && prev.sends >= MAX_SENDS_PER_HOUR) return { sent: false, reason: 'cap' };
    const code = makeCode();
    const { error } = await db().from(TABLE).upsert({
      email,
      code_hash: hashCode(email, code),
      expires_at: new Date(now + CODE_TTL_MS).toISOString(),
      attempts: 0,
      sends: inWindow ? prev.sends + 1 : 1,
      window_start: inWindow ? prev.window_start : new Date(now).toISOString(),
      created_at: new Date(now).toISOString(),
    }, { onConflict: 'email' });
    if (error) throw error;
    const c = emailContent(code);
    try {
      await sendEmail({ to: email, subject: c.subject, text: c.text, html: c.html });
    } catch (e) {
      await dropRow(email);
      const err = new Error('code email failed: ' + (e && e.message));
      err.emailFailed = true;
      throw err;
    }
    return { sent: true };
  }

  const sendFailed = (res) => res.status(503).json({ error: 'We could not send the email right now. Please try again in a few minutes.' });

  // Step 1, called from POST /signup once the Turnstile and field checks pass.
  async function start(res, email) {
    if (!emailConfig().configured) return res.status(503).json({ error: 'Sign-up email is not set up yet. Please try again later.' });
    try {
      const el = await eligibility(email);
      if (el.kind === 'exists') return res.status(409).json({ error: EXISTS_MSG });
      const r = await issue(email, await getRow(email));
      if (!r.sent && r.reason === 'cap') return res.status(429).json({ error: 'Too many codes for this email. Try again in an hour.' });
      // Cooldown: a code was just sent, so say so instead of sending another.
      return res.json({ ok: true, needsCode: true });
    } catch (err) {
      if (err && err.emailFailed) { await logError('signup.code', err.message); return sendFailed(res); }
      throw err;
    }
  }

  // Step 3: a fresh code. No Turnstile here, so it needs a recent step 1 for
  // this email (a row from the last hour) and obeys the same caps.
  async function resend(req, res) {
    if (!enabled()) return res.status(404).json({ error: 'Not available' });
    try {
      if (tooManyResends(getClientIp(req))) return res.status(429).json({ error: 'Too many attempts — try again in a few minutes.' });
      const email = String((req.body && req.body.email) || '').trim().toLowerCase();
      if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'Enter a valid email.' });
      if (!emailConfig().configured) return res.status(503).json({ error: 'Sign-up email is not set up yet. Please try again later.' });
      const prev = await getRow(email);
      if (!prev || Date.now() - Date.parse(prev.window_start) >= HOUR_MS) return res.status(400).json({ error: 'Click Create Account to start again.' });
      const el = await eligibility(email);
      if (el.kind === 'exists') return res.status(409).json({ error: EXISTS_MSG });
      const r = await issue(email, prev);
      if (!r.sent && r.reason === 'cap') return res.status(429).json({ error: 'Too many codes for this email. Try again in an hour.' });
      if (!r.sent) return res.status(429).json({ error: 'A code was just sent. Wait a minute before asking for another.' });
      return res.json({ ok: true });
    } catch (err) {
      if (err && err.emailFailed) { await logError('signup.code', err.message); return sendFailed(res); }
      await logError('signup.code', 'resend failed:', err && err.message);
      return res.status(500).json({ error: 'Could not send a new code' });
    }
  }

  // Step 2: check the code, then create (or claim) the account.
  async function verify(req, res) {
    if (!enabled()) return res.status(404).json({ error: 'Not available' });
    try {
      if (tooManyChecks(getClientIp(req))) return res.status(429).json({ error: 'Too many attempts — try again in a few minutes.' });
      const b = req.body || {};
      const email = String(b.email || '').trim().toLowerCase();
      const password = String(b.password || '');
      const code = String(b.code || '').trim();
      if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'Enter a valid email.' });
      if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });
      if (!/^\d{6}$/.test(code)) return res.status(400).json({ error: 'Enter the 6-digit code from the email.' });

      const row = await getRow(email);
      if (!row) return res.status(400).json({ error: EXPIRED_MSG });
      if (Date.parse(row.expires_at) < Date.now()) { await dropRow(email); return res.status(400).json({ error: EXPIRED_MSG }); }
      if (row.attempts >= MAX_ATTEMPTS) { await dropRow(email); return res.status(400).json({ error: 'Too many wrong codes. Click Create Account to get a new one.' }); }

      if (!sameHash(row.code_hash, hashCode(email, code))) {
        const left = MAX_ATTEMPTS - (row.attempts + 1);
        if (left <= 0) { await dropRow(email); return res.status(400).json({ error: 'Too many wrong codes. Click Create Account to get a new one.' }); }
        await db().from(TABLE).update({ attempts: row.attempts + 1 }).eq('email', email);
        return res.status(400).json({ error: 'That code isn’t right. ' + left + (left === 1 ? ' try' : ' tries') + ' left.' });
      }

      // Single use: whoever deletes the row owns the code.
      const { data: used, error: delErr } = await db().from(TABLE).delete().eq('email', email).eq('code_hash', row.code_hash).select('email');
      if (delErr) throw delErr;
      if (!used || !used.length) return res.status(400).json({ error: EXPIRED_MSG });

      const el = await eligibility(email);
      if (el.kind === 'exists') return res.status(409).json({ error: EXISTS_MSG });
      if (el.kind === 'claim') {
        const { error } = await db().auth.admin.updateUserById(el.id, {
          password, email_confirm: true,
          user_metadata: Object.assign({}, el.meta, { password_set_by_user: true }),
        });
        if (error) throw error;
        return res.json({ ok: true, repaired: true });
      }
      const { error: createErr } = await db().auth.admin.createUser({
        email, password, email_confirm: true,
        user_metadata: { password_set_by_user: true },
      });
      if (createErr) {
        if (/already.*registered|already.*exists/i.test(createErr.message || '')) return res.status(409).json({ error: EXISTS_MSG });
        throw createErr;
      }
      return res.json({ ok: true });
    } catch (err) {
      await logError('signup.code', 'verify failed:', err && err.message);
      return res.status(500).json({ error: 'Could not create account' });
    }
  }

  return { enabled, mode, start, verify, resend };
};

module.exports.mode = mode;
module.exports.hashCode = hashCode;
module.exports.makeCode = makeCode;
module.exports.emailContent = emailContent;
