/* Owner-only admin API behind /admin/ (public/admin/index.html). Every route
   here is gated by requireUser + requireOwner (the hardcoded owner email in
   server.js, mirroring tcgss_is_owner_email() in the database), and every
   command that changes something writes an 'admin' row to tcgss_event_log so
   there's an audit trail of what was done to whose account. */
const express = require('express');

module.exports = function mountAdminRoutes(router, d) {
  const { supabaseAdmin, stripe, requireUser, requireOwner, requireSupabase, logEvent, logError, SITE_URL, PRICE_TO_PLAN,
    liveSubscriptionFor, applySubscriptionToProfile } = d;
  const guard = [express.json(), requireSupabase, requireUser, requireOwner];
  const db = () => supabaseAdmin();
  const stripeClient = () => stripe();

  function monthStart(offset) {
    const n = new Date();
    return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth() + (offset || 0), 1)).toISOString().slice(0, 10);
  }

  async function allAuthUsers() {
    const out = [];
    for (let page = 1; page < 50; page++) {
      const { data, error } = await db().auth.admin.listUsers({ page, perPage: 1000 });
      if (error) throw error;
      const users = (data && data.users) || [];
      out.push(...users);
      if (users.length < 1000) break;
    }
    return out;
  }

  async function profileOf(id) {
    const { data, error } = await db().from('tcgss_profiles').select('*').eq('id', id).maybeSingle();
    if (error) throw error;
    return data;
  }

  function audit(req, action, target, extra) {
    return logEvent('admin', 'admin.' + action, action + ' on ' + (target || '?') + ' by ' + req.user.email, extra || {});
  }

  // Everything the dashboard's top row needs, in one round trip.
  router.get('/admin/overview', ...guard, async (req, res) => {
    try {
      const [profilesRes, usageRes, errorsRes, newsletterRes] = await Promise.all([
        db().from('tcgss_profiles').select('id, plan, is_lifetime_free, free_until, subscription_status, created_at'),
        db().from('tcgss_label_usage').select('user_id, period_month, labels_count').gte('period_month', monthStart(-1)),
        db().from('tcgss_event_log').select('id', { count: 'exact', head: true }).in('level', ['error', 'warn'])
          .gte('created_at', new Date(Date.now() - 7 * 864e5).toISOString()),
        db().from('tcgss_newsletter_subscribers').select('id', { count: 'exact', head: true }),
      ]);
      if (profilesRes.error) throw profilesRes.error;
      const profiles = profilesRes.data || [];
      const now = Date.now();
      const byPlan = { free: 0, base: 0, premium: 0 };
      let freeAccess = 0;
      for (const p of profiles) {
        if (p.is_lifetime_free) continue;
        byPlan[p.plan] = (byPlan[p.plan] || 0) + 1;
        if (p.free_until && new Date(p.free_until).getTime() > now) freeAccess++;
      }
      const since = (days) => profiles.filter((p) => now - new Date(p.created_at).getTime() < days * 864e5).length;
      const usage = usageRes.data || [];
      const thisMonth = monthStart(0), lastMonth = monthStart(-1);
      const sum = (m) => usage.filter((u) => u.period_month === m).reduce((a, u) => a + (u.labels_count || 0), 0);

      // Revenue straight from Stripe, the source of truth — not our table.
      let revenue = null;
      if (stripeClient()) {
        try {
          const [subs, invoices] = await Promise.all([
            stripeClient().subscriptions.list({ status: 'active', limit: 100 }),
            stripeClient().invoices.list({ status: 'paid', limit: 100, created: { gte: Math.floor((now - 30 * 864e5) / 1000) } }),
          ]);
          const mrr = subs.data.reduce((a, s) => a + s.items.data.reduce((b, it) => {
            const pr = it.price || {};
            const monthly = pr.recurring && pr.recurring.interval === 'year' ? (pr.unit_amount || 0) / 12 : (pr.unit_amount || 0);
            return b + monthly * (it.quantity || 1);
          }, 0), 0);
          revenue = {
            mrr_cents: Math.round(mrr), active_subscriptions: subs.data.length, truncated: subs.has_more || invoices.has_more,
            paid_last_30d_cents: invoices.data.reduce((a, i) => a + (i.amount_paid || 0), 0),
            paid_invoices_last_30d: invoices.data.filter((i) => i.amount_paid > 0).length,
          };
        } catch (e) {
          revenue = { error: e.message };
        }
      }

      res.json({
        users: { total: profiles.length, by_plan: byPlan, free_access: freeAccess, signups_7d: since(7), signups_30d: since(30) },
        labels: { this_month: sum(thisMonth), last_month: sum(lastMonth),
          active_users_this_month: usage.filter((u) => u.period_month === thisMonth && u.labels_count > 0).length },
        revenue,
        errors_7d: errorsRes.count || 0,
        newsletter: newsletterRes.count || 0,
      });
    } catch (err) {
      await logError('admin.overview', err);
      res.status(500).json({ error: 'Could not load overview: ' + err.message });
    }
  });

  router.get('/admin/users', ...guard, async (req, res) => {
    try {
      const [authUsers, profilesRes, usageRes] = await Promise.all([
        allAuthUsers(),
        db().from('tcgss_profiles').select('*'),
        db().from('tcgss_label_usage').select('user_id, period_month, labels_count'),
      ]);
      if (profilesRes.error) throw profilesRes.error;
      const profiles = new Map((profilesRes.data || []).map((p) => [p.id, p]));
      const thisMonth = monthStart(0);
      const usage = {};
      for (const u of usageRes.data || []) {
        const e = usage[u.user_id] || (usage[u.user_id] = { this_month: 0, total: 0 });
        e.total += u.labels_count || 0;
        if (u.period_month === thisMonth) e.this_month += u.labels_count || 0;
      }
      const users = authUsers.map((u) => {
        const p = profiles.get(u.id) || {};
        return {
          id: u.id, email: u.email,
          created_at: u.created_at, last_sign_in_at: u.last_sign_in_at || null,
          email_confirmed: !!u.email_confirmed_at,
          plan: p.plan || 'free', is_owner: !!p.is_lifetime_free,
          free_until: p.free_until || null, subscription_status: p.subscription_status || null,
          current_period_end: p.current_period_end || null,
          stripe_customer_id: p.stripe_customer_id || null,
          referral_code: p.referral_code || null, referred: !!p.referred_by, affiliate: !!p.affiliate_id,
          labels_this_month: (usage[u.id] || {}).this_month || 0,
          labels_total: (usage[u.id] || {}).total || 0,
        };
      }).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
      res.json({ users });
    } catch (err) {
      await logError('admin.users', err);
      res.status(500).json({ error: 'Could not load users: ' + err.message });
    }
  });

  router.get('/admin/events', ...guard, async (req, res) => {
    try {
      let q = db().from('tcgss_event_log').select('*').order('created_at', { ascending: false }).limit(Math.min(Number(req.query.limit) || 200, 500));
      if (req.query.level) q = q.eq('level', String(req.query.level));
      const { data, error } = await q;
      if (error) throw error;
      res.json({ events: data || [] });
    } catch (err) {
      res.status(500).json({ error: 'Could not load events: ' + err.message });
    }
  });

  router.post('/admin/events/clear', ...guard, async (req, res) => {
    try {
      // Clears errors/warnings older than now; the admin audit trail is kept.
      const { error } = await db().from('tcgss_event_log').delete().in('level', ['error', 'warn', 'info']).lte('created_at', new Date().toISOString());
      if (error) throw error;
      await audit(req, 'clear-errors', 'event log');
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: 'Could not clear: ' + err.message });
    }
  });

  router.get('/admin/newsletter', ...guard, async (req, res) => {
    try {
      const { data, error } = await db().from('tcgss_newsletter_subscribers').select('email, source, created_at').order('created_at', { ascending: false });
      if (error) throw error;
      res.json({ subscribers: data || [] });
    } catch (err) {
      res.status(500).json({ error: 'Could not load subscribers: ' + err.message });
    }
  });

  /* ── Per-user commands ── */

  async function target(req, res) {
    const p = await profileOf(req.params.id);
    const { data } = await db().auth.admin.getUserById(req.params.id);
    const user = data && data.user;
    if (!user) { res.status(404).json({ error: 'No such user' }); return null; }
    return { user, profile: p };
  }

  // Free Premium for N days, stacked on any free time already left. Uses the
  // same free_until mechanism as referral rewards and the affiliate year.
  router.post('/admin/users/:id/grant-premium', ...guard, async (req, res) => {
    try {
      const days = Math.floor(Number(req.body && req.body.days));
      if (!(days >= 1 && days <= 3650)) return res.status(400).json({ error: 'Days must be between 1 and 3650.' });
      const t = await target(req, res); if (!t) return;
      const base = t.profile && t.profile.free_until && new Date(t.profile.free_until) > new Date() ? new Date(t.profile.free_until) : new Date();
      const until = new Date(base.getTime() + days * 864e5).toISOString();
      const { error } = await db().from('tcgss_profiles').update({ free_until: until, updated_at: new Date().toISOString() }).eq('id', req.params.id);
      if (error) throw error;
      await audit(req, 'grant-premium', t.user.email, { days, free_until: until });
      res.json({ ok: true, free_until: until });
    } catch (err) {
      await logError('admin.grant-premium', err);
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/admin/users/:id/revoke-free', ...guard, async (req, res) => {
    try {
      const t = await target(req, res); if (!t) return;
      const { error } = await db().from('tcgss_profiles').update({ free_until: null, updated_at: new Date().toISOString() }).eq('id', req.params.id);
      if (error) throw error;
      await audit(req, 'revoke-free', t.user.email);
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Zero this month's label count — for a customer who burned labels on a
  // bad print run, a bug, or a support make-good.
  router.post('/admin/users/:id/reset-usage', ...guard, async (req, res) => {
    try {
      const t = await target(req, res); if (!t) return;
      const { error } = await db().from('tcgss_label_usage').update({ labels_count: 0, updated_at: new Date().toISOString() })
        .eq('user_id', req.params.id).eq('period_month', monthStart(0));
      if (error) throw error;
      await audit(req, 'reset-usage', t.user.email);
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Re-read the customer's subscription from Stripe and write it to the
  // profile — the admin-side version of /sync-subscription.
  router.post('/admin/users/:id/sync', ...guard, async (req, res) => {
    try {
      if (!stripeClient()) return res.status(503).json({ error: 'Stripe is not configured' });
      const t = await target(req, res); if (!t) return;
      const customerId = t.profile && t.profile.stripe_customer_id;
      if (!customerId) return res.json({ ok: true, plan: 'free', note: 'No Stripe customer linked to this account.' });
      const sub = await liveSubscriptionFor(customerId);
      if (!sub) return res.json({ ok: true, plan: 'free', note: 'No live subscription in Stripe.' });
      await applySubscriptionToProfile(sub);
      await audit(req, 'sync', t.user.email, { subscription: sub.id, status: sub.status });
      res.json({ ok: true, plan: PRICE_TO_PLAN[sub.items.data[0].price.id] || null, status: sub.status });
    } catch (err) {
      await logError('admin.sync', err);
      res.status(500).json({ error: err.message });
    }
  });

  // A password-reset link the owner can send the customer by hand — doesn't
  // rely on Supabase's unreliable shared email sender.
  router.post('/admin/users/:id/recovery-link', ...guard, async (req, res) => {
    try {
      const t = await target(req, res); if (!t) return;
      const { data, error } = await db().auth.admin.generateLink({ type: 'recovery', email: t.user.email, options: { redirectTo: SITE_URL + '/' } });
      if (error) throw error;
      await audit(req, 'recovery-link', t.user.email);
      res.json({ ok: true, link: data && data.properties && data.properties.action_link });
    } catch (err) {
      await logError('admin.recovery-link', err);
      res.status(500).json({ error: err.message });
    }
  });

  // Permanent. Requires the email typed back as confirmation, cancels any
  // live Stripe subscription first so a deleted user is never billed again,
  // and refuses the owner account.
  router.post('/admin/users/:id/delete', ...guard, async (req, res) => {
    try {
      const t = await target(req, res); if (!t) return;
      const confirm = ((req.body && req.body.confirmEmail) || '').trim().toLowerCase();
      if (confirm !== (t.user.email || '').toLowerCase()) return res.status(400).json({ error: 'Type the account email exactly to confirm.' });
      if (t.profile && t.profile.is_lifetime_free) return res.status(400).json({ error: 'The owner account cannot be deleted.' });

      const canceled = [];
      const customerId = t.profile && t.profile.stripe_customer_id;
      if (customerId) {
        if (!stripeClient()) return res.status(503).json({ error: 'Stripe is not configured, so a live subscription could not be cancelled. Nothing was deleted.' });
        let sub;
        for (let i = 0; i < 10 && (sub = await liveSubscriptionFor(customerId)); i++) {
          if (canceled.includes(sub.id)) throw new Error('Stripe still reports ' + sub.id + ' as live after cancelling. Nothing was deleted.');
          await stripeClient().subscriptions.cancel(sub.id);
          canceled.push(sub.id);
        }
      }
      const { data: prep, error: prepErr } = await db().rpc('tcgss_admin_prepare_user_delete', { p_user_id: req.params.id });
      if (prepErr) throw prepErr;
      if (!prep || !prep.ok) {
        return res.status(400).json({ error: 'Not deleted: ' + ((prep && prep.reason) || 'unknown') + (canceled.length ? '. (Subscription was cancelled.)' : '') });
      }
      const { error: delErr } = await db().auth.admin.deleteUser(req.params.id);
      if (delErr) throw delErr;
      await audit(req, 'delete-user', t.user.email, { canceled_subscriptions: canceled });
      res.json({ ok: true, canceled_subscriptions: canceled });
    } catch (err) {
      await logError('admin.delete-user', err);
      res.status(500).json({ error: err.message });
    }
  });
};
