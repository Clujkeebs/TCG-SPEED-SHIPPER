/* TCG Speed Shipper service worker: makes the label generator work offline
   (card shows, bad signal) and installable.

   Rules that must hold:
   - Never touch the API, Supabase or Stripe. Those requests go straight to
     the network, uncached, so plans, usage and billing are always live.
   - Pages are network-first: a deploy is seen on the next load when online,
     and the last copy is used only when offline.
   - Static files (our CSS/JS/fonts/icons and the pinned CDN libraries) are
     stale-while-revalidate: instant from cache, refreshed in the background.
   Bump VERSION to force-drop every old cache. */
var VERSION = 'v1';
var CACHE = 'tcgss-' + VERSION;
var PRECACHE = [
  '/', '/css/site.css', '/js/site.js', '/js/shipper-core.js', '/fonts/fonts.css',
  '/favicon.svg', '/icon-192.png', '/manifest.webmanifest',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js'
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

  e.respondWith(caches.match(req).then(function (hit) {
    var net = fetch(req).then(function (res) {
      if (res.ok || res.type === 'opaque') { var copy = res.clone(); caches.open(CACHE).then(function (c) { c.put(req, copy); }); }
      return res;
    }).catch(function () { return hit; });
    return hit || net;
  }));
});
