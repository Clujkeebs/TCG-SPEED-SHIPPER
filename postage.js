/* Postage pilot: buy USPS labels through Pitney Bowes from inside the app,
   with tracking, the way eBay and Whatnot sellers do.

   Services:
   - letter: USPS First-Class letter with an Intelligent Mail barcode (scan
     tracking). For plain white envelopes, usually under-$20 orders.
   - ground: USPS Ground Advantage with full tracking. TCGplayer requires
     this (or better) for orders of $49.99 and up.

   Safety:
   - Only the owner and emails in PB_PILOT_EMAILS can use it.
   - Sandbox (free test labels) unless PB_ENV=production AND PB_LIVE_OK=yes,
     so real postage can't be bought by accident.
   - Every label is written to tcgss_postage_labels (service-role only) so it
     can be refunded and reconciled against the Pitney Bowes bill.
   - Unused labels can be refunded (cancelled) by the user who bought them. */
const express = require('express');
const { makePbClient, PbError } = require('./pb-client');

const MAX_LABELS_PER_REQUEST = 50;

// Our fee per label, on top of postage passed through at cost. A tracked
// letter at $0.78 postage + $0.21 lands at $0.99, under a dollar and close
// to a plain $0.82 stamp. Ground Advantage stays cheap enough that sellers
// don't leave for free tools. Override with PB_FEE_LETTER / PB_FEE_GROUND.
const DEFAULT_FEES = { letter: 0.21, ground: 0.30 };
function feeFor(service, env = process.env) {
  const v = Number(env['PB_FEE_' + String(service).toUpperCase()]);
  return Number.isFinite(v) && v >= 0 && v <= 5 ? Math.round(v * 100) / 100 : DEFAULT_FEES[service];
}
function priced(service, postage, env) {
  const fee = feeFor(service, env);
  return { postage, fee, price: postage == null ? null : Math.round((postage + fee) * 100) / 100 };
}

const SERVICES = {
  letter: {
    label: 'First-Class letter + IMb scans',
    rate: { carrier: 'USPS', serviceId: 'FCM', parcelType: 'LETTER' },
    dimension: { length: 6, width: 4, height: 0.25 },
    docSize: 'DOC_6X4',
    minOz: 0.1, maxOz: 3.5,
  },
  ground: {
    label: 'Ground Advantage (full tracking)',
    rate: { carrier: 'USPS', serviceId: 'GA', parcelType: 'PKG' },
    dimension: { length: 6, width: 4, height: 1 },
    docSize: 'DOC_4X6',
    minOz: 0.1, maxOz: 15.99,
  },
};

function pbConfig(env = process.env) {
  const live = env.PB_ENV === 'production' && env.PB_LIVE_OK === 'yes';
  return {
    configured: !!(env.PB_API_KEY && env.PB_API_SECRET && env.PB_SHIPPER_ID),
    mode: live ? 'production' : 'sandbox',
    pilot: String(env.PB_PILOT_EMAILS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
  };
}

const clean = (v, max) => String(v == null ? '' : v).replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max || 60);

function pbAddress(a, { requireName = true } = {}) {
  a = a || {};
  const name = clean(a.name || [a.firstName, a.lastName].filter(Boolean).join(' '), 50);
  const out = {
    name,
    addressLines: [clean(a.addr1, 50), clean(a.addr2, 50)].filter(Boolean),
    cityTown: clean(a.city, 40),
    stateProvince: clean(a.state, 2).toUpperCase(),
    postalCode: clean(a.zip, 10),
    countryCode: 'US',
  };
  if (a.company) out.company = clean(a.company, 50);
  if (a.phone) out.phone = clean(a.phone, 20);
  const missing = [];
  if (requireName && !out.name) missing.push('name');
  if (!out.addressLines.length) missing.push('street');
  if (!out.cityTown) missing.push('city');
  if (!/^[A-Z]{2}$/.test(out.stateProvince)) missing.push('state');
  if (!/^\d{5}(-\d{4})?$/.test(out.postalCode)) missing.push('ZIP');
  if (a.country && !/^(us|usa|united states)$/i.test(String(a.country).trim())) missing.push('a US address (international isn\'t supported yet)');
  return { address: out, missing };
}

function buildShipment({ from, to, service, weightOz, shipperId }) {
  const s = SERVICES[service];
  return {
    fromAddress: from,
    toAddress: to,
    parcel: {
      weight: { unitOfMeasurement: 'OZ', weight: weightOz },
      dimension: Object.assign({ unitOfMeasurement: 'IN' }, s.dimension),
    },
    rates: [Object.assign({}, s.rate)],
    documents: [{ type: 'SHIPPING_LABEL', contentType: 'BASE64', size: s.docSize, fileFormat: 'PDF', printDialogOption: 'NO_PRINT_DIALOG' }],
    shipmentOptions: [{ name: 'SHIPPER_ID', value: shipperId }],
  };
}

function money(r) {
  const n = Number(r && (r.totalCarrierCharge != null ? r.totalCarrierCharge : r.baseCharge));
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

module.exports = function mountPostageRoutes(router, d) {
  const { supabaseAdmin, requireUser, requireSupabase, OWNER_EMAIL, logError } = d;
  const env = d.env || process.env;
  const fetchImpl = d.fetchImpl || fetch;
  let client = null, clientKey = '';
  function pb() {
    const cfg = pbConfig(env);
    const k = cfg.mode + ':' + env.PB_API_KEY;
    if (!client || clientKey !== k) { client = makePbClient({ key: env.PB_API_KEY, secret: env.PB_API_SECRET, env: cfg.mode, fetchImpl }); clientKey = k; }
    return client;
  }

  function allowed(user) {
    const email = String((user && user.email) || '').toLowerCase();
    return !!email && (email === OWNER_EMAIL || pbConfig(env).pilot.includes(email));
  }
  function gate(req, res, next) {
    if (!allowed(req.user)) return res.status(403).json({ error: 'Postage is in a private pilot. Email support@tcgspeedshipper.com to join.' });
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
    res.json({ allowed: allowed(req.user), configured: cfg.configured, mode: cfg.mode, services: Object.keys(SERVICES).map((k) => ({ id: k, label: SERVICES[k].label, maxOz: SERVICES[k].maxOz, fee: feeFor(k, env) })) });
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
      const shipment = buildShipment({ from: from.address, to: to.address, service: b.service, weightOz: oz, shipperId: env.PB_SHIPPER_ID });
      delete shipment.documents;
      const r = await pb().rate(shipment);
      res.json(Object.assign({ service: b.service, mode: pbConfig(env).mode }, priced(b.service, money(r && r.rates && r.rates[0]), env)));
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
    const results = [];
    for (const item of list) {
      const ref = clean(item && item.ref, 40);
      const s = SERVICES[item && item.service];
      const to = pbAddress(item && item.to);
      const oz = Number(item && item.weightOz) || 1;
      if (!s) { results.push({ ref, ok: false, error: 'Unknown service' }); continue; }
      if (to.missing.length) { results.push({ ref, ok: false, error: 'Address needs: ' + to.missing.join(', ') }); continue; }
      if (oz < s.minOz || oz > s.maxOz) { results.push({ ref, ok: false, error: s.label + ' allows up to ' + s.maxOz + ' oz' }); continue; }
      try {
        const shipment = buildShipment({ from: from.address, to: to.address, service: item.service, weightOz: oz, shipperId: env.PB_SHIPPER_ID });
        const r = await pb().createShipment(shipment);
        const page = r && r.documents && r.documents[0] && r.documents[0].pages && r.documents[0].pages[0];
        const out = {
          ref, ok: true, service: item.service,
          shipmentId: r.shipmentId, trackingNumber: r.parcelTrackingNumber || null,
          labelPdfBase64: page ? page.contents : null,
        };
        Object.assign(out, priced(item.service, money(r.rates && r.rates[0]), env));
        results.push(out);
        const { error } = await supabaseAdmin().from('tcgss_postage_labels').insert({
          user_id: req.user.id, shipment_id: out.shipmentId, tracking_number: out.trackingNumber,
          service: item.service, amount: out.postage, fee: out.fee, price: out.price, mode, order_ref: ref || null, status: 'purchased',
        });
        if (error && logError) logError('postage', 'ledger insert failed:', error);
      } catch (err) {
        results.push({ ref, ok: false, error: err instanceof PbError ? err.message : 'Label failed, please retry' });
        if (!(err instanceof PbError) && logError) logError('postage', 'label failed:', err);
      }
    }
    const sum = (k) => Math.round(results.reduce((t, r) => t + (r.ok && r[k] ? r[k] : 0), 0) * 100) / 100;
    res.json({ mode, results, total: sum('price'), postage: sum('postage'), fees: sum('fee') });
  });

  // Refund an unused label (only the buyer's own).
  router.post('/postage/labels/:shipmentId/refund', guard, async (req, res) => {
    const id = clean(req.params.shipmentId, 60);
    const { data: row, error } = await supabaseAdmin().from('tcgss_postage_labels').select('user_id, status').eq('shipment_id', id).maybeSingle();
    if (error) return res.status(500).json({ error: 'Could not look up that label' });
    if (!row || row.user_id !== req.user.id) return res.status(404).json({ error: 'Label not found' });
    if (row.status !== 'purchased') return res.status(409).json({ error: 'That label was already ' + row.status });
    try {
      const r = await pb().cancelShipment(id);
      await supabaseAdmin().from('tcgss_postage_labels').update({ status: 'refund_requested', refunded_at: new Date().toISOString() }).eq('shipment_id', id);
      res.json({ ok: true, status: (r && r.status) || 'INITIATED' });
    } catch (err) { pbFail(res, err, 'Refund'); }
  });

  router.get('/postage/track/:trackingNumber', express.json(), requireSupabase, requireUser, gate, async (req, res) => {
    try {
      const r = await pb().tracking(clean(req.params.trackingNumber, 40));
      res.json({
        status: r && (r.status || r.currentStatus),
        events: ((r && r.scanDetailsList) || []).slice(0, 20).map((e) => ({
          at: [e.eventDate, e.eventTime].filter(Boolean).join(' '), what: e.scanDescription || e.packageStatus, where: [e.eventCity, e.eventStateOrProvince].filter(Boolean).join(', '),
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
