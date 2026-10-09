// Transactional email through Resend (https://resend.com/docs/api-reference/emails/send-email).
// The API key lives only in the RESEND_API_KEY env var (Railway), never in code.
// Until our domain is verified in Resend, the sender must stay
// onboarding@resend.dev, and Resend only delivers to the account owner's own
// address. Set EMAIL_FROM (e.g. "TCG Speed Shipper <hello@tcgspeedshipper.com>")
// once tcgspeedshipper.com shows "Verified" in Resend → Domains.

const RESEND_URL = 'https://api.resend.com/emails';
const DEFAULT_FROM = 'TCG Speed Shipper <onboarding@resend.dev>';

function emailConfig() {
  return {
    configured: !!process.env.RESEND_API_KEY,
    from: process.env.EMAIL_FROM || DEFAULT_FROM,
  };
}

class EmailError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}

// Sends one email. `to` is a single address: never send one message to a list.
async function sendEmail({ to, subject, html, text, replyTo }, { fetchImpl } = {}) {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new EmailError('Email is not set up (RESEND_API_KEY is missing).', 503);
  if (typeof to !== 'string' || !/^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(to)) throw new EmailError('One valid recipient address is required.', 400);
  if (!subject || !(html || text)) throw new EmailError('Subject and a body are required.', 400);
  const body = { from: emailConfig().from, to: [to], subject, html, text };
  if (replyTo) body.reply_to = replyTo;
  const res = await (fetchImpl || fetch)(RESEND_URL, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  });
  let json = {};
  try { json = await res.json(); } catch (e) { /* non-JSON error page */ }
  if (!res.ok) throw new EmailError('Resend: ' + (json.message || json.name || ('HTTP ' + res.status)), res.status);
  return { id: json.id };
}

module.exports = { emailConfig, sendEmail, EmailError };
