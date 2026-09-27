/* Pins the service worker's routing rules (public/sw.js). A mistake here can
   break the site for every returning visitor, or serve stale billing data, so
   the rules are checked directly: what is never touched, what is
   network-first, and what may come from cache. */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ORIGIN = 'https://tcgspeedshipper.com';
const handlers = {};
const log = [];
const cacheStore = new Map();
let online = true;

const caches = {
  open: async () => ({
    put: async (req, res) => { cacheStore.set(typeof req === 'string' ? req : req.url, res); },
    add: async (u) => { cacheStore.set(new URL(u, ORIGIN).href, { body: 'precached ' + u }); },
  }),
  match: async (req) => { log.push('cache'); return cacheStore.get(typeof req === 'string' ? new URL(req, ORIGIN).href : req.url); },
  keys: async () => [],
};
function fakeFetch(req) {
  log.push('network');
  if (!online) return Promise.reject(new Error('offline'));
  return Promise.resolve({ ok: true, type: 'basic', body: 'fresh ' + req.url, clone() { return this; } });
}
const sandbox = {
  self: { location: { origin: ORIGIN }, addEventListener: (t, fn) => { handlers[t] = fn; }, skipWaiting() {}, clients: { claim() {} } },
  caches, fetch: fakeFetch, URL, Promise, Response: { error: () => ({ error: true }) },
};
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'sw.js'), 'utf8'), sandbox);

let passed = 0, failed = 0;
function check(name, cond, extra) {
  if (cond) { passed++; console.log('  PASS  ' + name); }
  else { failed++; console.log('  FAIL  ' + name + (extra ? '  — ' + extra : '')); }
}

// Runs the fetch handler. Returns { handled, res, order }; handled=false means
// the worker stayed out of the way and the browser went straight to the network.
async function run(url, opts) {
  opts = opts || {};
  log.length = 0;
  let responded = null;
  const e = { request: { url: new URL(url, ORIGIN).href, method: opts.method || 'GET', mode: opts.mode || 'no-cors' }, respondWith: (p) => { responded = p; } };
  handlers.fetch(e);
  const res = responded ? await responded : null;
  return { handled: !!responded, res, order: log.slice() };
}

(async () => {
  console.log('\n-- Never touched by the worker --');
  for (const u of ['/api/plans', '/api/stripe-webhook', '/.netlify/functions/api/health', '/admin/', '/affiliate/?token=x', '/sw.js',
                   'https://lwqnsvlfffugyvwblqaz.supabase.co/rest/v1/x', 'https://js.stripe.com/v3', 'https://checkout.stripe.com/c/pay']) {
    check('bypassed: ' + u, !(await run(u)).handled);
  }
  check('non-GET requests are never handled', !(await run('/js/site.js', { method: 'POST' })).handled);

  console.log('\n-- Our own code and pages are network-first --');
  cacheStore.set(ORIGIN + '/js/shipper-core.js', { body: 'OLD' });
  let r = await run('/js/shipper-core.js');
  check('own JS: network first, and the fresh copy wins over a cached one', r.handled && r.order[0] === 'network' && /fresh/.test(r.res.body), JSON.stringify(r));
  r = await run('/css/site.css');
  check('own CSS: network first', r.order[0] === 'network');
  r = await run('/', { mode: 'navigate' });
  check('pages: network first', r.order[0] === 'network' && /fresh/.test(r.res.body));

  console.log('\n-- Offline fallbacks --');
  online = false;
  cacheStore.set(ORIGIN + '/js/site.js', { body: 'cached site.js' });
  r = await run('/js/site.js');
  check('own JS offline: falls back to the cached copy', r.res && r.res.body === 'cached site.js', JSON.stringify(r.res));
  cacheStore.set(ORIGIN + '/', { body: 'cached home' });
  r = await run('/blog/whatever.html', { mode: 'navigate' });
  check('page offline, never cached: falls back to the cached home page', r.res && r.res.body === 'cached home');
  r = await run('/js/never-seen.js');
  check('uncached file offline: a network error, not a hang', r.res && r.res.error === true);
  online = true;

  console.log('\n-- Only unchanging URLs are cache-first --');
  cacheStore.set(ORIGIN + '/vendor/jspdf-2.5.1.umd.min.js', { body: 'cached jspdf' });
  r = await run('/vendor/jspdf-2.5.1.umd.min.js');
  check('versioned /vendor/ file: served from cache', r.order[0] === 'cache' && r.res.body === 'cached jspdf');
  cacheStore.set(ORIGIN + '/icon-192.png', { body: 'cached icon' });
  r = await run('/icon-192.png');
  check('images: served from cache', r.order[0] === 'cache' && r.res.body === 'cached icon');
  cacheStore.set(ORIGIN + '/fonts/fonts.css', { body: 'old fonts.css' });
  r = await run('/fonts/fonts.css');
  check('fonts.css (can change) is network-first, not cached forever', r.order[0] === 'network');

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
