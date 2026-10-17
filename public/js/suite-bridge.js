/* The web app's side of the TCG Speed Suite bridge (the exact shapes are in suite/extension/README.md, "Account link", and are
   checked against the extension's own validator by test/suite-bridge.test.js).

   If the Chrome extension is installed it answers "hello". Only then does this page hand it the signed-in user's ACCESS token and
   that token's expiry (nothing else: never the refresh token, never the user), so the extension's assistant can call /api/agent/*.
   On sign-out the page takes it back ("account.unlink"). No extension, no answer: nothing about the login is posted at all.

   Loaded by index.html as window.TCGSSBridge and required by the test. Keep it free of DOM and Supabase dependencies, and make
   sure a failure here can never break the page (nothing throws; every promise resolves). */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.TCGSSBridge = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var REQUEST = 'tcgss-app', RESPONSE = 'tcgss-extension', VERSION = 1;

  // win: the page's window (a stand-in in tests): addEventListener, postMessage and location.origin.
  // opts: waitMs (how long to wait for an answer), retryMs (how long a "not installed" answer is believed), now,
  //       setTimeout / clearTimeout (tests pass fakes).
  function create(win, opts) {
    opts = opts || {};
    var waitMs = opts.waitMs || 2500;                        // a sleeping extension worker can take a moment to wake
    var retryMs = opts.retryMs == null ? 30000 : opts.retryMs;
    var now = opts.now || Date.now;
    var setT = opts.setTimeout || setTimeout;
    var clearT = opts.clearTimeout || clearTimeout;

    var seq = 0, pending = {};
    var present = null, askedAt = 0;                         // the last "hello" result, and when it was asked
    var want = null;                                         // { token, exp }: the login the page has now, or null when signed out
    var linked = null;                                       // the token the extension holds
    var tried = null;                                        // a token not delivered in this look (no extension, or no answer); the next sync() tries again
    var refused = null;                                      // a token the extension answered "no" to: not offered again
    var busy = null;

    // Only answers from the extension, in this window, from this origin, to a question we asked.
    win.addEventListener('message', function (e) {
      try {
        var m = e && e.data;
        if (!e || e.source !== win || e.origin !== win.location.origin) return;
        if (!m || m.source !== RESPONSE || m.v !== VERSION || typeof m.id !== 'string') return;
        var p = pending[m.id];
        if (!p) return;
        delete pending[m.id];
        clearT(p.timer);
        p.resolve(m);
      } catch (err) { /* never break the page */ }
    });

    // One request; resolves with the extension's answer, or null if nobody answered in time.
    function call(type, payload) {
      return new Promise(function (resolve) {
        var id = 'site-' + (++seq) + '-' + now().toString(36);
        var timer = setT(function () { delete pending[id]; resolve(null); }, waitMs);
        pending[id] = { resolve: resolve, timer: timer };
        var msg = { source: REQUEST, v: VERSION, id: id, type: type };
        if (payload !== undefined) msg.payload = payload;
        try { win.postMessage(msg, win.location.origin); } catch (err) { delete pending[id]; clearT(timer); resolve(null); }
      });
    }

    // Is the extension there? A yes is kept for the life of the page; a no is believed for retryMs.
    function installed() {
      if (present === true) return Promise.resolve(true);
      if (present === false && now() - askedAt < retryMs) return Promise.resolve(false);
      return call('hello').then(function (r) { present = Boolean(r && r.ok); askedAt = now(); return present; });
    }

    function reconcile() {
      if (busy) return busy;
      var w = want, job;
      if (w && w.token !== linked && w.token !== tried && w.token !== refused) {
        job = installed().then(function (yes) {
          if (!yes) { tried = w.token; return null; }
          return call('account.link', { accessToken: w.token, expiresAt: w.exp }).then(function (r) {
            if (r && r.ok) linked = w.token;
            else if (r) refused = w.token;
            else tried = w.token;
          });
        });
      } else if (!w && linked) {
        job = call('account.unlink').then(function () { linked = null; });
      } else {
        return Promise.resolve();
      }
      var done = function () { busy = null; return reconcile(); }; // the login may have changed while we were waiting
      busy = job.then(done, done);
      return busy;
    }

    // Tell the bridge what the page's login looks like now (call it whenever the login changes; it is cheap when nothing did).
    function sync(session) {
      var token = session && typeof session.access_token === 'string' ? session.access_token : '';
      var exp = session ? Number(session.expires_at) : NaN;
      want = token && exp > 0 ? { token: token, exp: exp } : null;
      tried = null;
      return reconcile();
    }

    return { sync: sync, installed: installed };
  }

  return { create: create, REQUEST_SOURCE: REQUEST, RESPONSE_SOURCE: RESPONSE, VERSION: VERSION };
});
