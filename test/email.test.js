// email.js: Resend send, with a stubbed fetch (no network).
const { sendEmail, emailConfig } = require('../email');

let pass = 0, fail = 0;
function check(name, ok, extra) { if (ok) { pass++; console.log('  PASS  ' + name); } else { fail++; console.log('  FAIL  ' + name + (extra ? ' :: ' + extra : '')); } }

(async () => {
  delete process.env.RESEND_API_KEY; delete process.env.EMAIL_FROM;
  check('off without a key', emailConfig().configured === false);
  let err = null;
  try { await sendEmail({ to: 'a@b.co', subject: 's', text: 't' }); } catch (e) { err = e; }
  check('sending without a key fails clearly (503)', err && err.status === 503 && /RESEND_API_KEY/.test(err.message));

  process.env.RESEND_API_KEY = 're_test_123';
  check('on with a key; default sender is the Resend test address', emailConfig().configured && /onboarding@resend\.dev/.test(emailConfig().from));

  const calls = [];
  const ok = async (url, init) => { calls.push({ url, init }); return { ok: true, status: 200, json: async () => ({ id: 'em_1' }) }; };
  const r = await sendEmail({ to: 'owner@example.com', subject: 'Hi', html: '<p>x</p>', text: 'x' }, { fetchImpl: ok });
  const sent = JSON.parse(calls[0].init.body);
  check('posts to the Resend emails endpoint', calls[0].url === 'https://api.resend.com/emails' && calls[0].init.method === 'POST');
  check('the key goes only in the Authorization header', calls[0].init.headers.Authorization === 'Bearer re_test_123' && !calls[0].init.body.includes('re_test_123'));
  check('one recipient per email', Array.isArray(sent.to) && sent.to.length === 1 && sent.to[0] === 'owner@example.com');
  check('returns the Resend id', r.id === 'em_1');

  err = null;
  try { await sendEmail({ to: 'a@b.co, c@d.co', subject: 's', text: 't' }, { fetchImpl: ok }); } catch (e) { err = e; }
  check('a list of recipients is refused', err && err.status === 400);

  process.env.EMAIL_FROM = 'TCG Speed Shipper <hello@tcgspeedshipper.com>';
  calls.length = 0;
  await sendEmail({ to: 'x@y.co', subject: 's', text: 't' }, { fetchImpl: ok });
  check('EMAIL_FROM sets the sender once the domain is verified', JSON.parse(calls[0].init.body).from === process.env.EMAIL_FROM);

  err = null;
  const bad = async () => ({ ok: false, status: 403, json: async () => ({ message: 'The domain is not verified' }) });
  try { await sendEmail({ to: 'x@y.co', subject: 's', text: 't' }, { fetchImpl: bad }); } catch (e) { err = e; }
  check("Resend's error message is passed through", err && err.status === 403 && /not verified/.test(err.message));

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
