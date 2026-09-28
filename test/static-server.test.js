/* server.js as the whole site (Railway): pages, pretty URLs, headers that
   netlify.toml used to add, www → apex, 404s, and /version.json from the
   Railway commit. */
const Module = require('module');
const path = require('path');

process.env.RAILWAY_GIT_COMMIT_SHA = 'abc1234def5678';
process.env.RAILWAY_ENVIRONMENT_NAME = 'production';
delete process.env.STRIPE_SECRET_KEY;
process.env.SUPABASE_URL = 'https://stub.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'stub-key';

const origLoad = Module._load;
Module._load = function (request) {
  if (request === '@supabase/supabase-js') return { createClient: () => ({ from: () => ({ insert: async () => ({}) }), rpc: async () => ({}) }) };
  return origLoad.apply(this, arguments);
};
const app = require(path.join(__dirname, '..', 'server.js'));
Module._load = origLoad;

const http = require('http');
const server = http.createServer(app);
function get(p, host, extra) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port: server.address().port, path: p, headers: Object.assign({ Host: host || 'tcgspeedshipper.com' }, extra || {}) }, (res) => {
      let d = ''; res.on('data', (c) => { d += c; }); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: d }));
    });
    r.on('error', reject); r.end();
  });
}
let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (detail ? '\n        ' + detail : '')); }
}

server.listen(0, async () => {
  try {
    let r = await get('/');
    check('home page is served', r.status === 200 && /<title>/.test(r.body));
    check('security headers on pages', r.headers['x-frame-options'] === 'DENY' && r.headers['x-content-type-options'] === 'nosniff' && /frame-ancestors 'none'/.test(r.headers['content-security-policy']));
    check('pages revalidate (no stale HTML after a deploy)', /max-age=0/.test(r.headers['cache-control']), r.headers['cache-control']);
    check('no x-powered-by', !r.headers['x-powered-by']);
    r = await get('/', null, { 'Accept-Encoding': 'gzip' });
    check('pages are gzip-compressed when the browser accepts it', r.headers['content-encoding'] === 'gzip', r.headers['content-encoding']);

    r = await get('/partners');
    check('pretty URL /partners → partners.html', r.status === 200 && /partner/i.test(r.body));
    r = await get('/blog/');
    check('/blog/ serves its index.html', r.status === 200 && /<h1/.test(r.body));

    const vendor = require('fs').readdirSync(path.join(__dirname, '..', 'public', 'vendor')).find((f) => f.endsWith('.js'));
    r = await get('/vendor/' + vendor);
    check('/vendor/* is cached for a year, immutable', /immutable/.test(r.headers['cache-control']) && /max-age=31536000/.test(r.headers['cache-control']), r.headers['cache-control']);
    r = await get('/vendor/no-such-lib.js');
    check('a missing /vendor/ file is a 404 that is NOT cached for a year', r.status === 404 && !/immutable/.test(r.headers['cache-control'] || ''), r.headers['cache-control']);
    r = await get('/');
    check('HSTS on production', /max-age=31536000/.test(r.headers['strict-transport-security'] || '') && !/includeSubDomains/.test(r.headers['strict-transport-security']), r.headers['strict-transport-security']);
    r = await get('/sw.js');
    check('/sw.js is never cached', r.headers['cache-control'] === 'no-cache' && r.headers['service-worker-allowed'] === '/', r.headers['cache-control']);
    r = await get('/manifest.webmanifest');
    check('manifest content type', /application\/manifest\+json/.test(r.headers['content-type']), r.headers['content-type']);
    r = await get('/admin/');
    check('/admin/ is no-store and noindex', r.headers['cache-control'] === 'no-store' && /noindex/.test(r.headers['x-robots-tag']), r.headers['cache-control']);

    r = await get('/partners.html?x=1', 'www.tcgspeedshipper.com');
    check('www → apex 301 keeps path and query', r.status === 301 && r.headers.location === 'https://tcgspeedshipper.com/partners.html?x=1', r.headers.location);

    r = await get('/api/health');
    check('API still answers JSON', r.status === 200 && JSON.parse(r.body).clients !== undefined);
    r = await get('/.netlify/functions/api/health');
    check('old function path still works', r.status === 200);

    r = await get('/no-such-page');
    check('unknown page → HTML 404', r.status === 404 && /text\/html/.test(r.headers['content-type']) && /Page not found/.test(r.body));
    r = await get('/api/no-such-route');
    check('unknown API route → JSON 404', r.status === 404 && /json/.test(r.headers['content-type']));

    r = await get('/version.json');
    const v = JSON.parse(r.body);
    check('/version.json reports the Railway commit as production', v.commit === 'abc1234def5678' && v.context === 'production' && r.headers['cache-control'] === 'no-cache', r.body);

    r = await get('/../server.js');
    check('no path traversal out of public/', r.status === 404 && !/require\(/.test(r.body));
  } catch (e) { fail++; console.log('  FAIL  threw: ' + e.stack); }
  server.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
});
