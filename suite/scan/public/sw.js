// Offline after the first visit: cache the app files, serve them cache-first.
const CACHE = 'speed-scan-v2';
const FILES = [
  './', './index.html', './app.js', './styles.css', './manifest.webmanifest', './icon.svg', './camera.js',
  '../core/pricing.js', '../core/csv.js', '../core/session.js',
  '../data/index.js', '../vision/detect.js', '../ocr/pipeline.js', '../ocr/parse.js', '../ocr/resolve.js', '../core/rapid.js', '../data/sample/printings.json', '../../shared/models.js',
];
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(caches.match(e.request).then((hit) => hit || fetch(e.request)));
});
