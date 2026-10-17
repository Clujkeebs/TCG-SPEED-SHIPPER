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
// Identical quotes (same addresses, service, weight) are remembered for ten
// minutes, so editing a batch or asking again does not hit the carrier again.
const QUOTE_TTL_MS = 10 * 60 * 1000;
const QUOTE_CACHE_MAX = 300;
const quoteCache = new Map();
const quoteKey = (mode, from, to, service, oz) => JSON.stringify([mode, from, to, service, oz]);
// Below this balance, each label is quoted before it's bought (see below).
const LOW_BALANCE_CENTS = 1500;

// Our fee per label, on top of postage passed through at cost.
// Letters: the owner set the rule on Oct 6 (keep 5-10 cents on every label)
// and left the letter price to Claude on Oct 14. Decision: 15 cents on Free and
// Base, 12 on Premium, 10 on Pro, so a tracked 1 oz letter lands around
// $0.88-0.93 (the stamp is $0.82) and still keeps 6-11 cents after card fees
// (docs/pricing-plan.md). Package labels stay at one fee until pricing v2 is
// built. Override with PB_FEE_LETTER / PB_FEE_GROUND (wins for every plan).
const LETTER_FEE_BY_PLAN = { free: 0.15, base: 0.15, premium: 0.12, pro: 0.10 };
const DEFAULT_FEES = { letter: 0.15, ground: 0.50 };
function feeFor(service, env = process.env, plan) {
  const v = Number(env['PB_FEE_' + String(service).toUpperCase()]);
  if (Number.isFinite(v) && v >= 0 && v <= 5) return Math.round(v * 100) / 100;
  if (service === 'letter' && LETTER_FEE_BY_PLAN[plan] != null) return LETTER_FEE_BY_PLAN[plan];
  return DEFAULT_FEES[service];
}
function priced(service, postage, env, plan) {
  const fee = feeFor(service, env, plan);
  return { postage, fee, price: postage == null ? null : Math.round((postage + fee) * 100) / 100 };
}
// The plan that sets a seller's fee. Mirrors tcgss_get_status: lifetime-free
// accounts and anyone inside a free_until window count as Premium.
function effectivePlan(profile, now = Date.now()) {
  if (!profile) return 'free';
  if (profile.is_lifetime_free) return 'premium';
  if (profile.free_until && new Date(profile.free_until).getTime() > now) return 'premium';
  return LETTER_FEE_BY_PLAN[profile.plan] != null ? profile.plan : 'free';
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
    rate: rateOf(r),
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

// The price quote inside a Shipping 360 answer. The docs say { rate: [ {...} ] } (or one rate object on a purchase); the
// live sandbox answers a quote with { rates: [ { rate: {...} } ] } (seen in the Oct 17 boot self-check: letter 0.78,
// package 6.24). Accept all of those shapes, and a bare rate object. Returns the rate object or null.
function rateOf(r) {
  if (!r || typeof r !== 'object') return null;
  const first = (v) => (Array.isArray(v) ? v[0] : v);
  const isObj = (v) => v !== null && typeof v === 'object';
  const direct = first(r.rate);
  if (isObj(direct)) return direct;
  const wrapped = first(r.rates);
  if (isObj(wrapped)) return isObj(first(wrapped.rate)) ? first(wrapped.rate) : wrapped;
  return null;
}
// A rate's price in dollars, or null when there is none. A missing price must never read as $0.00 (Number(null) is 0), and
// real postage is never zero or negative, so those are "no price" too.
function money(r) {
  if (!r || typeof r !== 'object') return null;
  const v = r.totalCarrierCharge != null ? r.totalCarrierCharge : r.baseCharge;
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
}

// A read-only look at Pitney Bowes for the boot self-check (server.js): the login, the USPS account and one price for
// each service, using two public addresses. Nothing is bought, stored or refunded. It answers in short words and never
// shows a key or a token, so a deploy's log says how the real Pitney Bowes behaves without waiting for a seller's click:
//   "pb_mode=sandbox pb_account=OK(USPS) pb_rate_letter=OK($0.78) pb_rate_ground=FAILED(400 Invalid value for ...)"
const SELFCHECK_FROM = { name: 'TCG Speed Shipper', addr1: '1600 Amphitheatre Parkway', city: 'Mountain View', state: 'CA', zip: '94043' };
const SELFCHECK_TO = { name: 'Self Check', addr1: '350 Fifth Avenue', city: 'New York', state: 'NY', zip: '10118' };
async function pbSelfCheck(env = process.env, fetchImpl = fetch) {
  const cfg = pbConfig(env);
  if (!cfg.configured) return 'pb=NOT_SET';
  const client = makePbClient({ key: env.PB_API_KEY, secret: env.PB_API_SECRET, env: cfg.mode, partnerId: env.PB_PARTNER_ID, carrierAccountId: env.PB_CARRIER_ACCOUNT_ID, fetchImpl, retryBaseMs: Number(env.PB_RETRY_BASE_MS) || 400 });
  const why = (e) => '(' + (e instanceof PbError ? e.status + ' ' : '') + String((e && e.message) || e).replace(/\s+/g, ' ').slice(0, 140) + ')';
  const out = ['pb_mode=' + cfg.mode];
  let accountId = null;
  try {
    const r = await client.carrierAccounts();
    const list = (r && r.data && r.data.carrierAccounts) || (r && r.carrierAccounts) || [];
    const usps = list.find((a) => /usps/i.test(String(a.carrierName || a.carrier || '')));
    accountId = (usps && usps.carrierAccountId) || null;
    out.push(usps ? 'pb_account=OK(USPS)' : 'pb_account=NO_USPS(' + list.length + ' accounts)');
  } catch (e) { out.push('pb_account=FAILED' + why(e)); }
  // The postage wallet labels are paid from, and which payment methods can refill it (codes and status only, never an account number).
  if (accountId) {
    try {
      const w = await client.walletBalance(accountId);
      const bal = Number(w && w.walletAccount && w.walletAccount.balanceAvailable);
      out.push(Number.isFinite(bal) ? 'pb_wallet=OK($' + bal.toFixed(2) + ')' : 'pb_wallet=NO_BALANCE');
    } catch (e) { out.push('pb_wallet=FAILED' + why(e)); }
    try {
      const m = await client.paymentMethods(accountId);
      const methods = (m && Array.isArray(m.paymentMethods) ? m.paymentMethods : []).map((x) => String(x.paymentMethodCode || '?') + ':' + String(x.paymentMethodStatus || '?'));
      out.push('pb_pay_methods=' + methods.length + (methods.length ? '(' + methods.join(',') + ')' : ''));
    } catch (e) { out.push('pb_pay_methods=FAILED' + why(e)); }
  }
  const from = pbAddress(SELFCHECK_FROM).address;
  const to = pbAddress(SELFCHECK_TO).address;
  for (const service of Object.keys(SERVICES)) {
    try {
      const q = await client.rate(buildShipment({ from, to, service, weightOz: service === 'letter' ? 1 : 8, phone: env.PB_DEFAULT_PHONE || '6502530000' }));
      const price = money(rateOf(q));
      // No price found: say what the answer looked like (a rate quote holds no secrets), so the parser can be fixed from the log.
      out.push('pb_rate_' + service + (price == null ? '=NO_PRICE shape=' + JSON.stringify(q).replace(/\s+/g, ' ').slice(0, 700) : '=OK($' + price.toFixed(2) + ')'));
    } catch (e) { out.push('pb_rate_' + service + '=FAILED' + why(e)); }
  }
  // Rehearsal of a purchase and a refund, ONLY in the sandbox (free test labels) and only when PB_SELFTEST_BUY=on is set on
  // the server (set it for one deploy, read the log, remove it). It says what the answers hold, never the label itself.
  if (env.PB_SELFTEST_BUY === 'on' && cfg.mode === 'sandbox') {
    // Test money for the sandbox wallet, if asked: PB_SELFTEST_REFILL=<dollars> (sandbox only; the payment method on file is a test one).
    const refill = Number(env.PB_SELFTEST_REFILL);
    if (accountId && Number.isFinite(refill) && refill > 0 && refill <= 500) {
      try {
        const f = await client.walletRefill(accountId, refill);
        out.push('pb_refill=' + (f && f.status === 'SUCCESS' ? 'OK' : 'NOT_SUCCESS') + '(status=' + (f && f.status) + ' balance=' + (f && f.balanceAvailable) + ')');
      } catch (e) { out.push('pb_refill=FAILED' + why(e)); }
    }
    // The letter's label size is probed: every size we have a reason to try, each answered with PB's own words (a size PB
    // accepts moves on to the next check, like the wallet balance; a size it refuses says "Invalid label paper size").
    const sizes = { letter: String(env.PB_SELFTEST_LETTER_SIZES || 'DOC_4X6,DOC_6X4,6X4,DOC_9X4,9X4,DOC_4X8,DOC_8X11').split(',').map((x) => x.trim()).filter(Boolean), ground: [null] };
    for (const service of ['letter', 'ground']) {
      let bought = null;
      for (const size of sizes[service]) {
        const tag = 'pb_buy_' + service + (size ? '[' + size + ']' : '');
        try {
          const ship = buildShipment({ from, to, service, weightOz: service === 'letter' ? 1 : 8, phone: env.PB_DEFAULT_PHONE || '6502530000' });
          if (size) ship.labelSize = size;
          const r = await client.createShipment(ship, 'selftest-' + service + '-' + Date.now());
          const l = readLabel(r);
          bought = l.shipmentId;
          const docs = (Array.isArray(r && r.labelLayout) ? r.labelLayout : []).map((d) => ({ type: d && d.contentType, format: d && d.fileFormat, size: d && d.size, length: d && d.contents ? String(d.contents).length : 0 }));
          out.push(tag + '=' + (l.shipmentId && l.trackingNumber && l.labelPdfBase64 && money(l.rate) != null ? 'OK' : 'INCOMPLETE')
            + '(id=' + (l.shipmentId ? 'yes' : 'NO') + ' tracking=' + (l.trackingNumber ? 'yes' : 'NO') + ' pdf=' + (l.labelPdfBase64 ? 'yes' : 'NO') + ' price=' + money(l.rate)
            + ' keys=' + Object.keys(r || {}).join(',') + ' labelLayout=' + JSON.stringify(docs) + ')');
          break; // one bought label is enough
        } catch (e) { out.push(tag + '=FAILED' + why(e)); }
      }
      if (bought && service === 'ground') {
        try { out.push('pb_cancel_ground=OK(' + JSON.stringify(await client.cancelShipment(bought)).replace(/\s+/g, ' ').slice(0, 200) + ')'); }
        catch (e) { out.push('pb_cancel_ground=FAILED' + why(e)); }
      }
    }
  }
  return out.join(' ');
}

// USPS labels through Shipping 360 need a phone on the sender. TCGplayer
// exports have no buyer phones, so the sender's (or PB_DEFAULT_PHONE) is
// required up front instead of failing once per label.
function senderPhone(fromAddress, env) {
  const ph = String((fromAddress && fromAddress.phone) || (env && env.PB_DEFAULT_PHONE) || '');
  return ph.replace(/\D/g, '').length >= 10 ? ph : '';
}
const PHONE_NEEDED = { error: 'Add a phone number to your return address. USPS needs one on postage labels.', field: 'phone' };

module.exports = function mountPostageRoutes(router, d) {
  const { supabaseAdmin, requireUser, requireSupabase, OWNER_EMAIL, logError } = d;
  const stripe = d.stripe || (() => null);
  const SITE_URL = d.SITE_URL || 'https://tcgspeedshipper.com';
  // A seller's plan sets the letter fee. If the lookup fails, fall back to the
  // Free/Base fee rather than blocking the purchase.
  async function planOf(userId) {
    try {
      const { data, error } = await supabaseAdmin().from('tcgss_profiles').select('plan, is_lifetime_free, free_until').eq('id', userId).maybeSingle();
      if (error) throw error;
      return effectivePlan(data);
    } catch (e) {
      if (logError) logError('postage', 'plan lookup failed:', e);
      return 'free';
    }
  }
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
    if (!client || clientKey !== k) { client = makePbClient({ key: env.PB_API_KEY, secret: env.PB_API_SECRET, env: cfg.mode, partnerId: env.PB_PARTNER_ID, carrierAccountId: env.PB_CARRIER_ACCOUNT_ID, fetchImpl, retryBaseMs: Number(env.PB_RETRY_BASE_MS) || 400 }); clientKey = k; }
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

  // Plain words for Pitney Bowes errors. "Too Many Requests" (their rate limit)
  // is retried inside the client first; if it still comes through, say so kindly.
  function pbMessage(err, fallback) {
    if (!(err instanceof PbError)) return fallback;
    return err.status === 429 ? 'Pitney Bowes is busy right now. Wait a few seconds and try again.' : err.message;
  }
  function pbFail(res, err, what) {
    if (err instanceof PbError) {
      return res.status(err.status >= 500 ? 502 : 400).json({ error: what + ': ' + pbMessage(err) });
    }
    if (logError) logError('postage', what + ' failed:', err);
    return res.status(502).json({ error: what + ' failed. Please try again.' });
  }

  // What the app needs to decide whether to show the postage panel.
  router.get('/postage/status', requireSupabase, requireUser, async (req, res) => {
    const cfg = pbConfig(env);
    // Not in the rollout yet: say it's coming, nothing more.
    if (!allowed(req.user)) return res.json({ allowed: false, comingSoon: true });
    const plan = await planOf(req.user.id);
    res.json({ allowed: true, configured: cfg.configured, mode: cfg.mode, balance: cfg.balance, topupAmounts: TOPUP_AMOUNTS, topupMin: TOPUP_MIN, topupMax: TOPUP_MAX, services: Object.keys(SERVICES).map((k) => ({ id: k, label: SERVICES[k].label, maxOz: SERVICES[k].maxOz, fee: feeFor(k, env, plan) })) });
  });

  // Quote one shipment: { from, to, service, weightOz } → { amount }.
  router.post('/postage/rates', guard, async (req, res) => {
    const b = req.body || {};
    const s = SERVICES[b.service];
    if (!s) return res.status(400).json({ error: 'Unknown service' });
    const from = pbAddress(b.from), to = pbAddress(b.to);
    if (from.missing.length) return res.status(400).json({ error: 'Return address needs: ' + from.missing.join(', ') });
    if (to.missing.length) return res.status(400).json({ error: 'Address needs: ' + to.missing.join(', ') });
    if (!senderPhone(from.address, env)) return res.status(400).json(PHONE_NEEDED);
    const oz = Number(b.weightOz) || 1;
    if (oz < s.minOz || oz > s.maxOz) return res.status(400).json({ error: s.label + ' allows up to ' + s.maxOz + ' oz' });
    try {
      const shipment = buildShipment({ from: from.address, to: to.address, service: b.service, weightOz: oz, phone: env.PB_DEFAULT_PHONE });
      const r = await pb().rate(shipment);
      res.json(Object.assign({ service: b.service, mode: pbConfig(env).mode }, priced(b.service, money(rateOf(r)), env, await planOf(req.user.id))));
    } catch (err) { pbFail(res, err, 'Rate quote'); }
  });

  // Price a whole batch before buying: { from, labels: [{ ref, to, service, weightOz }] }
  // → { items: [{ ref, ok, postage, fee, price } | { ref, ok: false, error }], total }.
  // Nothing is bought; the app shows the total next to the balance.
  router.post('/postage/quote', guard, async (req, res) => {
    const b = req.body || {};
    const list = Array.isArray(b.labels) ? b.labels : [];
    if (!list.length) return res.status(400).json({ error: 'No labels requested' });
    if (list.length > MAX_LABELS_PER_REQUEST) return res.status(400).json({ error: 'Up to ' + MAX_LABELS_PER_REQUEST + ' labels at a time' });
    const from = pbAddress(b.from);
    if (from.missing.length) return res.status(400).json({ error: 'Return address needs: ' + from.missing.join(', ') });
    if (!senderPhone(from.address, env)) return res.status(400).json(PHONE_NEEDED);
    const plan = await planOf(req.user.id);
    const quoteOne = async (item) => {
      const ref = clean(item && item.ref, 40);
      const s = SERVICES[item && item.service];
      const to = pbAddress(item && item.to);
      const oz = Number(item && item.weightOz) || 1;
      if (!s) return { ref, ok: false, error: 'Unknown service' };
      if (to.missing.length) return { ref, ok: false, error: 'Address needs: ' + to.missing.join(', ') };
      if (oz < s.minOz || oz > s.maxOz) return { ref, ok: false, error: s.label + ' allows up to ' + s.maxOz + ' oz' };
      try {
        const key = quoteKey(pbConfig(env).mode, from.address, to.address, item.service, oz);
        let q = quoteCache.get(key);
        if (!q || q.at < Date.now() - QUOTE_TTL_MS) {
          q = { at: Date.now(), rate: await pb().rate(buildShipment({ from: from.address, to: to.address, service: item.service, weightOz: oz, phone: env.PB_DEFAULT_PHONE })) };
          quoteCache.set(key, q);
          if (quoteCache.size > QUOTE_CACHE_MAX) quoteCache.delete(quoteCache.keys().next().value); // oldest first
        }
        const p = priced(item.service, money(rateOf(q.rate)), env, plan);
        return p.price == null ? { ref, ok: false, error: 'No price came back' } : Object.assign({ ref, ok: true }, p);
      } catch (err) {
        return { ref, ok: false, error: pbMessage(err, 'Quote failed, please retry') };
      }
    };
    // Two at a time: fast enough for a batch, gentle on the carrier API (four
    // at once made Pitney Bowes answer 429 Too Many Requests to a whole batch).
    const items = new Array(list.length);
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(2, list.length) }, async () => {
      while (next < list.length) { const i = next++; items[i] = await quoteOne(list[i]); }
    }));
    const total = Math.round(items.reduce((t, x) => t + (x.ok ? x.price : 0), 0) * 100) / 100;
    const out = { items, total, mode: pbConfig(env).mode };
    if (pbConfig(env).balance) { try { out.balanceCents = await balanceOf(req.user.id); } catch (e) { /* shown without it */ } }
    res.json(out);
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
    if (!senderPhone(from.address, env)) return res.status(400).json(PHONE_NEEDED);
    const mode = pbConfig(env).mode;
    const useBalance = pbConfig(env).balance;
    const plan = await planOf(req.user.id);
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
          const est = priced(item.service, money(rateOf(q)), env, plan).price;
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
        Object.assign(out, priced(item.service, money(l.rate), env, plan));
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
        results.push({ ref, ok: false, error: pbMessage(err, 'Label failed, please retry') });
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

module.exports.pbSelfCheck = pbSelfCheck;
module.exports.rateOf = rateOf;
module.exports.money = money;
module.exports.readLabel = readLabel;
module.exports.pbConfig = pbConfig;
module.exports.pbAddress = pbAddress;
module.exports.buildShipment = buildShipment;
module.exports.SERVICES = SERVICES;
module.exports.feeFor = feeFor;
module.exports.effectivePlan = effectivePlan;
module.exports.LETTER_FEE_BY_PLAN = LETTER_FEE_BY_PLAN;
module.exports.handleTopupSession = handleTopupSession;
module.exports.TOPUP_AMOUNTS = TOPUP_AMOUNTS;
