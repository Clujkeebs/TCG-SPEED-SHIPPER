/* Postage pilot: buy USPS labels through Pitney Bowes from inside the app,
   with tracking, the way eBay and Whatnot sellers do.

   Services:
   - letter: USPS First-Class letter with an Intelligent Mail barcode (scan
     tracking). For plain white envelopes, usually under-$20 orders.
   - ground: USPS Ground Advantage with full tracking. TCGplayer requires
     this (or better) for orders of $49.99 and up.

   Safety:
   - Rollout stage PB_ACCESS: 'owner' (default: only OWNER_EMAIL), 'pilot'
     (owner + PB_PILOT_EMAILS), 'all' (every signed-in user). Everyone else
     only learns that postage is coming soon.
   - Sandbox (free test labels) unless PB_ENV=production AND PB_LIVE_OK=yes,
     so real postage can't be bought by accident.
   - Every label is written to tcgss_postage_labels (service-role only) so it
     can be refunded and reconciled against the Pitney Bowes bill.
   - Unused labels can be refunded (cancelled) by the user who bought them. */
const express = require('express');
const { makePbClient, PbError } = require('./pb-client');

const MAX_LABELS_PER_REQUEST = 50;
// Below this balance, each label is quoted before it's bought (see below).
const LOW_BALANCE_CENTS = 1500;

// Our fee per label, on top of postage passed through at cost. A tracked
// letter at $0.78 postage + $0.21 lands at $0.99, under a dollar and close
// to a plain $0.82 stamp. Ground Advantage stays cheap enough that sellers
// don't leave for free tools. Override with PB_FEE_LETTER / PB_FEE_GROUND.
const DEFAULT_FEES = { letter: 0.21, ground: 0.50 };
function feeFor(service, env = process.env) {
  const v = Number(env['PB_FEE_' + String(service).toUpperCase()]);
  return Number.isFinite(v) && v >= 0 && v <= 5 ? Math.round(v * 100) / 100 : DEFAULT_FEES[service];
}
function priced(service, postage, env) {
  const fee = feeFor(service, env);
  return { postage, fee, price: postage == null ? null : Math.round((postage + fee) * 100) / 100 };
}

// Shipping 360 v2 ids: byCarrier.service + parcels[].parcelType.
const SERVICES = {
  letter: {
    label: 'First-Class letter + IMb scans',
    service: 'FCM', parcelType: 'LETTER',
    dimension: { length: 6, width: 4, height: 0.25 },
    labelSize: 'DOC_4X6',
    minOz: 0.1, maxOz: 3.5,
  },
  ground: {
    label: 'Ground Advantage (full tracking)',
    service: 'UGA', parcelType: 'PKG',
    dimension: { length: 6, width: 4, height: 1 },
    labelSize: 'DOC_4X6',
    minOz: 0.1, maxOz: 15.99,
  },
};

function pbConfig(env = process.env) {
  const live = env.PB_ENV === 'production' && env.PB_LIVE_OK === 'yes';
  return {
    configured: !!(env.PB_API_KEY && env.PB_API_SECRET),
    mode: live ? 'production' : 'sandbox',
    // Real labels are paid from the seller's prepaid balance. Test labels are
    // free, unless PB_BALANCE=on (to rehearse the balance flow in sandbox).
    balance: live || env.PB_BALANCE === 'on',
    pilot: String(env.PB_PILOT_EMAILS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
    access: ['owner', 'pilot', 'all'].includes(env.PB_ACCESS) ? env.PB_ACCESS : 'owner',
  };
}

const clean = (v, max) => String(v == null ? '' : v).replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max || 60);

function pbAddress(a, { requireName = true } = {}) {
  a = a || {};
  const name = clean(a.name || [a.firstName, a.lastName].filter(Boolean).join(' '), 50);
  const out = {
    name,
    addressLine1: clean(a.addr1, 35),
    cityTown: clean(a.city, 30),
    stateProvince: clean(a.state, 2).toUpperCase(),
    postalCode: clean(a.zip, 10),
    countryCode: 'US',
  };
  if (a.addr2) out.addressLine2 = clean(a.addr2, 35);
  if (a.company) out.company = clean(a.company, 50);
  if (a.phone) out.phone = clean(a.phone, 15);
  const missing = [];
  if (requireName && !out.name) missing.push('name');
  if (!out.addressLine1) missing.push('street');
  if (!out.cityTown) missing.push('city');
  if (!/^[A-Z]{2}$/.test(out.stateProvince)) missing.push('state');
  if (!/^\d{5}(-\d{4})?$/.test(out.postalCode)) missing.push('ZIP');
  if (a.country && !/^(us|usa|united states)$/i.test(String(a.country).trim())) missing.push('a US address (international isn\'t supported yet)');
  return { address: out, missing };
}

// Shipping 360 asks for a recipient phone; TCGplayer exports don't have one,
// so the sender's phone (or PB_DEFAULT_PHONE) stands in, as other label
// tools do.
function buildShipment({ from, to, service, weightOz, phone }) {
  const s = SERVICES[service];
  const ph = phone || from.phone || '';
  return {
    fromAddress: ph && !from.phone ? Object.assign({}, from, { phone: ph }) : from,
    toAddress: to.phone || !ph ? to : Object.assign({}, to, { phone: ph }),
    parcels: [{
      parcelType: s.parcelType,
      parcel: Object.assign({ dimUnit: 'IN', weightUnit: 'OZ', weight: weightOz }, s.dimension),
    }],
    rateShopBy: 'carrier',
    byCarrier: { carrier: 'USPS', service: s.service },
    labelSize: s.labelSize,
    labelType: 'SHIPPING_LABEL',
    labelFormat: 'PDF',
  };
}

// Pulls what we need out of a Shipping 360 create-shipment response.
function readLabel(r) {
  r = r || {};
  const doc = (Array.isArray(r.labelLayout) && r.labelLayout.find((l) => l && l.contents)) || null;
  const parcel = Array.isArray(r.parcels) && r.parcels[0];
  return {
    shipmentId: r.shipmentId,
    trackingNumber: r.parcelTrackingNumber || (parcel && parcel.parcelTrackingNumber) || null,
    labelPdfBase64: doc && doc.contentType !== 'URL' ? doc.contents : null,
    rate: Array.isArray(r.rate) ? r.rate[0] : r.rate,
  };
}

const TOPUP_AMOUNTS = [20, 50, 100];
// Custom top-ups: any whole-dollar amount in this range (the cap limits the
// damage a stolen card could do).
const TOPUP_MIN = 20, TOPUP_MAX = 2000;
const validTopup = (a) => Number.isInteger(a) && a >= TOPUP_MIN && a <= TOPUP_MAX;
const cents = (dollars) => Math.round(Number(dollars) * 100);

// Credits a paid postage top-up from a Stripe Checkout session. Returns true
// if the session was a top-up (handled or not), so the webhook can stop there.
// Idempotent: the ledger allows one top-up row per Stripe session id.
async function handleTopupSession(db, session, logError) {
  const md = (session && session.metadata) || {};
  if (md.kind !== 'postage_topup') return false;
  if (session.payment_status !== 'paid') return true; // ACH still pending; async_payment_succeeded comes later
  const userId = md.user_id || session.client_reference_id;
  const amount = Number(session.amount_total);
  if (!userId || !(amount > 0)) { if (logError) await logError('postage.topup', 'Top-up session missing user or amount', session.id); return true; }
  const { data, error } = await db.rpc('tcgss_postage_credit', { p_user: userId, p_cents: amount, p_kind: 'topup', p_ref: session.id });
  if (error || !data || !data.ok) { if (logError) await logError('postage.topup', 'Could not credit top-up', session.id, error || data); }
  return true;
}

function money(r) {
  const n = Number(r && (r.totalCarrierCharge != null ? r.totalCarrierCharge : r.baseCharge));
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

module.exports = function mountPostageRoutes(router, d) {
  const { supabaseAdmin, requireUser, requireSupabase, OWNER_EMAIL, logError } = d;
  const stripe = d.stripe || (() => null);
  const SITE_URL = d.SITE_URL || 'https://tcgspeedshipper.com';
  async function balanceOf(userId) {
    const { data, error } = await supabaseAdmin().rpc('tcgss_postage_balance', { p_user: userId });
    if (error) throw error;
    return Number(data) || 0;
  }
  const env = d.env || process.env;
  const fetchImpl = d.fetchImpl || fetch;
  let client = null, clientKey = '';
  function pb() {
    const cfg = pbConfig(env);
    const k = cfg.mode + ':' + env.PB_API_KEY;
    if (!client || clientKey !== k) { client = makePbClient({ key: env.PB_API_KEY, secret: env.PB_API_SECRET, env: cfg.mode, partnerId: env.PB_PARTNER_ID, carrierAccountId: env.PB_CARRIER_ACCOUNT_ID, fetchImpl }); clientKey = k; }
    return client;
  }

  function allowed(user) {
    const email = String((user && user.email) || '').toLowerCase();
    if (!email) return false;
    if (email === String(OWNER_EMAIL || '').toLowerCase()) return true;
    const cfg = pbConfig(env);
    if (cfg.access === 'all') return true;
    return cfg.access === 'pilot' && cfg.pilot.includes(email);
  }
  function gate(req, res, next) {
    if (!allowed(req.user)) return res.status(403).json({ error: 'Postage labels with tracking are coming soon.' });
    if (!pbConfig(env).configured) return res.status(503).json({ error: 'Postage isn\'t set up yet (Pitney Bowes keys missing).' });
    next();
  }
  const guard = [express.json({ limit: '200kb' }), requireSupabase, requireUser, gate];

  function pbFail(res, err, what) {
    if (err instanceof PbError) {
      return res.status(err.status >= 500 ? 502 : 400).json({ error: what + ': ' + err.message });
    }
    if (logError) logError('postage', what + ' failed:', err);
    return res.status(502).json({ error: what + ' failed. Please try again.' });
  }

  // What the app needs to decide whether to show the postage panel.
  router.get('/postage/status', requireSupabase, requireUser, (req, res) => {
    const cfg = pbConfig(env);
    // Not in the rollout yet: say it's coming, nothing more.
    if (!allowed(req.user)) return res.json({ allowed: false, comingSoon: true });
    res.json({ allowed: true, configured: cfg.configured, mode: cfg.mode, balance: cfg.balance, topupAmounts: TOPUP_AMOUNTS, topupMin: TOPUP_MIN, topupMax: TOPUP_MAX, services: Object.keys(SERVICES).map((k) => ({ id: k, label: SERVICES[k].label, maxOz: SERVICES[k].maxOz, fee: feeFor(k, env) })) });
  });

  // Quote one shipment: { from, to, service, weightOz } → { amount }.
  router.post('/postage/rates', guard, async (req, res) => {
    const b = req.body || {};
    const s = SERVICES[b.service];
    if (!s) return res.status(400).json({ error: 'Unknown service' });
    const from = pbAddress(b.from), to = pbAddress(b.to);
    if (from.missing.length) return res.status(400).json({ error: 'Return address needs: ' + from.missing.join(', ') });
    if (to.missing.length) return res.status(400).json({ error: 'Address needs: ' + to.missing.join(', ') });
    const oz = Number(b.weightOz) || 1;
    if (oz < s.minOz || oz > s.maxOz) return res.status(400).json({ error: s.label + ' allows up to ' + s.maxOz + ' oz' });
    try {
      const shipment = buildShipment({ from: from.address, to: to.address, service: b.service, weightOz: oz, phone: env.PB_DEFAULT_PHONE });
      const r = await pb().rate(shipment);
      const rate = r && (Array.isArray(r.rate) ? r.rate[0] : r.rate || (r.rates && r.rates[0]));
      res.json(Object.assign({ service: b.service, mode: pbConfig(env).mode }, priced(b.service, money(rate), env)));
    } catch (err) { pbFail(res, err, 'Rate quote'); }
  });

  // Buy labels: { from, labels: [{ ref, to, service, weightOz }] }.
  // Returns one result per label, in order; a failure on one address doesn't
  // stop the rest.
  router.post('/postage/labels', guard, async (req, res) => {
    const b = req.body || {};
    const list = Array.isArray(b.labels) ? b.labels : [];
    if (!list.length) return res.status(400).json({ error: 'No labels requested' });
    if (list.length > MAX_LABELS_PER_REQUEST) return res.status(400).json({ error: 'Up to ' + MAX_LABELS_PER_REQUEST + ' labels at a time' });
    const from = pbAddress(b.from);
    if (from.missing.length) return res.status(400).json({ error: 'Return address needs: ' + from.missing.join(', ') });
    const mode = pbConfig(env).mode;
    const useBalance = pbConfig(env).balance;
    if (useBalance) {
      let bal;
      try { bal = await balanceOf(req.user.id); } catch (e) { return res.status(500).json({ error: 'Could not read your postage balance' }); }
      if (bal <= 0) return res.status(402).json({ error: 'Add funds to your postage balance first.', balanceCents: bal });
    }
    const results = [];
    let outOfFunds = false;
    let known = null; // running balance in cents, when the balance applies
    if (useBalance) { try { known = await balanceOf(req.user.id); } catch (e) { known = null; } }
    for (const item of list) {
      if (outOfFunds) { results.push({ ref: clean(item && item.ref, 40), ok: false, error: 'Not bought: balance ran out' }); continue; }
      const ref = clean(item && item.ref, 40);
      const s = SERVICES[item && item.service];
      const to = pbAddress(item && item.to);
      const oz = Number(item && item.weightOz) || 1;
      if (!s) { results.push({ ref, ok: false, error: 'Unknown service' }); continue; }
      if (to.missing.length) { results.push({ ref, ok: false, error: 'Address needs: ' + to.missing.join(', ') }); continue; }
      if (oz < s.minOz || oz > s.maxOz) { results.push({ ref, ok: false, error: s.label + ' allows up to ' + s.maxOz + ' oz' }); continue; }
      try {
        const shipment = buildShipment({ from: from.address, to: to.address, service: item.service, weightOz: oz, phone: env.PB_DEFAULT_PHONE });
        // Letter postage can't be voided, so when the balance is getting low,
        // quote first and stop before buying a label nobody can pay for.
        if (useBalance && known != null && known < LOW_BALANCE_CENTS) {
          const q = await pb().rate(shipment);
          const est = priced(item.service, money(q && (Array.isArray(q.rate) ? q.rate[0] : q.rate)), env).price;
          if (est == null || cents(est) > known) {
            outOfFunds = true;
            results.push({ ref, ok: false, error: 'Not bought: balance too low' });
            continue;
          }
        }
        const l = readLabel(await pb().createShipment(shipment));
        const out = {
          ref, ok: true, service: item.service,
          shipmentId: l.shipmentId, trackingNumber: l.trackingNumber,
          labelPdfBase64: l.labelPdfBase64,
        };
        Object.assign(out, priced(item.service, money(l.rate), env));
        if (useBalance) {
          // Pay for it from the balance; if that fails, void the label at once
          // so we never hand out postage nobody paid for.
          const debit = out.price == null ? { data: { ok: false } }
            : await supabaseAdmin().rpc('tcgss_postage_debit', { p_user: req.user.id, p_cents: cents(out.price), p_ref: out.shipmentId });
          if (debit.error || !debit.data || !debit.data.ok) {
            try { await pb().cancelShipment(out.shipmentId); } catch (e) { if (logError) logError('postage', 'void after failed debit failed:', out.shipmentId, e); }
            outOfFunds = true;
            results.push({ ref, ok: false, error: out.price == null ? 'No price came back for this label' : 'Not bought: balance too low' });
            continue;
          }
          out.balanceCents = debit.data.balance;
          known = Number(debit.data.balance);
        }
        results.push(out);
        const { error } = await supabaseAdmin().from('tcgss_postage_labels').insert({
          user_id: req.user.id, shipment_id: out.shipmentId, tracking_number: out.trackingNumber,
          service: item.service, amount: out.postage, fee: out.fee, price: out.price, mode, order_ref: ref || null, status: 'purchased',
          label_pdf: out.labelPdfBase64,
        });
        if (error && logError) logError('postage', 'ledger insert failed:', error);
      } catch (err) {
        results.push({ ref, ok: false, error: err instanceof PbError ? err.message : 'Label failed, please retry' });
        if (!(err instanceof PbError) && logError) logError('postage', 'label failed:', err);
      }
    }
    const sum = (k) => Math.round(results.reduce((t, r) => t + (r.ok && r[k] ? r[k] : 0), 0) * 100) / 100;
    const body = { mode, results, total: sum('price'), postage: sum('postage'), fees: sum('fee') };
    if (useBalance) { try { body.balanceCents = await balanceOf(req.user.id); } catch (e) { /* shown on next load */ } }
    res.json(body);
  });

  // Refund an unused label (only the buyer's own).
  router.post('/postage/labels/:shipmentId/refund', guard, async (req, res) => {
    const id = clean(req.params.shipmentId, 60);
    const { data: row, error } = await supabaseAdmin().from('tcgss_postage_labels').select('user_id, status, price, mode, service').eq('shipment_id', id).maybeSingle();
    if (error) return res.status(500).json({ error: 'Could not look up that label' });
    if (!row || row.user_id !== req.user.id) return res.status(404).json({ error: 'Label not found' });
    if (row.status !== 'purchased') return res.status(409).json({ error: 'That label was already ' + row.status });
    // USPS doesn't refund First-Class letter (IMb) postage, so neither can we.
    if (row.service === 'letter') return res.status(409).json({ error: 'Letter postage can\'t be refunded (USPS rule). Only package labels can.' });
    try {
      const r = await pb().cancelShipment(id);
      await supabaseAdmin().from('tcgss_postage_labels').update({ status: 'refund_requested', refunded_at: new Date().toISOString() }).eq('shipment_id', id);
      // Pilot policy: the label price goes straight back to the balance (one
      // refund row per shipment). Reconcile against PB's refund report; PB
      // can still deny a refund for a label that was actually mailed.
      let balanceCents;
      if (pbConfig(env).balance && row.price > 0) {
        const c = await supabaseAdmin().rpc('tcgss_postage_credit', { p_user: req.user.id, p_cents: cents(row.price), p_kind: 'refund', p_ref: id });
        if (c.error && logError) logError('postage', 'refund credit failed:', id, c.error);
        balanceCents = c.data && c.data.balance;
      }
      res.json({ ok: true, status: (r && r.status) || 'INITIATED', balanceCents });
    } catch (err) { pbFail(res, err, 'Refund'); }
  });

  // Recent labels (for reprint and refund), newest first.
  router.get('/postage/labels', requireSupabase, requireUser, gate, async (req, res) => {
    const { data, error } = await supabaseAdmin().from('tcgss_postage_labels')
      .select('shipment_id, tracking_number, service, price, mode, order_ref, status, created_at')
      .eq('user_id', req.user.id).order('created_at', { ascending: false }).limit(50);
    if (error) { if (logError) logError('postage', 'label list failed:', error); return res.status(500).json({ error: 'Could not load your labels' }); }
    res.json({ labels: data || [] });
  });

  // Reprint: the PDF saved when the label was bought (only the buyer's own).
  router.get('/postage/labels/:shipmentId/pdf', requireSupabase, requireUser, gate, async (req, res) => {
    const id = clean(req.params.shipmentId, 60);
    const { data: row, error } = await supabaseAdmin().from('tcgss_postage_labels').select('user_id, label_pdf, status').eq('shipment_id', id).maybeSingle();
    if (error) return res.status(500).json({ error: 'Could not look up that label' });
    if (!row || row.user_id !== req.user.id) return res.status(404).json({ error: 'Label not found' });
    if (row.status !== 'purchased') return res.status(409).json({ error: 'That label was refunded, so it can\'t be printed' });
    if (!row.label_pdf) return res.status(404).json({ error: 'No saved PDF for this label' });
    res.json({ labelPdfBase64: row.label_pdf });
  });

  // Prepaid balance and recent activity.
  router.get('/postage/balance', requireSupabase, requireUser, gate, async (req, res) => {
    try {
      const { data, error } = await supabaseAdmin().from('tcgss_postage_ledger').select('cents, kind, ref, created_at')
        .eq('user_id', req.user.id).order('created_at', { ascending: false }).limit(20);
      if (error) throw error;
      res.json({ balanceCents: await balanceOf(req.user.id), activity: data || [] });
    } catch (err) { if (logError) logError('postage', 'balance read failed:', err); res.status(500).json({ error: 'Could not read your balance' }); }
  });

  // Add funds: one Stripe Checkout payment, then labels just draw down the
  // balance (no checkout per label). Credited by the Stripe webhook.
  router.post('/postage/topup', guard, async (req, res) => {
    const amount = Number(req.body && req.body.amount);
    if (!validTopup(amount)) return res.status(400).json({ error: 'Enter a whole-dollar amount from $' + TOPUP_MIN + ' to $' + TOPUP_MAX.toLocaleString('en-US') + '.' });
    if (!pbConfig(env).balance) return res.status(409).json({ error: 'Test mode labels are free, so there\'s nothing to top up yet.' });
    const s = stripe();
    if (!s) return res.status(503).json({ error: 'Payments aren\'t available right now' });
    try {
      const session = await s.checkout.sessions.create({
        mode: 'payment',
        client_reference_id: req.user.id,
        customer_email: req.user.email,
        line_items: [{ quantity: 1, price_data: { currency: 'usd', unit_amount: cents(amount), product_data: { name: 'Postage balance ($' + amount + ')', description: 'Prepaid USPS postage and label fees in TCG Speed Shipper' } } }],
        metadata: { kind: 'postage_topup', user_id: req.user.id },
        payment_intent_data: { metadata: { kind: 'postage_topup', user_id: req.user.id } },
        success_url: SITE_URL + '/?postage=added',
        cancel_url: SITE_URL + '/?postage=cancelled',
      });
      res.json({ url: session.url });
    } catch (err) { if (logError) logError('postage', 'top-up checkout failed:', err); res.status(502).json({ error: 'Could not start the payment. Please try again.' }); }
  });

  router.get('/postage/track/:trackingNumber', express.json(), requireSupabase, requireUser, gate, async (req, res) => {
    try {
      const r = await pb().tracking(clean(req.params.trackingNumber, 40));
      const cur = (r && r.currentStatus) || {};
      const where = (l) => [l && l.city, l && l.stateOrProvince].filter(Boolean).join(', ');
      res.json({
        status: cur.status || cur.eventDescription || (r && typeof r.status === 'string' ? r.status : null),
        estimatedDelivery: (r && r.estimatedDeliveryDate) || null,
        events: ((r && r.trackingHistory) || []).slice(0, 20).map((e) => ({
          at: e.eventDate || '', what: e.eventDescription || e.carrierEventDescription || e.status, where: where(e.eventLocation),
        })),
      });
    } catch (err) { pbFail(res, err, 'Tracking'); }
  });
};

module.exports.pbConfig = pbConfig;
module.exports.pbAddress = pbAddress;
module.exports.buildShipment = buildShipment;
module.exports.SERVICES = SERVICES;
module.exports.feeFor = feeFor;
module.exports.handleTopupSession = handleTopupSession;
module.exports.TOPUP_AMOUNTS = TOPUP_AMOUNTS;
