const express = require('express');
const Stripe = require('stripe');
const { createClient } = require('@supabase/supabase-js');

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

function requireSupabase(req, res, next) {
  if (!supabaseAdmin) {
    console.error('Request to ' + req.path + ' with Supabase unconfigured. Missing: ' + (MISSING_SUPABASE.join(', ') || 'client init failed'));
    return res.status(503).json({ error: 'The server is not configured correctly (Supabase). This is a server-side problem, not your account.' });
  }
  next();
}

function requireStripe(req, res, next) {
  if (!stripe) {
    console.error('Request to ' + req.path + ' with Stripe unconfigured.');
    return res.status(503).json({ error: 'The server is not configured correctly (Stripe). This is a server-side problem, not your account.' });
  }
  next();
}

const PRICE_TO_PLAN = {};
if (process.env.STRIPE_PRICE_BASE) PRICE_TO_PLAN[process.env.STRIPE_PRICE_BASE] = 'base';
if (process.env.STRIPE_PRICE_PREMIUM) PRICE_TO_PLAN[process.env.STRIPE_PRICE_PREMIUM] = 'premium';

const app = express();
app.set('trust proxy', 1);

function periodEndOf(subscription) {
  const ts = subscription.current_period_end ||
    (subscription.items && subscription.items.data[0] && subscription.items.data[0].current_period_end);
  return ts ? new Date(ts * 1000).toISOString() : null;
}

async function applySubscriptionToProfile(subscription) {
  const priceId = subscription.items.data[0].price.id;
  const active = ['active', 'trialing'].includes(subscription.status);
  // An active subscription on a price we don't recognise means our price env
  // vars are wrong or a price was swapped in the Stripe dashboard. Refuse to
  // write a plan at all in that case rather than silently recording a paying
  // customer as 'free' and cutting off the thing they just paid for.
  if (active && !PRICE_TO_PLAN[priceId]) {
    console.error('Active subscription ' + subscription.id + ' is on unrecognised price ' + priceId + ' — leaving plan untouched. Check STRIPE_PRICE_BASE/STRIPE_PRICE_PREMIUM.');
    return;
  }
  const plan = active ? PRICE_TO_PLAN[priceId] : 'free';
  // is_lifetime_free accounts (the owner) are never touched by Stripe events,
  // even in a freak stripe_customer_id collision.
  const { error } = await supabaseAdmin
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
    .eq('is_lifetime_free', false);
  if (error) console.error('Failed to update profile from subscription event:', error);
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
const signupAttempts = new Map();
function tooManySignupAttempts(ip) {
  const now = Date.now();
  const windowMs = 10 * 60 * 1000;
  const maxAttempts = 8;
  const recent = (signupAttempts.get(ip) || []).filter((t) => now - t < windowMs);
  recent.push(now);
  signupAttempts.set(ip, recent);
  return recent.length > maxAttempts;
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
    supabase_url: !!process.env.SUPABASE_URL,
    supabase_service_key: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
    site_url: SITE_URL,
  };
  const missing = Object.keys(config).filter((k) => config[k] === false);
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
    return res.status(400).send('Webhook Error: ' + err.message);
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        const userId = session.client_reference_id;
        if (userId && session.subscription) {
          const subscription = await stripe.subscriptions.retrieve(session.subscription);
          const priceId = subscription.items.data[0].price.id;
          if (!PRICE_TO_PLAN[priceId]) {
            // Someone just paid for a price we can't map to a plan. Record the
            // billing link so support can see it, but never write plan: 'free'
            // over a completed payment.
            console.error('Checkout completed on unrecognised price ' + priceId + ' for user ' + userId + ' — plan not set. Check STRIPE_PRICE_BASE/STRIPE_PRICE_PREMIUM.');
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
          if (error) console.error('Failed to attach subscription to profile:', error);
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
        if (error) console.error('Failed to downgrade profile on cancellation:', error);
        break;
      }
      default:
        break;
    }
  } catch (err) {
    console.error('Error handling Stripe webhook event:', err);
    return res.status(500).send('Webhook handler failed');
  }

  res.json({ received: true });
});

router.post('/signup', express.json(), requireSupabase, async (req, res) => {
  try {
    const ip = req.headers['x-forwarded-for'] || req.ip || 'unknown';
    if (tooManySignupAttempts(ip)) {
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
    console.error('signup failed:', err);
    res.status(500).json({ error: 'Could not create account' });
  }
});

router.get('/validate-promo-code', requireStripe, async (req, res) => {
  try {
    const promo = await findPromotionCode(req.query.code);
    if (!promo) return res.json({ valid: false, error: 'That code is not valid or has expired.' });
    res.json({ valid: true, code: promo.code, description: describeCoupon(promo.coupon) });
  } catch (err) {
    console.error('validate-promo-code failed:', err);
    res.status(500).json({ valid: false, error: 'Could not check that code right now.' });
  }
});

router.post('/create-checkout-session', express.json(), requireStripe, requireSupabase, requireUser, async (req, res) => {
  try {
    const plan = req.body && req.body.plan;
    const priceId = plan === 'premium' ? process.env.STRIPE_PRICE_PREMIUM
      : plan === 'base' ? process.env.STRIPE_PRICE_BASE
      : null;
    if (!priceId) return res.status(400).json({ error: 'Unknown plan' });

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
      .select('stripe_customer_id, is_lifetime_free')
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

    const appliedPromo = await promoLookup;

    const sessionParams = {
      mode: 'subscription',
      customer: customerId,
      client_reference_id: req.user.id,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: SITE_URL + '/?checkout=success',
      cancel_url: SITE_URL + '/?checkout=cancelled',
    };
    if (appliedPromo) sessionParams.discounts = [{ promotion_code: appliedPromo.id }];
    else sessionParams.allow_promotion_codes = true;

    let session;
    let promoApplied = !!appliedPromo;
    try {
      session = await stripe.checkout.sessions.create(sessionParams);
    } catch (stripeErr) {
      if (!appliedPromo) throw stripeErr;
      // The code is valid but doesn't apply to this particular plan (e.g. it's
      // restricted to a different product) — fall back rather than blocking
      // checkout entirely; the client tells the user the discount didn't apply.
      console.error('Checkout with promo code failed, retrying without it:', stripeErr.message);
      delete sessionParams.discounts;
      sessionParams.allow_promotion_codes = true;
      session = await stripe.checkout.sessions.create(sessionParams);
      promoApplied = false;
    }

    res.json({ url: session.url, promoApplied: promoApplied });
  } catch (err) {
    console.error('create-checkout-session failed:', err);
    res.status(500).json({ error: 'Could not create checkout session' });
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
      return res.status(400).json({ error: 'No billing account yet — upgrade to a paid plan first.' });
    }

    const portalSession = await stripe.billingPortal.sessions.create({
      customer: profile.stripe_customer_id,
      return_url: SITE_URL + '/',
    });

    res.json({ url: portalSession.url });
  } catch (err) {
    console.error('create-portal-session failed:', err);
    res.status(500).json({ error: 'Could not open billing portal' });
  }
});

// Netlify rewrites /api/* to /.netlify/functions/api/:splat. Depending on the
// deploy, the function can receive either the original or the rewritten path,
// so both are mounted — otherwise every API call 404s.
app.use('/api', router);
app.use('/.netlify/functions/api', router);

app.use((req, res) => {
  res.status(404).json({ error: 'Not found', path: req.path });
});

// Netlify's CDN serves public/ in production. This listener only runs when the
// file is executed directly (`node server.js`) for local API testing.
if (require.main === module) {
  app.listen(PORT, () => {
    console.log('TCG Speed Shipper API listening on port ' + PORT);
  });
}

module.exports = app;
