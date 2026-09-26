/* Site-wide behaviour, loaded on every page:
   1. Cookie notice (or Usercentrics Cookiebot, if a CBID is configured).
   2. Browser error reporting to /api/client-error (owner's admin dashboard).
   3. Scroll-reveal animation for below-the-fold content.
   Everything is wrapped so a failure here can never break the page. */
(function () {
  'use strict';

  /* ── 1. Cookie notice ──
     This site sets no advertising or tracking cookies. It uses browser
     storage only for things the visitor asked for (staying signed in,
     their return address and settings), which is "strictly necessary" and
     doesn't need opt-in consent. So the default is a simple notice, not a
     consent wall.

     To use Usercentrics Cookiebot instead (e.g. if analytics or ads are ever
     added), create a free Cookiebot account for this domain and paste its
     Domain Group ID here. The Cookiebot banner then replaces this notice, and
     "Cookie settings" in the footer reopens Cookiebot's dialog. */
  var COOKIEBOT_CBID = '';
  var NOTICE_KEY = 'tcgss_cookie_notice_v1';

  function storageGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function storageSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } }

  function loadCookiebot() {
    var s = document.createElement('script');
    s.id = 'Cookiebot';
    s.src = 'https://consent.cookiebot.com/uc.js';
    s.setAttribute('data-cbid', COOKIEBOT_CBID);
    s.setAttribute('data-blockingmode', 'auto');
    document.head.appendChild(s);
  }

  var banner = null;
  function showNotice(force) {
    if (!force && storageGet(NOTICE_KEY)) return;
    if (banner) { banner.classList.add('show'); return; }
    banner = document.createElement('div');
    banner.className = 'cc';
    banner.setAttribute('role', 'region');
    banner.setAttribute('aria-label', 'Cookie notice');
    var p = document.createElement('p');
    p.appendChild(document.createTextNode('No ads and no tracking cookies here. We only use your browser’s storage to keep you signed in and remember your settings. '));
    var a = document.createElement('a');
    a.href = '/privacy.html#cookies';
    a.textContent = 'Details';
    p.appendChild(a);
    var btns = document.createElement('div');
    btns.className = 'cc-btns';
    var ok = document.createElement('button');
    ok.type = 'button';
    ok.className = 'primary';
    ok.textContent = 'Got it';
    ok.addEventListener('click', function () {
      storageSet(NOTICE_KEY, new Date().toISOString());
      banner.classList.remove('show');
    });
    btns.appendChild(ok);
    banner.appendChild(p);
    banner.appendChild(btns);
    document.body.appendChild(banner);
    requestAnimationFrame(function () { requestAnimationFrame(function () { banner.classList.add('show'); }); });
  }

  window.TCGSSCookies = {
    open: function () {
      if (COOKIEBOT_CBID && window.Cookiebot && window.Cookiebot.renew) window.Cookiebot.renew();
      else showNotice(true);
    }
  };

  function initConsent() {
    if (COOKIEBOT_CBID) { loadCookiebot(); return; }
    // Don't cover the page on first paint — wait a beat.
    setTimeout(function () { showNotice(false); }, 1200);
  }
  document.addEventListener('click', function (e) {
    var t = e.target.closest && e.target.closest('[data-cookie-settings]');
    if (t) { e.preventDefault(); window.TCGSSCookies.open(); }
  });

  /* ── 2. Error reporting ──
     Only our own scripts' errors (not browser extensions, not opaque
     cross-origin "Script error."), at most 5 per page load, never twice
     for the same message. Sends the error text and page path only. */
  var sent = {}, count = 0;
  function report(message, where) {
    try {
      message = String(message || '').slice(0, 500);
      if (!message || message === 'Script error.' || sent[message] || count >= 5) return;
      sent[message] = true; count++;
      var body = JSON.stringify({ message: message, where: String(where || '').slice(0, 300), page: location.pathname + location.hash });
      if (navigator.sendBeacon) navigator.sendBeacon('/api/client-error', new Blob([body], { type: 'application/json' }));
      else fetch('/api/client-error', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body, keepalive: true }).catch(function () {});
    } catch (e) { /* never throw from the error reporter */ }
  }
  window.addEventListener('error', function (e) {
    var file = e.filename || '';
    if (file && file.indexOf(location.origin) !== 0 && !/cdnjs\.cloudflare\.com|cdn\.jsdelivr\.net/.test(file)) return; // extensions etc.
    report(e.message, file.replace(location.origin, '') + ':' + (e.lineno || 0) + ':' + (e.colno || 0));
  });
  window.addEventListener('unhandledrejection', function (e) {
    var r = e.reason;
    var msg = (r && r.message) || String(r);
    if (/Failed to fetch|NetworkError|Load failed|AbortError/i.test(msg)) return; // flaky connections aren't bugs
    report('Unhandled promise: ' + msg, (r && r.stack ? String(r.stack).split('\n')[1] : '') || '');
  });
  window.TCGSSReportError = report;

  /* ── Anonymous funnel counts ──
     Sends only an event name and a coarse traffic source ("google",
     "reddit", ...) — no cookie, no id. The server keeps daily totals only.
     The source is decided once per browser tab session, from the landing
     page's URL (utm_source / gclid / ?ref / ?aff) or its referrer. */
  var SOURCE_KEY = 'tcgss_src';
  function detectSource() {
    try {
      var q = new URLSearchParams(location.search);
      if (q.get('gclid') || q.get('gbraid') || q.get('wbraid') || /google.*(ads|cpc)|^cpc$/i.test((q.get('utm_source') || '') + (q.get('utm_medium') || ''))) return 'google_ads';
      if (q.get('aff')) return 'affiliate';
      if (q.get('ref')) return 'referral';
      var utm = (q.get('utm_source') || '').toLowerCase();
      var known = ['google', 'bing', 'reddit', 'youtube', 'tiktok', 'facebook', 'instagram', 'discord', 'twitter', 'tcgplayer', 'email'];
      for (var i = 0; i < known.length; i++) if (utm.indexOf(known[i]) !== -1) return known[i];
      if (utm) return 'other';
      var r = document.referrer ? new URL(document.referrer).hostname : '';
      if (!r || r === location.hostname) return 'direct';
      var map = [[/google\./, 'google'], [/bing\.|duckduckgo|yahoo\./, 'bing'], [/reddit\./, 'reddit'], [/youtube\.|youtu\.be/, 'youtube'], [/tiktok\./, 'tiktok'],
        [/facebook\.|fb\.com|messenger/, 'facebook'], [/instagram\./, 'instagram'], [/discord/, 'discord'], [/twitter\.|x\.com|t\.co$/, 'twitter'], [/tcgplayer\./, 'tcgplayer'], [/mail\./, 'email']];
      for (var j = 0; j < map.length; j++) if (map[j][0].test(r)) return map[j][1];
      return 'other';
    } catch (e) { return 'other'; }
  }
  var source = null;
  try { source = sessionStorage.getItem(SOURCE_KEY); } catch (e) {}
  if (!source) { source = detectSource(); try { sessionStorage.setItem(SOURCE_KEY, source); } catch (e) {} }

  var trackedOnce = {};
  function track(event, once) {
    try {
      if (once) {
        var k = 'tcgss_ev_' + event;
        if (trackedOnce[k]) return;
        trackedOnce[k] = true;
        try { if (sessionStorage.getItem(k)) return; sessionStorage.setItem(k, '1'); } catch (e) {}
      }
      var body = JSON.stringify({ e: event, s: source });
      if (navigator.sendBeacon) navigator.sendBeacon('/api/e', new Blob([body], { type: 'application/json' }));
      else fetch('/api/e', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body, keepalive: true }).catch(function () {});
    } catch (e) { /* analytics must never break the page */ }
  }
  window.TCGSSTrack = track;
  if (!/^\/admin\//.test(location.pathname)) track('visit', true);

  /* ── 3. Scroll reveal ──
     Only for content that starts below the fold, so nothing visible on
     load ever blinks. Without IntersectionObserver (or with reduced motion),
     nothing is hidden at all. */
  function initReveal() {
    document.documentElement.classList.add('js-ready');
    if (!('IntersectionObserver' in window)) return;
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    var sel = '.content-section, .post-section, .post-grid .post-row, .guide-link-card, .related-card, .card, .cta-box, .quick-step, .price-card, .sf-grid > div';
    var els = Array.prototype.slice.call(document.querySelectorAll(sel));
    var fold = window.innerHeight;
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); }
      });
    }, { rootMargin: '0px 0px -40px 0px' });
    els.forEach(function (el, i) {
      if (el.getBoundingClientRect().top < fold) return;
      el.classList.add('reveal');
      el.style.transitionDelay = (i % 3) * 60 + 'ms';
      io.observe(el);
    });
  }

  function ready(fn) { if (document.readyState !== 'loading') fn(); else document.addEventListener('DOMContentLoaded', fn); }
  ready(function () {
    try { initReveal(); } catch (e) {}
    try { initConsent(); } catch (e) {}
    try {
      var y = document.querySelectorAll('[data-year]');
      for (var i = 0; i < y.length; i++) y[i].textContent = String(new Date().getFullYear());
    } catch (e) {}
  });
})();
