const express = require('express');
const Stripe = require('stripe');
const { createClient } = require('@supabase/supabase-js');

const PORT = process.env.PORT || 3000;
const SITE_URL = (process.env.PUBLIC_SITE_URL || '').replace(/\/$/, '') || 'http://localhost:' + PORT;

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const supabaseAdmin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

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
  const plan = active ? (PRICE_TO_PLAN[priceId] || 'free') : 'free';
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
  else if (coupon.amount_off) desc = '$' + (coupon.amount_off / 100).toFixed(2) + ' off';
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
  res.json({
    ok: true,
    config: {
      stripe_secret: !!process.env.STRIPE_SECRET_KEY,
      stripe_webhook_secret: !!process.env.STRIPE_WEBHOOK_SECRET,
      price_base: !!process.env.STRIPE_PRICE_BASE,
      price_premium: !!process.env.STRIPE_PRICE_PREMIUM,
      supabase_url: !!process.env.SUPABASE_URL,
      supabase_service_key: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
      site_url: SITE_URL,
    },
  });
});

// Stripe signature verification needs the exact raw bytes, so this route gets
// express.raw instead of the JSON parser used by the routes below.
router.post('/stripe-webhook', express.raw({ type: '*/*' }), async (req, res) => {
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
          const { error } = await supabaseAdmin
            .from('tcgss_profiles')
            .update({
              stripe_customer_id: session.customer,
              stripe_subscription_id: subscription.id,
              stripe_price_id: priceId,
              plan: PRICE_TO_PLAN[priceId] || 'free',
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
        const { error } = await supabaseAdmin
          .from('tcgss_profiles')
          .update({ plan: 'free', subscription_status: 'canceled', updated_at: new Date().toISOString() })
          .eq('stripe_customer_id', subscription.customer)
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

router.get('/validate-promo-code', async (req, res) => {
  try {
    const promo = await findPromotionCode(req.query.code);
    if (!promo) return res.json({ valid: false, error: 'That code is not valid or has expired.' });
    res.json({ valid: true, code: promo.code, description: describeCoupon(promo.coupon) });
  } catch (err) {
    console.error('validate-promo-code failed:', err);
    res.status(500).json({ valid: false, error: 'Could not check that code right now.' });
  }
});

router.post('/create-checkout-session', express.json(), requireUser, async (req, res) => {
  try {
    const plan = req.body && req.body.plan;
    const priceId = plan === 'premium' ? process.env.STRIPE_PRICE_PREMIUM
      : plan === 'base' ? process.env.STRIPE_PRICE_BASE
      : null;
    if (!priceId) return res.status(400).json({ error: 'Unknown plan' });

    const { data: profile, error: profileErr } = await supabaseAdmin
      .from('tcgss_profiles')
      .select('stripe_customer_id, is_lifetime_free')
      .eq('id', req.user.id)
      .maybeSingle();
    if (profileErr) throw profileErr;

    if (profile && profile.is_lifetime_free) {
      return res.status(400).json({ error: 'This account already has Premium free, permanently — no checkout needed.' });
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

    // Re-validate the code server-side — never trust the client's earlier check.
    const appliedPromo = await findPromotionCode(req.body && req.body.promoCode);

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
    }

    res.json({ url: session.url, promoApplied: !!appliedPromo });
  } catch (err) {
    console.error('create-checkout-session failed:', err);
    res.status(500).json({ error: 'Could not create checkout session' });
  }
});

router.post('/create-portal-session', express.json(), requireUser, async (req, res) => {
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
