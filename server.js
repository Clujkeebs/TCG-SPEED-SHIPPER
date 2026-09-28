const express = require('express');
const Stripe = require('stripe');
const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const SITE_URL = (process.env.PUBLIC_SITE_URL || '').replace(/\/$/, '') || 'http://localhost:' + PORT;

// These used to be constructed unconditionally at module load. If an env var
// was missing, the constructor threw and took the WHOLE function down with it,
// so every /api/* route returned an HTML 500 instead of JSON — which looked
// exactly like "signup is broken" while browser-direct Supabase calls (login)
// kept working. Build them defensively instead and let each route report the
// real reason.
const MISSING_SUPABASE = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'].filter((k) => !process.env[k]);

let stripe = null;
try {
  if (process.env.STRIPE_SECRET_KEY) stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
} catch (err) {
  console.error('Stripe client init failed:', err.message);
}

let supabaseAdmin = null;
try {
  if (!MISSING_SUPABASE.length) {
    supabaseAdmin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }
} catch (err) {
  console.error('Supabase admin client init failed:', err.message);
}

// Errors also go to tcgss_event_log so they show up on the owner's /admin
// dashboard — otherwise they only exist in Netlify's function logs, which
// nobody reads until something is already on fire. Never throws: logging
// must not be the thing that breaks a request. Awaited where possible,
// because a serverless function can be frozen right after it responds.
function eventText(args) {
  return args.map((a) => (a && a.message) ? a.message : (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ').slice(0, 2000);
}
async function logEvent(level, source, message, context) {
  try {
    if (!supabaseAdmin) return;
    const { error } = await supabaseAdmin.from('tcgss_event_log').insert({
      level, source: String(source).slice(0, 100), message: String(message || '').slice(0, 2000), context: context || {},
    });
    if (error) console.error('event log insert failed:', error.message);
  } catch (e) { /* never let logging break a request */ }
}
function logError(source, ...args) { console.error('[' + source + ']', ...args); return logEvent('error', source, eventText(args)); }
function logWarn(source, ...args) { console.warn('[' + source + ']', ...args); return logEvent('warn', source, eventText(args)); }

function requireSupabase(req, res, next) {
  if (!supabaseAdmin) {
    logError('config', 'Request to ' + req.path + ' with Supabase unconfigured. Missing: ' + (MISSING_SUPABASE.join(', ') || 'client init failed'));
    return res.status(503).json({ error: 'The server is not configured correctly (Supabase). This is a server-side problem, not your account.' });
  }
  next();
}

function requireStripe(req, res, next) {
  if (!stripe) {
    logError('config', 'Request to ' + req.path + ' with Stripe unconfigured.');
    return res.status(503).json({ error: 'The server is not configured correctly (Stripe). This is a server-side problem, not your account.' });
  }
  next();
}

// Prices new customers are sold, per plan and billing interval. Monthly is
// required; yearly is optional and only offered once its env var is set.
const SALE_PRICES = {
  base: { month: process.env.STRIPE_PRICE_BASE || null, year: process.env.STRIPE_PRICE_BASE_ANNUAL || null },
  premium: { month: process.env.STRIPE_PRICE_PREMIUM || null, year: process.env.STRIPE_PRICE_PREMIUM_ANNUAL || null },
};

// Every price id that grants a plan, including retired ones. When a price
// goes up, STRIPE_PRICE_BASE moves to the new price, but existing customers
// stay on the old one (grandfathered) and must keep their plan. The original
// launch prices are listed here so they keep working no matter what the env
// vars say later; add any other retired id to STRIPE_LEGACY_PRICES
// ("price_x:base,price_y:premium").
const LAUNCH_PRICES = { price_1U00soPpFiI6sg2WQvzev0Rm: 'base', price_1U00srPpFiI6sg2W7Ps9Z7qK: 'premium' };
const PRICE_TO_PLAN = Object.assign({}, LAUNCH_PRICES);
String(process.env.STRIPE_LEGACY_PRICES || '').split(',').forEach((pair) => {
  const [id, plan] = pair.split(':').map((x) => (x || '').trim());
  if (id && (plan === 'base' || plan === 'premium')) PRICE_TO_PLAN[id] = plan;
});
for (const plan of Object.keys(SALE_PRICES)) {
  for (const interval of Object.keys(SALE_PRICES[plan])) {
    if (SALE_PRICES[plan][interval]) PRICE_TO_PLAN[SALE_PRICES[plan][interval]] = plan;
  }
}

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
// Gzip/Brotli-negotiated compression (Netlify's CDN did this for us).
// The Stripe webhook reads a raw body, which compression doesn't touch.
app.use(require('compression')());

// When this runs as the whole site (Railway), it does what Netlify's CDN and
// netlify.toml did: www → apex, and the same security and cache headers.
// Under Netlify's function these are harmless (Netlify adds its own too).
const CANONICAL_HOST = 'tcgspeedshipper.com';
app.use((req, res, next) => {
  if (req.hostname === 'www.' + CANONICAL_HOST) {
    return res.redirect(301, 'https://' + CANONICAL_HOST + req.originalUrl);
  }
  next();
});
const HEADER_RULES = [
  { test: () => true, headers: {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Content-Security-Policy': "frame-ancestors 'none'",
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
  } },
  // HTTPS only (Netlify sent this). No includeSubDomains until www has its
  // own certificate, or browsers would pin a broken host.
  { test: () => process.env.RAILWAY_ENVIRONMENT_NAME === 'production', headers: { 'Strict-Transport-Security': 'max-age=31536000' } },
  { test: (p) => p.startsWith('/affiliate/'), headers: { 'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex, nofollow' } },
  { test: (p) => p.startsWith('/admin/') || p === '/admin', headers: { 'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex, nofollow', 'Cache-Control': 'no-store' } },
  { test: (p) => p === '/sw.js', headers: { 'Cache-Control': 'no-cache', 'Service-Worker-Allowed': '/' } },
  { test: (p) => p === '/version.json', headers: { 'Cache-Control': 'no-cache' } },
];
app.use((req, res, next) => {
  for (const rule of HEADER_RULES) if (rule.test(req.path)) res.set(rule.headers);
  next();
});

function periodEndOf(subscription) {
  const ts = subscription.current_period_end ||
    (subscription.items && subscription.items.data[0] && subscription.items.data[0].current_period_end);
  return ts ? new Date(ts * 1000).toISOString() : null;
}

// A price the env vars don't list can still be mapped by the plan_key set on
// it in Stripe (every price created since 2026-09-28 has one). This way a
// newly added price, or a host whose env vars lag behind, never leaves a
// paying customer without their plan.
function learnPrice(price) {
  if (!price || typeof price !== 'object' || !price.id || PRICE_TO_PLAN[price.id]) return;
  const key = price.metadata && price.metadata.plan_key;
  if (key === 'base' || key === 'premium') PRICE_TO_PLAN[price.id] = key;
}

async function applySubscriptionToProfile(subscription) {
  learnPrice(subscription.items.data[0].price);
  const priceId = subscription.items.data[0].price.id;
  const active = ['active', 'trialing'].includes(subscription.status);
  // An active subscription on a price we don't recognise means our price env
  // vars are wrong or a price was swapped in the Stripe dashboard. Refuse to
  // write a plan at all in that case rather than silently recording a paying
  // customer as 'free' and cutting off the thing they just paid for.
  if (active && !PRICE_TO_PLAN[priceId]) {
    await logError('billing.price', 'Active subscription ' + subscription.id + ' is on unrecognised price ' + priceId + ' — leaving plan untouched. Check STRIPE_PRICE_BASE/STRIPE_PRICE_PREMIUM.');
    return;
  }
  const plan = active ? PRICE_TO_PLAN[priceId] : 'free';
  // is_lifetime_free accounts (the owner) are never touched by Stripe events,
  // even in a freak stripe_customer_id collision.
  const { data: updated, error } = await supabaseAdmin
    .from('tcgss_profiles')
    .update({
      stripe_subscription_id: subscription.id,
      stripe_price_id: priceId,
      plan,
      subscription_status: subscription.status,
      current_period_end: periodEndOf(subscription),
      updated_at: new Date().toISOString(),
    })
    .eq('stripe_customer_id', subscription.customer)
    .eq('is_lifetime_free', false)
    .select('id')
    .maybeSingle();
  if (error) { await logError('billing.profile-update', 'Failed to update profile from subscription event:', error); return; }
  // Covers a referrer whose OWN subscription just went active (first purchase
  // via subscription.created, or a later renewal/resume) while they had
  // referral rewards waiting on that.
  if (active && updated) await applyPendingReferralCredits(updated.id, subscription.customer);
}

// Statuses that mean "Stripe is still billing this subscription". A customer in
// any of these already has a live subscription and must never be sent through
// Checkout again.
const LIVE_SUBSCRIPTION_STATUSES = ['active', 'trialing', 'past_due', 'unpaid'];

// Asks Stripe directly rather than trusting stripe_subscription_id in our own
// table, which can be stale or missing if a webhook was ever dropped. Stripe is
// the source of truth for what the customer is actually being billed for.
async function liveSubscriptionFor(customerId) {
  if (!customerId) return null;
  const list = await stripe.subscriptions.list({ customer: customerId, status: 'all', limit: 20 });
  return list.data.find((sub) => LIVE_SUBSCRIPTION_STATUSES.includes(sub.status)) || null;
}

// Length of the free first month a referred friend gets (see checkout).
const FRIEND_TRIAL_DAYS = 30;

// True if this Stripe customer has ever had a subscription, in any state. The
// referred-friend free month is for a first subscription only, so cancelling
// and coming back can't restart it.
async function hadAnySubscription(customerId) {
  if (!customerId) return false;
  const list = await stripe.subscriptions.list({ customer: customerId, status: 'all', limit: 1 });
  return list.data.length > 0;
}

// The profile a Stripe customer belongs to. Normally linked by
// stripe_customer_id, but a first invoice can be delivered before
// checkout.session.completed has linked it, so fall back to the Supabase user
// id stamped on every customer this server creates.
async function profileForStripeCustomer(customerId) {
  try {
    const { data, error } = await supabaseAdmin
      .from('tcgss_profiles')
      .select('id, referred_by')
      .eq('stripe_customer_id', customerId)
      .maybeSingle();
    if (error) throw error;
    if (data) return data;
    const customer = await stripe.customers.retrieve(customerId);
    const userId = customer && customer.metadata && customer.metadata.supabase_user_id;
    if (!userId) return null;
    const { data: byId, error: byIdErr } = await supabaseAdmin
      .from('tcgss_profiles')
      .select('id, referred_by')
      .eq('id', userId)
      .maybeSingle();
    if (byIdErr) throw byIdErr;
    return byId || null;
  } catch (err) {
    await logError('webhook.invoice', 'Failed to find the profile for Stripe customer', customerId, err);
    return null;
  }
}

// True if a paid invoice is for one of our plans' subscriptions (not, say, a
// one-off invoice created by hand in the Stripe dashboard).
async function isPaidPlanInvoice(invoice) {
  const subId = invoice.subscription ||
    (invoice.parent && invoice.parent.subscription_details && invoice.parent.subscription_details.subscription);
  if (!subId) return false;
  const priceIds = [];
  const lines = invoice.lines && Array.isArray(invoice.lines.data) ? invoice.lines.data : [];
  lines.forEach((line) => {
    const price = line && line.price;
    learnPrice(price);
    const priceId = typeof price === 'string' ? price : price && price.id;
    if (priceId) priceIds.push(priceId);
    const detailPrice = line && line.pricing && line.pricing.price_details && line.pricing.price_details.price;
    if (typeof detailPrice === 'string' && detailPrice) priceIds.push(detailPrice);
  });
  if (priceIds.length) return priceIds.some((id) => !!PRICE_TO_PLAN[id]);
  try {
    const sub = await stripe.subscriptions.retrieve(typeof subId === 'string' ? subId : subId.id);
    const item = sub && sub.items && sub.items.data[0];
    if (item) learnPrice(item.price);
    return !!(item && PRICE_TO_PLAN[item.price.id]);
  } catch (err) {
    await logError('webhook.invoice', 'Could not check the subscription on invoice', invoice.id, err);
    return false;
  }
}

// Records that a referred customer has become a paying customer and rewards
// whoever referred them. Idempotent in the database: a referred user can only
// ever earn their referrer one reward, so calling this again on a renewal or a
// redelivered webhook does nothing.
async function recordReferralConversion(userId) {
  const { data: referrerId, error: referralErr } = await supabaseAdmin.rpc('tcgss_record_referral_conversion', {
    p_referred_user_id: userId,
  });
  if (referralErr) { await logError('webhook.referral', 'Failed to record referral conversion for', userId, referralErr); return; }
  if (!referrerId) return;
  const { data: referrerProfile } = await supabaseAdmin
    .from('tcgss_profiles')
    .select('stripe_customer_id')
    .eq('id', referrerId)
    .maybeSingle();
  // Always attempt this, even if the referrer has never subscribed —
  // applyPendingReferralCredits grants a free month of Premium directly in
  // that case rather than needing a Stripe customer to credit.
  await applyPendingReferralCredits(referrerId, referrerProfile && referrerProfile.stripe_customer_id);
}

// Referral rewards: a paying referrer gets a Stripe customer balance credit,
// which works no matter which plan they end up on and stacks correctly if
// they've earned more than one free month (each credit reduces their next
// invoice(s) until it's used up). The amount is priced off the referrer's
// CURRENT subscription at the moment the credit is actually applied, not the
// plan they were on when they earned it — a fair "one month of whatever
// you're paying for" rather than a fixed dollar figure.
//
// A referrer with no live subscription right now — including one who has
// never paid at all — gets a real free month too: 30 days of free Premium
// access via tcgss_grant_referral_free_month (the same free_until mechanism
// the creator-affiliate program uses for its free year). This is the whole
// point of "refer someone who pays and get a free month" for a free-tier
// user: it used to just sit 'pending' forever unless THEY also became a
// paying customer, which wasn't the deal being offered.
//
// tcgss_claim_pending_referral_credits atomically claims each pending row
// (row-level lock inside the UPDATE), so this is safe to call from multiple
// webhook deliveries racing each other — only one will ever claim a given
// reward. A claimed row that fails to get a real reward is released back to
// 'pending' rather than left stuck, so it's retried on the next opportunity.
async function applyPendingReferralCredits(referrerProfileId, stripeCustomerId) {
  if (!referrerProfileId) return;
  try {
    const { data: claimed, error: claimErr } = await supabaseAdmin.rpc('tcgss_claim_pending_referral_credits', {
      p_referrer_id: referrerProfileId,
    });
    if (claimErr) { await logError('referral.claim', 'Failed to claim referral credits for', referrerProfileId, claimErr); return; }
    if (!claimed || !claimed.length) return;

    const subscription = stripeCustomerId ? await liveSubscriptionFor(stripeCustomerId) : null;
    if (!subscription) {
      // No live subscription to credit right now — grant the free month
      // directly instead of leaving the reward stuck.
      for (const credit of claimed) {
        const { error: grantErr } = await supabaseAdmin.rpc('tcgss_grant_referral_free_month', {
          p_credit_id: credit.id,
          p_referrer_id: referrerProfileId,
        });
        if (grantErr) {
          await logError('referral.grant', 'Failed to grant referral free month for', referrerProfileId, grantErr);
          await supabaseAdmin.rpc('tcgss_release_referral_credit', { p_credit_id: credit.id });
        }
      }
      return;
    }

    let price = subscription.items.data[0].price;
    if (!price || typeof price.unit_amount !== 'number') {
      price = await stripe.prices.retrieve(price ? price.id : subscription.items.data[0].price.id);
    }
    // "One free month" on a yearly plan is a twelfth of the yearly price,
    // not a whole year of credit.
    const perMonth = price.recurring && price.recurring.interval === 'year'
      ? Math.round(price.unit_amount / (12 * (price.recurring.interval_count || 1)))
      : price.unit_amount;
    const amount = perMonth;
    const currency = price.currency || 'usd';
    if (!amount) { for (const credit of claimed) await supabaseAdmin.rpc('tcgss_release_referral_credit', { p_credit_id: credit.id }); return; }

    for (const credit of claimed) {
      try {
        const txn = await stripe.customers.createBalanceTransaction(stripeCustomerId, {
          amount: -amount,
          currency,
          description: 'Referral reward: free month for referring a paying customer',
        });
        const { error: markErr } = await supabaseAdmin.rpc('tcgss_mark_referral_credit_applied', {
          p_credit_id: credit.id,
          p_balance_transaction_id: txn.id,
        });
        if (markErr) await logError('referral.record', 'Applied a referral credit but failed to record it:', markErr);
      } catch (stripeErr) {
        await logError('referral.stripe-credit', 'Failed to apply referral credit', credit.id, 'for', referrerProfileId, stripeErr.message);
        await supabaseAdmin.rpc('tcgss_release_referral_credit', { p_credit_id: credit.id });
      }
    }
  } catch (err) {
    await logError('referral', 'applyPendingReferralCredits failed for', referrerProfileId, err);
  }
}

async function findPromotionCode(rawCode) {
  const code = (rawCode || '').trim();
  if (!code) return null;
  // Stripe's `code` filter is documented as case-insensitive, so no need to
  // normalize case ourselves.
  const list = await stripe.promotionCodes.list({ code, active: true, limit: 1 });
  return list.data[0] || null;
}

function describeCoupon(coupon) {
  let desc;
  if (coupon.percent_off) desc = coupon.percent_off + '% off';
  else if (coupon.amount_off) {
    const symbol = (coupon.currency || 'usd').toUpperCase() === 'USD' ? '$' : (coupon.currency || '').toUpperCase() + ' ';
    desc = symbol + (coupon.amount_off / 100).toFixed(2) + ' off';
  }
  else desc = 'Discount';
  if (coupon.duration === 'repeating') {
    desc += ' for ' + coupon.duration_in_months + ' month' + (coupon.duration_in_months === 1 ? '' : 's');
  } else if (coupon.duration === 'forever') {
    desc += ', forever';
  } else {
    desc += ' (first payment)';
  }
  return desc;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Password auth shipped on 2026-09-11. Accounts created before this could only
// have come from the old passwordless magic-link flow, so they have no password
// their owner knows and are safe to set one on. Anything created at or after it
// has a real password and must never be overwritten by a signup collision.
// Every pre-existing account at cutoff time was created 2026-08-31 or earlier.
const LEGACY_ACCOUNT_CUTOFF = new Date('2026-09-11T00:00:00Z');

// Best-effort, in-process throttle on account creation. Netlify Functions are
// not guaranteed to stay warm between invocations, so this is not a strong
// guarantee — it only helps within a warm container — but it's a cheap first
// line of defense against obvious abuse without adding external infra.
function makeThrottle(maxAttempts, windowMs) {
  const attempts = new Map();
  return function tooMany(key) {
    const now = Date.now();
    const recent = (attempts.get(key) || []).filter((t) => now - t < windowMs);
    recent.push(now);
    attempts.set(key, recent);
    // Keep a warm container from accumulating every IP it has ever seen.
    if (attempts.size > 5000) {
      for (const [k, v] of attempts) if (!v.length || now - v[v.length - 1] > windowMs) attempts.delete(k);
    }
    return recent.length > maxAttempts;
  };
}
const tooManySignatureLogs = makeThrottle(1, 10 * 60 * 1000);
const tooManySignupAttempts = makeThrottle(8, 10 * 60 * 1000);
// Promo codes are guessable strings; this slows down brute-forcing them.
const tooManyPromoChecks = makeThrottle(20, 10 * 60 * 1000);

// x-forwarded-for can carry a client,proxy,proxy chain; the first entry is the
// original client. Falls back to req.ip (direct connections, local testing).
function getClientIp(req) {
  const header = req.headers['x-forwarded-for'];
  if (header) return String(header).split(',')[0].trim();
  return req.ip || 'unknown';
}

// One-way hash so the database never stores a raw IP address, just enough to
// recognise "this is the same connection as before."
function hashIp(ip) {
  return crypto.createHash('sha256').update(String(ip)).digest('hex');
}

// A 100%-off coupon is a fully-free redemption regardless of which promo code
// carries it — treating this as a property of the coupon (not a specific
// hardcoded code) means any free-tier giveaway code created in the future
// gets the same IP protection automatically, with no code changes here.
function isFullyFreeCoupon(coupon) {
  return !!coupon && coupon.percent_off === 100;
}

// Has this (promotion code, connection) pair already redeemed a free month?
// Best-effort defense against the same person signing up repeatedly from one
// network to keep re-claiming a free-tier code — not airtight (shared IPs,
// VPNs), but a real deterrent, backed by a database unique constraint rather
// than only in-process state.
async function alreadyRedeemedFromIp(promotionCodeId, ipHash) {
  const { data, error } = await supabaseAdmin
    .from('tcgss_promo_ip_redemptions')
    .select('id')
    .eq('promotion_code_id', promotionCodeId)
    .eq('ip_hash', ipHash)
    .maybeSingle();
  if (error) { console.error('Failed to check promo IP redemption:', error); return false; }
  return !!data;
}

// Records a completed free redemption. Errors are swallowed except for the
// expected "already recorded" case, which is exactly the race this table's
// unique constraint exists to catch (e.g. a redelivered webhook) — silent by
// design, not a bug.
async function recordPromoIpRedemption(promotionCodeId, ipHash, userId) {
  const { error } = await supabaseAdmin
    .from('tcgss_promo_ip_redemptions')
    .insert({ promotion_code_id: promotionCodeId, ip_hash: ipHash, user_id: userId });
  if (error && error.code !== '23505') console.error('Failed to record promo IP redemption:', error);
}

async function findAuthUserId(email) {
  const { data, error } = await supabaseAdmin.rpc('tcgss_find_auth_user_id', { p_email: email });
  if (error) throw error;
  return data || null;
}

async function requireUser(req, res, next) {
  try {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Missing auth token' });
    const { data, error } = await supabaseAdmin.auth.getUser(token);
    if (error || !data.user) return res.status(401).json({ error: 'Invalid or expired session' });
    req.user = data.user;
    next();
  } catch (err) {
    console.error('Auth check failed:', err);
    res.status(500).json({ error: 'Could not verify your session' });
  }
}

const router = express.Router();

router.get('/health', (req, res) => {
  // Reports which env vars are present (never their values) so a broken
  // deploy can be diagnosed without guessing.
  const config = {
    stripe_secret: !!process.env.STRIPE_SECRET_KEY,
    stripe_webhook_secret: !!process.env.STRIPE_WEBHOOK_SECRET,
    price_base: !!process.env.STRIPE_PRICE_BASE,
    price_premium: !!process.env.STRIPE_PRICE_PREMIUM,
    price_base_annual: !!process.env.STRIPE_PRICE_BASE_ANNUAL,
    price_premium_annual: !!process.env.STRIPE_PRICE_PREMIUM_ANNUAL,
    supabase_url: !!process.env.SUPABASE_URL,
    supabase_service_key: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
    site_url: SITE_URL,
  };
  // Yearly prices are optional, so their absence doesn't mark the deploy unhealthy.
  const missing = Object.keys(config).filter((k) => config[k] === false && !/_annual$/.test(k));
  res.json({
    ok: missing.length === 0,
    clients: { stripe: !!stripe, supabase_admin: !!supabaseAdmin },
    missing,
    config,
  });
});

// Stripe signature verification needs the exact raw bytes, so this route gets
// express.raw instead of the JSON parser used by the routes below.
router.post('/stripe-webhook', express.raw({ type: '*/*' }), requireStripe, requireSupabase, async (req, res) => {
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, req.headers['stripe-signature'], process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Stripe webhook signature verification failed:', err.message);
    // A real Stripe delivery (it carries a signature header) that fails
    // verification almost always means STRIPE_WEBHOOK_SECRET doesn't match the
    // endpoint's signing secret, e.g. after the endpoint was re-created. Count
    // it for the admin Setup checks, and log it at most every 10 minutes.
    if (req.headers['stripe-signature'] && supabaseAdmin) {
      try { await supabaseAdmin.rpc('tcgss_bump_event', { p_event: 'stripe:signature_failed', p_source: 'stripe' }); } catch (e) { /* diagnostics only */ }
      if (!tooManySignatureLogs('all')) await logError('webhook.signature', 'Stripe webhook signature check failed. Check that STRIPE_WEBHOOK_SECRET matches the endpoint signing secret in Stripe.', err.message);
    }
    return res.status(400).send('Webhook Error: ' + err.message);
  }

  // Count verified deliveries per event type (daily totals, source 'stripe').
  // The admin dashboard uses this to warn when an event the app depends on
  // (e.g. invoice.payment_succeeded) never arrives, which usually means it
  // isn't enabled on the webhook endpoint in Stripe.
  try {
    const { error: countErr } = await supabaseAdmin.rpc('tcgss_bump_event', { p_event: 'stripe:' + String(event.type).slice(0, 60), p_source: 'stripe' });
    // Logged, so a counter failure is visible and isn't mistaken for Stripe
    // not delivering.
    if (countErr) await logError('webhook.count', 'Could not count webhook delivery', event.type, countErr);
  } catch (e) { /* diagnostics only; never block a webhook */ }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        const userId = session.client_reference_id;
        if (userId && session.subscription) {
          const subscription = await stripe.subscriptions.retrieve(session.subscription);
          learnPrice(subscription.items.data[0].price);
          const priceId = subscription.items.data[0].price.id;
          if (!PRICE_TO_PLAN[priceId]) {
            // Someone just paid for a price we can't map to a plan. Record the
            // billing link so support can see it, but never write plan: 'free'
            // over a completed payment.
            await logError('webhook.checkout-price', 'Checkout completed on unrecognised price ' + priceId + ' for user ' + userId + ' — plan not set. Check STRIPE_PRICE_BASE/STRIPE_PRICE_PREMIUM.');
          }
          const { error } = await supabaseAdmin
            .from('tcgss_profiles')
            .update({
              stripe_customer_id: session.customer,
              stripe_subscription_id: subscription.id,
              stripe_price_id: priceId,
              plan: PRICE_TO_PLAN[priceId] || undefined,
              subscription_status: subscription.status,
              current_period_end: periodEndOf(subscription),
              updated_at: new Date().toISOString(),
            })
            .eq('id', userId)
            .eq('is_lifetime_free', false);
          if (error) {
            await logError('webhook.checkout', 'Failed to attach subscription to profile:', error);
            break;
          }

          // The referrer's reward is NOT granted here: an active subscription
          // can still have cost $0 (a 100%-off code) and a referred friend's
          // free month starts as 'trialing'. It waits for the friend's first
          // real payment, in invoice.payment_succeeded below.
          if (['active', 'trialing'].includes(subscription.status)) {
            // Independently: this customer, who just started paying, may
            // themselves have referred other people before they ever
            // subscribed. Now that they have a live subscription, apply any
            // credit they've already earned as a referrer.
            await applyPendingReferralCredits(userId, session.customer);
          }

          // A fully-free redemption (see create-checkout-session) stamps its
          // IP hash into session metadata at creation time; recorded only now,
          // on actual completion, so an abandoned $0 checkout never burns the
          // one redemption this connection gets.
          if (session.metadata && session.metadata.promo_code_id && session.metadata.promo_ip_hash) {
            await recordPromoIpRedemption(session.metadata.promo_code_id, session.metadata.promo_ip_hash, userId);
          }
        }
        break;
      }
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
        await applySubscriptionToProfile(event.data.object);
        break;
      case 'customer.subscription.deleted': {
        const subscription = event.data.object;
        // Matched on the subscription id, not just the customer: a customer who
        // cancelled and then resubscribed has two subscriptions, and a delayed
        // or retried cancellation event for the OLD one must not downgrade the
        // new one they are currently paying for.
        const { error } = await supabaseAdmin
          .from('tcgss_profiles')
          .update({ plan: 'free', subscription_status: 'canceled', updated_at: new Date().toISOString() })
          .eq('stripe_customer_id', subscription.customer)
          .eq('stripe_subscription_id', subscription.id)
          .eq('is_lifetime_free', false);
        if (error) await logError('webhook.cancel', 'Failed to downgrade profile on cancellation:', error);
        break;
      }
      case 'invoice.payment_succeeded': {
        // The single source of truth for affiliate commission: fires for
        // every paid invoice, first payment and every renewal alike, so
        // recording earnings only here (never in checkout.session.completed
        // or the subscription handlers above) means there is exactly one
        // place this money is ever computed. Idempotent on the Stripe
        // invoice id inside tcgss_record_affiliate_earning, so a redelivered
        // webhook can never double-credit the same payment.
        const invoice = event.data.object;
        if (invoice.customer && invoice.amount_paid > 0) {
          const profile = await profileForStripeCustomer(invoice.customer);
          if (profile) {
            // A referred customer's first real payment for a plan is what
            // earns their referrer's reward (idempotent: once per referred
            // user, ever). Any other paid invoice doesn't count.
            if (profile.referred_by && (await isPaidPlanInvoice(invoice))) await recordReferralConversion(profile.id);
            const periodStart = invoice.period_start ? new Date(invoice.period_start * 1000) : new Date();
            const periodMonth = new Date(Date.UTC(periodStart.getUTCFullYear(), periodStart.getUTCMonth(), 1))
              .toISOString().slice(0, 10);
            const { error: earningErr } = await supabaseAdmin.rpc('tcgss_record_affiliate_earning', {
              p_referred_user_id: profile.id,
              p_stripe_invoice_id: invoice.id,
              p_amount_cents: invoice.amount_paid,
              p_currency: invoice.currency || 'usd',
              p_period_month: periodMonth,
            });
            if (earningErr) await logError('webhook.affiliate-earning', 'Failed to record affiliate earning for invoice', invoice.id, earningErr);
          }
        }
        break;
      }
      default:
        break;
    }
  } catch (err) {
    await logError('webhook', 'Error handling Stripe webhook event:', err);
    return res.status(500).send('Webhook handler failed');
  }

  res.json({ received: true });
});

router.post('/signup', express.json(), requireSupabase, async (req, res) => {
  try {
    if (tooManySignupAttempts(getClientIp(req))) {
      return res.status(429).json({ error: 'Too many attempts — try again in a few minutes.' });
    }

    const email = ((req.body && req.body.email) || '').trim().toLowerCase();
    const password = (req.body && req.body.password) || '';
    if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'Enter a valid email.' });
    if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });

    // email_confirm: true creates the account already-verified — no email is
    // sent or required. Supabase Auth hashes the password (bcrypt) before
    // storing it in auth.users; we never see or store the plaintext, here or
    // anywhere else. password_set_by_user marks that a real, user-chosen
    // password exists — see the repair branch below for why this matters.
    const { error: createErr } = await supabaseAdmin.auth.admin.createUser({
      email, password, email_confirm: true,
      user_metadata: { password_set_by_user: true },
    });
    if (!createErr) return res.json({ ok: true });

    if (!/already.*registered|already.*exists/i.test(createErr.message || '')) {
      throw createErr;
    }

    // Email already registered. Two different stuck states can land here,
    // both from before password auth existed on this app, and both get
    // repaired the same way: set the password they just chose and confirm.
    //   1. Unconfirmed: signInWithOtp creates the auth.users row immediately
    //      but leaves it unconfirmed with no password until a magic-link
    //      email (that may never have arrived) is clicked.
    //   2. Confirmed but no real password: the user *did* complete the old
    //      magic-link flow, so the account is confirmed — but no password
    //      they know was ever set (OTP/magic-link is passwordless). This is
    //      the case for real users who signed up before this feature shipped.
    // Repairing means overwriting a password, so it is gated on TWO
    // independent conditions — either one alone is not enough:
    //   a) no password_set_by_user tag, and
    //   b) the account predates password auth existing on this app.
    // (b) is the one that actually makes this safe. The tag alone is not
    // sufficient: an account created through Supabase's own public signup
    // endpoint (the client-side fast path in index.html) has a real,
    // user-chosen password but carries no tag — without the date check,
    // anyone could "Create Account" with someone else's email and a password
    // of their choosing and take that account over.
    const existingId = await findAuthUserId(email);
    if (!existingId) throw createErr;

    const { data: userRec, error: getErr } = await supabaseAdmin.auth.admin.getUserById(existingId);
    if (getErr) throw getErr;

    const existingUser = (userRec && userRec.user) || null;
    const existingMeta = (existingUser && existingUser.user_metadata) || {};
    const hasPasswordTag = !!existingMeta.password_set_by_user;
    const createdAt = existingUser && existingUser.created_at ? new Date(existingUser.created_at) : null;
    const predatesPasswordAuth = !!createdAt && createdAt < LEGACY_ACCOUNT_CUTOFF;

    if (!hasPasswordTag && predatesPasswordAuth) {
      const { error: updateErr } = await supabaseAdmin.auth.admin.updateUserById(existingId, {
        password, email_confirm: true,
        user_metadata: Object.assign({}, existingMeta, { password_set_by_user: true }),
      });
      if (updateErr) throw updateErr;
      return res.json({ ok: true, repaired: true });
    }

    return res.status(409).json({ error: 'An account with that email already exists — log in instead, or use Forgot Password if you don’t know the password.' });
  } catch (err) {
    await logError('signup', 'signup failed:', err);
    res.status(500).json({ error: 'Could not create account' });
  }
});

router.get('/validate-promo-code', requireStripe, requireSupabase, async (req, res) => {
  try {
    if (tooManyPromoChecks(getClientIp(req))) {
      return res.status(429).json({ valid: false, error: 'Too many attempts — try again in a few minutes.' });
    }
    const promo = await findPromotionCode(req.query.code);
    if (!promo) return res.json({ valid: false, error: 'That code is not valid or has expired.' });
    // Early, best-effort feedback for a fully-free code already used from this
    // connection — saves a trip through checkout to find out. Not the only
    // enforcement: create-checkout-session checks again right before billing,
    // since the two requests aren't guaranteed to share the same IP.
    if (isFullyFreeCoupon(promo.coupon)) {
      const ipHash = hashIp(getClientIp(req));
      if (await alreadyRedeemedFromIp(promo.id, ipHash)) {
        return res.json({ valid: false, error: 'This code has already been used from this connection.' });
      }
    }
    res.json({ valid: true, code: promo.code, description: describeCoupon(promo.coupon) });
  } catch (err) {
    await logError('promo.validate', 'validate-promo-code failed:', err);
    res.status(500).json({ valid: false, error: 'Could not check that code right now.' });
  }
});

// What each plan costs right now, read from Stripe so the pricing page can
// never disagree with what Checkout will charge. Cached per warm container.
let plansCache = null, plansCacheAt = 0;
router.get('/plans', requireStripe, async (req, res) => {
  try {
    if (!plansCache || Date.now() - plansCacheAt > 10 * 60 * 1000) {
      const out = {};
      for (const plan of Object.keys(SALE_PRICES)) {
        out[plan] = {};
        for (const interval of Object.keys(SALE_PRICES[plan])) {
          const id = SALE_PRICES[plan][interval];
          if (!id) continue;
          const pr = await stripe.prices.retrieve(id);
          if (pr && pr.active !== false && typeof pr.unit_amount === 'number') {
            out[plan][interval] = { amount: pr.unit_amount, currency: pr.currency || 'usd' };
          }
        }
      }
      plansCache = out; plansCacheAt = Date.now();
    }
    res.set('Cache-Control', 'public, max-age=300');
    res.json({ plans: plansCache });
  } catch (err) {
    await logError('plans', err);
    res.status(500).json({ error: 'Could not load plans' });
  }
});

router.post('/create-checkout-session', express.json(), requireStripe, requireSupabase, requireUser, async (req, res) => {
  try {
    const plan = req.body && req.body.plan;
    const interval = (req.body && req.body.interval) === 'year' ? 'year' : 'month';
    const priceId = SALE_PRICES[plan] ? SALE_PRICES[plan][interval] : null;
    if (!SALE_PRICES[plan]) return res.status(400).json({ error: 'Unknown plan' });
    if (!priceId) return res.status(400).json({ error: interval === 'year' ? 'Yearly billing isn\'t available for that plan yet.' : 'Unknown plan' });

    const ipHash = hashIp(getClientIp(req));

    // Kicked off now (in parallel with the profile/customer setup below) since
    // it depends on none of that work — re-validated server-side regardless of
    // what the client claimed earlier. The no-op .catch keeps a rejection here
    // from becoming an unhandled rejection if we return early (e.g. the
    // is_lifetime_free check below); the real error still surfaces at the
    // `await promoLookup` further down.
    const promoLookup = findPromotionCode(req.body && req.body.promoCode);
    promoLookup.catch(() => {});

    const { data: profile, error: profileErr } = await supabaseAdmin
      .from('tcgss_profiles')
      .select('stripe_customer_id, is_lifetime_free, referred_by, affiliate_id')
      .eq('id', req.user.id)
      .maybeSingle();
    if (profileErr) throw profileErr;

    if (profile && profile.is_lifetime_free) {
      return res.status(400).json({ error: 'This account already has Premium free, permanently — no checkout needed.' });
    }

    // Someone who already pays for a plan must NOT be sent through Checkout
    // again: Checkout creates a brand new subscription alongside the existing
    // one and bills them for both. "Upgrade to Premium" while on Base means
    // change the price on the subscription they already have.
    const existingSub = await liveSubscriptionFor(profile && profile.stripe_customer_id);
    if (existingSub) {
      const existingItem = existingSub.items.data[0];
      if (existingItem.price.id === priceId) {
        return res.status(400).json({ error: 'You are already on that plan.' });
      }

      const switchParams = {
        items: [{ id: existingItem.id, price: priceId }],
        // Stripe credits the unused part of the old plan against the new one,
        // so switching mid-cycle does not charge twice for the same days.
        proration_behavior: 'create_prorations',
        cancel_at_period_end: false,
      };

      const promoForSwitch = await promoLookup;
      let switched;
      try {
        switched = await stripe.subscriptions.update(
          existingSub.id,
          promoForSwitch ? Object.assign({ promotion_code: promoForSwitch.id }, switchParams) : switchParams
        );
      } catch (switchErr) {
        if (!promoForSwitch) throw switchErr;
        console.error('Plan switch with promo code failed, retrying without it:', switchErr.message);
        switched = await stripe.subscriptions.update(existingSub.id, switchParams);
      }

      // Write the new plan now instead of waiting on the webhook, so the plan
      // shown to the user is correct the moment this response lands.
      await applySubscriptionToProfile(switched);
      return res.json({ switched: true, plan: PRICE_TO_PLAN[priceId] || plan });
    }

    let customerId = profile && profile.stripe_customer_id;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: req.user.email,
        metadata: { supabase_user_id: req.user.id },
      });
      customerId = customer.id;
      // upsert: the profile row is normally created by a signup trigger, but
      // this keeps checkout working even if that row is somehow missing.
      const { error: upsertErr } = await supabaseAdmin
        .from('tcgss_profiles')
        .upsert({ id: req.user.id, email: req.user.email, stripe_customer_id: customerId }, { onConflict: 'id' });
      if (upsertErr) throw upsertErr;
    }

    let appliedPromo = await promoLookup;
    let promoDeniedReason = null;
    const isFreeRedemption = isFullyFreeCoupon(appliedPromo && appliedPromo.coupon);

    if (isFreeRedemption && (await alreadyRedeemedFromIp(appliedPromo.id, ipHash))) {
      // Authoritative check — /validate-promo-code already tried to catch
      // this earlier, but that request isn't guaranteed to have come from the
      // same IP, so this is the real gate, right before anything is billed.
      appliedPromo = null;
      promoDeniedReason = 'ip_already_used';
    }

    // Two-sided referrals: someone who signed up through a friend's referral
    // link or a creator's link gets their first month free — once, on their
    // very first subscription. Not combined with a 100%-off code (already
    // free), and a card is collected up front so the plan simply continues.
    const referredFriend = !!(profile && (profile.referred_by || profile.affiliate_id));
    // Checked after the IP rule above: if the 100%-off code was refused, the
    // friend still gets their free month instead of being charged at once.
    const stillFullyFree = isFullyFreeCoupon(appliedPromo && appliedPromo.coupon);
    const friendEligible = referredFriend && !(await hadAnySubscription(customerId));
    const cancelText = 'Cancel any time online from Manage Billing on the Pricing page; you keep access through the end of the paid period. ' +
      'By subscribing you agree to the Terms of Service at ' + SITE_URL + '/terms.html';
    const setFriendTrial = (params, on) => {
      const renewalText = on
        ? 'Your first ' + FRIEND_TRIAL_DAYS + ' days are free (referral reward). After that this subscription renews automatically every ' + interval + ' at the price shown until you cancel. Cancel before the free period ends and you are never charged. '
        : 'This subscription renews automatically every ' + interval + ' at the price shown until you cancel. ';
      if (params.custom_text) params.custom_text.submit.message = renewalText + cancelText;
      if (on) {
        params.subscription_data = { trial_period_days: FRIEND_TRIAL_DAYS, metadata: { referral_trial: 'true' } };
        params.payment_method_collection = 'always';
      } else {
        delete params.subscription_data;
        params.payment_method_collection = 'if_required';
      }
    };

    const sessionParams = {
      mode: 'subscription',
      customer: customerId,
      client_reference_id: req.user.id,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: SITE_URL + '/?checkout=success',
      cancel_url: SITE_URL + '/?checkout=cancelled',
      // Only skips card collection when the amount actually due is $0 (e.g. a
      // 100%-off code below) — a normal paid checkout still collects a card
      // exactly as before, since its total is never zero.
      payment_method_collection: 'if_required',
      // Automatic-renewal disclosure shown right above the Subscribe button.
      // State auto-renewal laws (e.g. California's) require the renewal
      // terms and how to cancel to be clear at the point of purchase.
      custom_text: {
        submit: {
          message: 'This subscription renews automatically every ' + interval + ' at the price shown until you cancel. ' + cancelText,
        },
      },
    };
    setFriendTrial(sessionParams, friendEligible && !stillFullyFree);
    if (appliedPromo) {
      sessionParams.discounts = [{ promotion_code: appliedPromo.id }];
      if (isFreeRedemption) {
        // Read back by the checkout.session.completed handler to record the
        // redemption once the $0 checkout actually completes — not here at
        // session *creation*, since a session that's merely started and
        // abandoned shouldn't burn the one redemption this IP gets.
        sessionParams.metadata = { promo_code_id: appliedPromo.id, promo_ip_hash: ipHash };
      }
    } else {
      sessionParams.allow_promotion_codes = true;
    }

    // The renewal disclosure must never be the thing that stops a sale: if
    // Stripe ever rejects custom_text (e.g. a wording limit), log it loudly
    // and open Checkout without it — Stripe still shows its own renewal terms.
    const createSession = async (params) => {
      try {
        return await stripe.checkout.sessions.create(params);
      } catch (err) {
        if (!params.custom_text || !/custom_text/i.test(err.message || '')) throw err;
        await logWarn('checkout.custom-text', 'Checkout rejected custom_text, retrying without it:', err.message);
        delete params.custom_text;
        return stripe.checkout.sessions.create(params);
      }
    };

    let session;
    let promoApplied = !!appliedPromo;
    try {
      session = await createSession(sessionParams);
    } catch (stripeErr) {
      if (!appliedPromo) throw stripeErr;
      // The code is valid but doesn't apply to this particular plan (e.g. it's
      // restricted to a different product) — fall back rather than blocking
      // checkout entirely; the client tells the user the discount didn't apply.
      console.error('Checkout with promo code failed, retrying without it:', stripeErr.message);
      delete sessionParams.discounts;
      delete sessionParams.metadata;
      sessionParams.allow_promotion_codes = true;
      setFriendTrial(sessionParams, friendEligible);
      session = await createSession(sessionParams);
      promoApplied = false;
      promoDeniedReason = promoDeniedReason || 'not_applicable';
    }

    res.json({ url: session.url, promoApplied: promoApplied, promoDeniedReason: promoApplied ? null : promoDeniedReason });
  } catch (err) {
    await logError('checkout', 'create-checkout-session failed:', err);
    res.status(500).json({ error: 'Could not create checkout session' });
  }
});

// Safety net for a webhook that never arrived — a misconfigured endpoint, a
// Stripe outage, or a delivery Stripe eventually stopped retrying. Asks Stripe
// what this customer is actually subscribed to and writes that to the profile,
// so somebody who has paid is never stranded on the Free plan with no way out.
// Only ever touches the caller's own row, from the caller's own Stripe data.
router.post('/sync-subscription', express.json(), requireStripe, requireSupabase, requireUser, async (req, res) => {
  try {
    const { data: profile, error } = await supabaseAdmin
      .from('tcgss_profiles')
      .select('stripe_customer_id, is_lifetime_free, referred_by, affiliate_id')
      .eq('id', req.user.id)
      .maybeSingle();
    if (error) throw error;
    if (profile && profile.is_lifetime_free) return res.json({ synced: false, plan: 'premium' });

    let customerId = profile && profile.stripe_customer_id;
    if (!customerId) {
      // The profile has no billing link. Recover it from Stripe using the
      // supabase_user_id we stamp on every customer at creation, rather than
      // trusting the email alone.
      const candidates = await stripe.customers.list({ email: req.user.email, limit: 20 });
      const match = candidates.data.find((c) => c.metadata && c.metadata.supabase_user_id === req.user.id);
      if (!match) return res.json({ synced: false, plan: 'free' });
      customerId = match.id;
      const { error: upsertErr } = await supabaseAdmin
        .from('tcgss_profiles')
        .upsert({ id: req.user.id, email: req.user.email, stripe_customer_id: customerId }, { onConflict: 'id' });
      if (upsertErr) throw upsertErr;
    }

    const subscription = await liveSubscriptionFor(customerId);
    if (!subscription) return res.json({ synced: false, plan: 'free' });

    await applySubscriptionToProfile(subscription);
    res.json({ synced: true, plan: PRICE_TO_PLAN[subscription.items.data[0].price.id] || null });
  } catch (err) {
    await logError('sync-subscription', 'sync-subscription failed:', err);
    res.status(500).json({ error: 'Could not check your subscription' });
  }
});

router.post('/create-portal-session', express.json(), requireStripe, requireSupabase, requireUser, async (req, res) => {
  try {
    const { data: profile, error } = await supabaseAdmin
      .from('tcgss_profiles')
      .select('stripe_customer_id')
      .eq('id', req.user.id)
      .maybeSingle();
    if (error) throw error;
    if (!profile || !profile.stripe_customer_id) {
      return res.status(400).json({ error: 'There is no paid subscription on this account, so there is nothing to manage or cancel. Questions? See ' + SITE_URL + '/support.html' });
    }

    const portalSession = await stripe.billingPortal.sessions.create({
      customer: profile.stripe_customer_id,
      return_url: SITE_URL + '/',
    });

    res.json({ url: portalSession.url });
  } catch (err) {
    await logError('billing-portal', 'create-portal-session failed:', err);
    res.status(500).json({ error: 'Could not open billing portal' });
  }
});

// The owner's account, hardcoded to match tcgss_is_owner_email() in the
// database — kept in sync deliberately rather than looked up, since these
// admin routes gate real money (creating affiliates, marking cash payouts as
// sent) and should fail closed if the two ever disagreed.
const OWNER_EMAIL = 'clujkeebs@aol.com';
function requireOwner(req, res, next) {
  if (!req.user || (req.user.email || '').toLowerCase() !== OWNER_EMAIL) {
    return res.status(403).json({ error: 'Not authorized' });
  }
  next();
}

// Public by design: a creator has their own dashboard_token, not necessarily
// a TCGSS account, so this is token-authenticated rather than session-based.
// tcgss_get_affiliate_dashboard returns null for an unknown token and this
// route reports the same 404 either way, so a wrong token can't be
// distinguished from one that's merely unrecognised.
router.get('/affiliate-dashboard', requireSupabase, async (req, res) => {
  try {
    const token = (req.query.token || '').toString().trim();
    if (!token) return res.status(400).json({ error: 'Missing token' });
    const { data, error } = await supabaseAdmin.rpc('tcgss_get_affiliate_dashboard', { p_token: token });
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Dashboard not found' });
    res.json(data);
  } catch (err) {
    await logError('affiliate-dashboard', 'affiliate-dashboard failed:', err);
    res.status(500).json({ error: 'Could not load dashboard' });
  }
});

// Everything below is owner-only: creating a partner record, activating the
// 1-year deal (which also grants their free year), listing everyone's
// current balance, and confirming a manual payout actually happened.
router.get('/admin/affiliates', requireSupabase, requireUser, requireOwner, async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin.rpc('tcgss_list_affiliates_summary');
    if (error) throw error;
    res.json({ affiliates: data });
  } catch (err) {
    await logError('admin.affiliates', 'list affiliates failed:', err);
    res.status(500).json({ error: 'Could not load affiliates' });
  }
});

// Creator partner deal: 40% of every payment their referrals make, for as
// long as they stay subscribed, plus a free year of Premium on activation.
const AFFILIATE_DEFAULT_RATE = 0.4;

router.post('/admin/affiliates', express.json(), requireSupabase, requireUser, requireOwner, async (req, res) => {
  try {
    const name = ((req.body && req.body.name) || '').trim();
    const email = ((req.body && req.body.email) || '').trim().toLowerCase();
    const rate = req.body && req.body.commissionRate;
    if (!name || !EMAIL_RE.test(email)) return res.status(400).json({ error: 'A name and a valid email are required.' });

    const { data, error } = await supabaseAdmin.rpc('tcgss_create_affiliate', {
      p_name: name, p_email: email,
      p_commission_rate: typeof rate === 'number' && rate > 0 && rate <= 0.6 ? rate : AFFILIATE_DEFAULT_RATE,
    });
    if (error) throw error;
    res.json({
      affiliate: data,
      link: SITE_URL + '/?aff=' + data.affiliate_code,
      dashboard: SITE_URL + '/affiliate/?token=' + data.dashboard_token,
    });
  } catch (err) {
    await logError('admin.affiliates', 'create affiliate failed:', err);
    res.status(500).json({ error: 'Could not create affiliate' });
  }
});

router.post('/admin/affiliates/:id/activate', express.json(), requireSupabase, requireUser, requireOwner, async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin.rpc('tcgss_activate_affiliate', { p_affiliate_id: req.params.id });
    if (error) throw error;
    res.json({ affiliate: data });
  } catch (err) {
    await logError('admin.affiliates', 'activate affiliate failed:', err);
    res.status(500).json({ error: 'Could not activate affiliate — check the id is correct.' });
  }
});

router.post('/admin/affiliates/:id/mark-paid', express.json(), requireSupabase, requireUser, requireOwner, async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin.rpc('tcgss_mark_affiliate_paid', { p_affiliate_id: req.params.id });
    if (error) throw error;
    res.json({ rowsMarkedPaid: data });
  } catch (err) {
    await logError('admin.affiliates', 'mark affiliate paid failed:', err);
    res.status(500).json({ error: 'Could not mark affiliate as paid' });
  }
});

// Browser-side crashes, reported by window.onerror in the pages. Public by
// necessity (anonymous visitors hit errors too), so: throttled per IP, sizes
// capped, and nothing but the error text, page path and browser string is
// stored — never order data, never the IP.
const tooManyClientErrors = makeThrottle(30, 10 * 60 * 1000);
router.post('/client-error', express.json({ limit: '8kb' }), async (req, res) => {
  if (tooManyClientErrors(getClientIp(req))) return res.status(429).json({ ok: false });
  const b = req.body || {};
  const message = String(b.message || '').slice(0, 500);
  if (!message) return res.status(400).json({ ok: false });
  await logEvent('error', 'client', message, {
    page: String(b.page || '').slice(0, 200),
    where: String(b.where || '').slice(0, 300),
    ua: String(req.headers['user-agent'] || '').slice(0, 200),
  });
  res.json({ ok: true });
});

// Anonymous funnel counting (see tcgss_daily_events): only whitelisted event
// and source names are accepted, so the table can't be filled with junk, and
// only daily totals are stored — no cookie, IP, or user id, which is why no
// consent banner is needed for it.
const FUNNEL_EVENTS = ['visit', 'csv_loaded', 'pdf_downloaded', 'signup', 'checkout_started', 'upgraded', 'pricing_viewed', 'tcg_import', 'share_clicked', 'upgrade_prompt', 'limit_hit', 'sample_loaded', 'newsletter_signup', 'pull_sheet', 'enterprise_clicked'];
const FUNNEL_SOURCES = ['direct', 'google', 'google_ads', 'bing', 'reddit', 'youtube', 'tiktok', 'facebook', 'instagram', 'discord', 'twitter', 'tcgplayer', 'email', 'referral', 'affiliate', 'slip', 'whatnot', 'ebay', 'other'];
const tooManyEvents = makeThrottle(120, 10 * 60 * 1000);
router.post('/e', express.json({ limit: '1kb' }), async (req, res) => {
  const b = req.body || {};
  const event = String(b.e || '');
  const source = FUNNEL_SOURCES.includes(b.s) ? b.s : 'other';
  if (!FUNNEL_EVENTS.includes(event)) return res.status(400).json({ ok: false });
  if (tooManyEvents(getClientIp(req)) || !supabaseAdmin) return res.status(202).json({ ok: true });
  try {
    const { error } = await supabaseAdmin.rpc('tcgss_bump_event', { p_event: event, p_source: source });
    if (error) console.error('funnel event failed:', error.message);
  } catch (e) { /* analytics must never break anything */ }
  res.status(202).json({ ok: true });
});

// Weekly seller newsletter. The list lives in tcgss_newsletter_subscribers
// (server-only). Issues are sent one by one from the owner's Gmail, each with
// its own unsubscribe link, so no email service is needed.
// Subscribing always answers the same way, so the form can't be used to find
// out who is on the list. The honeypot field `website` is invisible to people
// and filled in by bots.
const NEWSLETTER_SOURCES = ['footer', 'blog', 'guide', 'home', 'partners', 'account', 'post_download', 'newsletter_page', 'other'];
const tooManyNewsletterSignups = makeThrottle(5, 10 * 60 * 1000);
router.post('/newsletter/subscribe', express.json({ limit: '2kb' }), async (req, res) => {
  const b = req.body || {};
  const email = String(b.email || '').trim().toLowerCase().slice(0, 254);
  if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'Enter a valid email.' });
  if (b.website) return res.json({ ok: true }); // bot
  const ip = getClientIp(req);
  if (tooManyNewsletterSignups(ip)) return res.status(429).json({ error: 'Too many attempts — try again in a few minutes.' });
  if (!supabaseAdmin) return res.status(503).json({ error: 'Signups are unavailable right now.' });
  const source = NEWSLETTER_SOURCES.includes(b.source) ? b.source : 'other';
  try {
    const { error } = await supabaseAdmin.from('tcgss_newsletter_subscribers').upsert(
      { email, status: 'subscribed', source, ip_hash: hashIp(ip), unsubscribed_at: null },
      { onConflict: 'email' });
    if (error) throw error;
    res.json({ ok: true });
  } catch (err) {
    await logError('newsletter', 'subscribe failed:', err);
    res.status(500).json({ error: 'Could not subscribe — try again later.' });
  }
});

// Unsubscribe is a page with a button (GET shows it, POST does it): link
// scanners in mail filters open every link in an email, and a one-GET
// unsubscribe would silently remove people who never clicked.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function newsletterPage(title, body) {
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<meta name="robots" content="noindex"><title>' + title + ' · TCG Speed Shipper</title>' +
    '<style>body{font:16px/1.5 system-ui,sans-serif;background:#f7f5f0;color:#1f1d1a;margin:0;padding:48px 16px}' +
    'main{max-width:440px;margin:0 auto;background:#fff;border:1px solid #e4e0d6;border-radius:12px;padding:28px}' +
    'h1{font-size:22px;margin:0 0 10px}button{font:inherit;background:#2d6a4f;color:#fff;border:0;border-radius:8px;padding:10px 18px;cursor:pointer}' +
    'a{color:#2d6a4f}</style></head><body><main><h1>' + title + '</h1>' + body + '</main></body></html>';
}
router.get('/newsletter/unsubscribe', (req, res) => {
  const t = String(req.query.t || '');
  res.set('Cache-Control', 'no-store');
  if (!UUID_RE.test(t)) return res.status(400).send(newsletterPage('Link not recognized', '<p>This unsubscribe link looks incomplete. Reply to any newsletter email with “unsubscribe” and we’ll take you off by hand.</p>'));
  res.send(newsletterPage('Unsubscribe from the newsletter?',
    '<p>You’ll stop getting the weekly TCG Speed Shipper email. Your account (if you have one) isn’t affected.</p>' +
    '<form method="post"><input type="hidden" name="t" value="' + t + '"><button type="submit">Unsubscribe</button></form>'));
});
router.post('/newsletter/unsubscribe', express.urlencoded({ extended: false, limit: '1kb' }), async (req, res) => {
  const t = String((req.body && req.body.t) || req.query.t || '');
  res.set('Cache-Control', 'no-store');
  if (!UUID_RE.test(t)) return res.status(400).send(newsletterPage('Link not recognized', '<p>Reply to any newsletter email with “unsubscribe” and we’ll take you off by hand.</p>'));
  if (!supabaseAdmin) return res.status(503).send(newsletterPage('Try again shortly', '<p>We couldn’t reach the list just now. Please try again in a minute.</p>'));
  try {
    const { error } = await supabaseAdmin.from('tcgss_newsletter_subscribers')
      .update({ status: 'unsubscribed', unsubscribed_at: new Date().toISOString() })
      .eq('unsub_token', t);
    if (error) throw error;
    // Same answer whether or not the token matched: nothing to learn from it.
    res.send(newsletterPage('You’re unsubscribed', '<p>You won’t get the weekly email anymore. Changed your mind? Sign up again at the bottom of <a href="https://tcgspeedshipper.com/blog/">any blog page</a>.</p>'));
  } catch (err) {
    await logError('newsletter', 'unsubscribe failed:', err);
    res.status(500).send(newsletterPage('Something went wrong', '<p>Please try again, or reply to the email with “unsubscribe”.</p>'));
  }
});

require('./admin')(router, {
  supabaseAdmin: () => supabaseAdmin, stripe: () => stripe,
  requireUser, requireOwner, requireSupabase, logEvent, logError, SITE_URL, PRICE_TO_PLAN,
  liveSubscriptionFor, applySubscriptionToProfile,
});

// Netlify rewrites /api/* to /.netlify/functions/api/:splat. Depending on the
// deploy, the function can receive either the original or the rewritten path,
// so both are mounted — otherwise every API call 404s.
app.use('/api', router);
app.use('/.netlify/functions/api', router);

// Which commit is live, for the admin "production is behind main" check.
// Railway gives the commit at runtime; on Netlify the build writes the file.
if (process.env.RAILWAY_GIT_COMMIT_SHA) {
  const BOOTED_AT = new Date().toISOString();
  app.get('/version.json', (req, res) => {
    res.json({
      commit: process.env.RAILWAY_GIT_COMMIT_SHA,
      context: process.env.RAILWAY_ENVIRONMENT_NAME === 'production' ? 'production' : (process.env.RAILWAY_ENVIRONMENT_NAME || 'railway'),
      branch: process.env.RAILWAY_GIT_BRANCH || null,
      built_at: BOOTED_AT,
      host: 'railway',
    });
  });
}

// The site itself (on Netlify the CDN serves this and the function never sees
// these paths). Pretty URLs: /partners → partners.html, /blog/ → index.html.
const PUBLIC_DIR = require('path').join(__dirname, 'public');
app.use(express.static(PUBLIC_DIR, {
  extensions: ['html'],
  cacheControl: false, // HEADER_RULES decides; everything else revalidates
  setHeaders(res, filePath) {
    // Versioned libraries never change under the same URL. Set here (only
    // runs for files that exist) so a mistyped /vendor/ URL's 404 isn't
    // cached for a year.
    if (filePath.includes(require('path').sep + 'vendor' + require('path').sep)) res.set('Cache-Control', 'public, max-age=31536000, immutable');
    else if (!res.get('Cache-Control')) res.set('Cache-Control', 'public, max-age=0, must-revalidate');
    if (filePath.endsWith('.webmanifest')) res.set('Content-Type', 'application/manifest+json');
  },
}));

// Links that get cut off when shared (seen in the logs as /blog/can-you-ship-t):
// if exactly one post starts with the partial slug, send the reader there.
const BLOG_SLUGS = (() => {
  try { return require('fs').readdirSync(require('path').join(PUBLIC_DIR, 'blog')).filter((f) => f.endsWith('.html') && f !== 'index.html').map((f) => f.slice(0, -5)); }
  catch (e) { return []; }
})();
app.get('/favicon.png', (req, res) => res.redirect(301, '/icon-192.png'));
app.get(/^\/blog\/[a-z0-9-]{8,}$/, (req, res, next) => {
  const part = req.path.slice(6);
  const hits = BLOG_SLUGS.filter((s) => s.startsWith(part));
  if (hits.length === 1) return res.redirect(301, '/blog/' + hits[0]);
  next();
});

app.use((req, res) => {
  if (/^\/(api|\.netlify)\//.test(req.path)) return res.status(404).json({ error: 'Not found', path: req.path });
  res.status(404).type('html').send('<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Page not found · TCG Speed Shipper</title></head>' +
    '<body style="font:16px/1.5 system-ui,sans-serif;background:#f7f5f0;color:#1f1d1a;padding:48px 16px;text-align:center"><h1 style="font-size:24px">Page not found</h1>' +
    '<p>That page doesn’t exist. <a href="/" style="color:#2d6a4f">Go to the label generator</a> or <a href="/blog/" style="color:#2d6a4f">the blog</a>.</p></body></html>');
});

// Railway runs `npm start` → this listener serves the whole site. On Netlify
// the function wrapper imports `app` instead and this doesn't run.
// On boot, prove each secret works (one harmless read each) and log only
// OK/FAILED, never a value, so a new host can be verified from its logs.
async function selfCheck() {
  const out = [];
  if (stripe) {
    // A call the app itself needs (works with a restricted key), which also
    // proves the Base price ID is valid.
    try {
      if (process.env.STRIPE_PRICE_BASE) await stripe.prices.retrieve(process.env.STRIPE_PRICE_BASE);
      else await stripe.balance.retrieve();
      out.push('stripe_key=OK');
    }
    catch (e) { out.push('stripe_key=FAILED(' + (e.type || e.code || 'error') + ')'); }
  } else out.push('stripe_key=MISSING');
  if (supabaseAdmin) {
    try {
      const { error } = await supabaseAdmin.from('tcgss_profiles').select('id').limit(1);
      out.push(error ? 'supabase_key=FAILED(' + (error.code || 'error') + ')' : 'supabase_key=OK');
    } catch (e) { out.push('supabase_key=FAILED(exception)'); }
  } else out.push('supabase_key=MISSING');
  out.push('webhook_secret=' + (process.env.STRIPE_WEBHOOK_SECRET ? (/^whsec_/.test(process.env.STRIPE_WEBHOOK_SECRET) ? 'PRESENT' : 'WRONG_FORMAT') : 'MISSING'));
  ['STRIPE_PRICE_BASE', 'STRIPE_PRICE_PREMIUM'].forEach((k) => out.push(k + '=' + (process.env[k] ? 'SET' : 'MISSING')));
  console.log('[self-check] ' + out.join(' '));
}

if (require.main === module) {
  app.listen(PORT, () => {
    console.log('TCG Speed Shipper listening on port ' + PORT);
    selfCheck().catch(() => {});
  });
}

module.exports = app;
