// Offline after the first visit: cache the app files, serve them cache-first.
const CACHE = 'speed-scan-v7';
const FILES = [
  './', './index.html', './app.js', './styles.css', './manifest.webmanifest', './icon.svg', './camera.js', './fonts/fonts.css', './fonts/dm-serif-display-latin-400-normal.woff2', './fonts/jetbrains-mono-latin-500-normal.woff2', './fonts/jetbrains-mono-latin-600-normal.woff2', './fonts/source-serif-4-latin-400-normal.woff2', './fonts/source-serif-4-latin-600-normal.woff2', './fonts/source-serif-4-latin-700-normal.woff2',
  '../core/pricing.js', '../core/csv.js', '../core/session.js',
  '../data/index.js', '../data/load.js', '../data/compact.js', '../vision/detect.js', '../ocr/pipeline.js', '../ocr/parse.js', '../ocr/resolve.js', '../core/rapid.js', '../core/presets.js', '../core/live.js', '../core/freshness.js', '../core/tcgurl.js', '../core/report.js', '../core/version.js', '../data/sample/printings.json', '../../shared/models.js',
];
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  if (new URL(e.request.url).origin !== location.origin) return; // card lookups go straight to the network, not through the cache
  // Cache first. Anything else from our own folder (the 11 MB text reader) is kept the first time it is fetched.
  e.respondWith(caches.match(e.request).then((hit) => hit || fetch(e.request).then((res) => {
    if (res.ok && new URL(e.request.url).origin === location.origin) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
    return res;
  })));
});
