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
  var ts = subscription.current_period_end ||
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

// Stripe requires the raw body for signature verification, so this route is
// registered before the JSON body parser below.
app.post('/api/stripe-webhook', express.raw({ type: 'application/json' }), async (req, res) => {
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

app.use(express.json());

async function requireUser(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Missing auth token' });
  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data.user) return res.status(401).json({ error: 'Invalid or expired session' });
  req.user = data.user;
  next();
}

app.post('/api/create-checkout-session', requireUser, async (req, res) => {
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
      .single();
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
      await supabaseAdmin.from('tcgss_profiles').update({ stripe_customer_id: customerId }).eq('id', req.user.id);
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      client_reference_id: req.user.id,
      line_items: [{ price: priceId, quantity: 1 }],
      allow_promotion_codes: true,
      success_url: SITE_URL + '/?checkout=success',
      cancel_url: SITE_URL + '/?checkout=cancelled',
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error('create-checkout-session failed:', err);
    res.status(500).json({ error: 'Could not create checkout session' });
  }
});

app.post('/api/create-portal-session', requireUser, async (req, res) => {
  try {
    const { data: profile, error } = await supabaseAdmin
      .from('tcgss_profiles')
      .select('stripe_customer_id')
      .eq('id', req.user.id)
      .single();
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

// Netlify's CDN serves public/ directly in production. This listener only
// runs when the file is executed directly (`node server.js`), for local
// testing of the API routes — it's not used by the Netlify Function.
if (require.main === module) {
  app.listen(PORT, () => {
    console.log('TCG Speed Shipper API listening on port ' + PORT);
  });
}

module.exports = app;
