// Static host for built Suite apps (Scan first). Dependency-free; nothing here talks to a database or a key.
// It exists so a Suite app can live on its OWN address, apart from tcgspeedshipper.com: the apps then cannot
// read the Shipper's sign-in data, because browsers keep each address's storage separate.
//
//   node suite/host/server.js <folder> [port]        port defaults to $PORT, then 8080
//   HOST_NOINDEX=0 lets search engines in (default: private preview, noindex + robots Disallow)
//
// Safe by construction: GET and HEAD only, files only from inside <folder>, no directory listings.
import { createServer } from 'node:http';
import { stat, readFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { gzip } from 'node:zlib';
import { promisify } from 'node:util';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const gzipAsync = promisify(gzip);
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.gif': 'image/gif', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8', '.csv': 'text/csv; charset=utf-8', '.wasm': 'application/wasm', '.gz': 'application/gzip',
};
const SQUEEZE = /^(text\/|application\/(json|manifest\+json|wasm)|image\/svg)|javascript/;
const MAX_CACHE_BYTES = 48 * 1024 * 1024;

export function createHost({ root, noindex = true } = {}) {
  if (!root) throw new Error('root folder required');
  const base = resolve(root);
  const squeezed = new Map(); // "path|mtime|size" -> gzipped Buffer
  let squeezedBytes = 0;

  function headers(req, type, extra) {
    const h = {
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Content-Security-Policy': "frame-ancestors 'none'",
      'Referrer-Policy': 'no-referrer',
      'Permissions-Policy': 'camera=(self), microphone=(), geolocation=(), payment=()',
      ...extra,
    };
    if (type) h['Content-Type'] = type;
    if (noindex) h['X-Robots-Tag'] = 'noindex, nofollow';
    if (req.headers['x-forwarded-proto'] === 'https') h['Strict-Transport-Security'] = 'max-age=31536000';
    return h;
  }
  const plain = (req, res, code, text, extra) => { res.writeHead(code, headers(req, 'text/plain; charset=utf-8', extra)); res.end(req.method === 'HEAD' ? undefined : text); };

  return createServer(async (req, res) => {
    try {
      if (req.method !== 'GET' && req.method !== 'HEAD') return plain(req, res, 405, 'Method not allowed', { Allow: 'GET, HEAD' });
      let pathname;
      try { pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch { return plain(req, res, 400, 'Bad request'); }
      if (pathname.includes('\0')) return plain(req, res, 400, 'Bad request');
      if (pathname === '/healthz') return plain(req, res, 200, 'ok', { 'Cache-Control': 'no-store' });
      if (noindex && pathname === '/robots.txt') return plain(req, res, 200, 'User-agent: *\nDisallow: /\n', { 'Cache-Control': 'no-cache' });

      let file = resolve(join(base, pathname));
      if (file !== base && !file.startsWith(base + sep)) return plain(req, res, 404, 'Not found');
      let info = await stat(file).catch(() => null);
      if (info && info.isDirectory()) {
        if (!pathname.endsWith('/')) { res.writeHead(301, headers(req, null, { Location: pathname + '/' })); return res.end(); }
        file = join(file, 'index.html');
        info = await stat(file).catch(() => null);
      }
      if (!info || !info.isFile()) return plain(req, res, 404, 'Not found');

      const type = TYPES[extname(file).toLowerCase()] || 'application/octet-stream';
      const etag = 'W/"' + info.size.toString(16) + '-' + Math.floor(info.mtimeMs).toString(16) + '"';
      const vendor = pathname.includes('/vendor/');
      const cache = vendor ? 'public, max-age=604800' : 'no-cache';
      const wantsGzip = /\bgzip\b/.test(String(req.headers['accept-encoding'] || '')) && SQUEEZE.test(type) && info.size > 1024 && info.size < 16 * 1024 * 1024;
      const extra = { ETag: etag, 'Cache-Control': cache, 'Last-Modified': info.mtime.toUTCString(), Vary: 'Accept-Encoding' };
      if (req.headers['if-none-match'] === etag) { res.writeHead(304, headers(req, null, extra)); return res.end(); }

      if (wantsGzip) {
        const key = file + '|' + info.mtimeMs + '|' + info.size;
        let body = squeezed.get(key);
        if (!body) {
          body = await gzipAsync(await readFile(file));
          if (squeezedBytes + body.length <= MAX_CACHE_BYTES) { squeezed.set(key, body); squeezedBytes += body.length; }
        }
        res.writeHead(200, headers(req, type, { ...extra, 'Content-Encoding': 'gzip', 'Content-Length': body.length }));
        return res.end(req.method === 'HEAD' ? undefined : body);
      }
      res.writeHead(200, headers(req, type, { ...extra, 'Content-Length': info.size }));
      if (req.method === 'HEAD') return res.end();
      createReadStream(file).on('error', () => res.destroy()).pipe(res);
    } catch {
      if (!res.headersSent) plain(req, res, 500, 'Server error'); else res.destroy();
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = process.argv[2] ? resolve(process.argv[2]) : fileURLToPath(new URL('../scan/dist', import.meta.url));
  const port = Number(process.argv[3]) || Number(process.env.PORT) || 8080;
  const noindex = process.env.HOST_NOINDEX !== '0';
  createHost({ root, noindex }).listen(port, '0.0.0.0', () => console.log('Suite host: serving ' + root + ' on port ' + port + (noindex ? ' (private preview: noindex)' : '')));
}
