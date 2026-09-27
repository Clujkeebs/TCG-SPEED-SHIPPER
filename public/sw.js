/* TCG Speed Shipper service worker: makes the label generator work offline
   (card shows, bad signal) and installable.

   Rules that must hold:
   - Never touch the API, Supabase or Stripe. Those requests go straight to
     the network, uncached, so plans, usage and billing are always live.
   - Pages are network-first: a deploy is seen on the next load when online,
     and the last copy is used only when offline.
   - Our own code (JS, CSS, JSON, CSV, the manifest) is network-first too, so a
     fix (e.g. a security fix in shipper-core.js) is live on the very first
     online load after a deploy, never one visit late.
   - Only files that can't change under the same URL are cache-first
     (stale-while-revalidate): versioned /vendor/ libraries, fonts, images,
     and pinned CDN files.
   Bump VERSION to force-drop every old cache. */
var VERSION = 'v4';
var CACHE = 'tcgss-' + VERSION;
var PRECACHE = [
  '/', '/css/site.css', '/js/site.js', '/js/shipper-core.js', '/fonts/fonts.css',
  '/favicon.svg', '/icon-192.png', '/manifest.webmanifest',
  '/vendor/jspdf-2.5.1.umd.min.js', '/vendor/qrcode-1.0.0.min.js',
  '/vendor/supabase-js-2.111.0.umd.js'
];
var CDN = /^https:\/\/(cdnjs\.cloudflare\.com|cdn\.jsdelivr\.net)\//;

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) {
    // One missing file must not stop the worker installing.
    return Promise.all(PRECACHE.map(function (u) { return c.add(u).catch(function () {}); }));
  }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k.indexOf('tcgss-') === 0 && k !== CACHE; })
      .map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

// Content that never changes under the same URL, so serving it from cache is
// always correct.
function isImmutable(url) {
  if (url.origin !== self.location.origin) return CDN.test(url.href);
  return /^\/vendor\//.test(url.pathname) || /\.(png|svg|ico|webp|jpg|woff2?)$/.test(url.pathname);
}

function isBypassed(url) {
  if (url.origin === self.location.origin) {
    return /^\/(api|\.netlify|admin|affiliate)(\/|$)/.test(url.pathname) || url.pathname === '/sw.js';
  }
  return !CDN.test(url.href); // Supabase, Stripe, analytics, anything else
}

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (isBypassed(url)) return;

  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).then(function (res) {
      if (res.ok) { var copy = res.clone(); caches.open(CACHE).then(function (c) { c.put(url.pathname === '/' ? '/' : req, copy); }); }
      return res;
    }).catch(function () {
      return caches.match(req, { ignoreSearch: true }).then(function (hit) { return hit || caches.match('/'); });
    }));
    return;
  }

  if (!isImmutable(url)) {
    e.respondWith(fetch(req).then(function (res) {
      if (res.ok) { var copy = res.clone(); caches.open(CACHE).then(function (c) { c.put(req, copy); }); }
      return res;
    }).catch(function () {
      return caches.match(req, { ignoreSearch: true }).then(function (hit) { return hit || Response.error(); });
    }));
    return;
  }

  e.respondWith(caches.match(req).then(function (hit) {
    var net = fetch(req).then(function (res) {
      if (res.ok || res.type === 'opaque') { var copy = res.clone(); caches.open(CACHE).then(function (c) { c.put(req, copy); }); }
      return res;
    }).catch(function () { return hit; });
    return hit || net;
  }));
});
