// Tiny static server for trying Speed Scan locally. No dependencies.
// Usage: node suite/scan/serve.js [port]   then open http://localhost:8080/scan/public/
// It serves the suite/ folder (the app imports ../../shared/models.js).
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { extname, join, normalize } from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
const port = Number(process.argv[2]) || 8080;
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png' };

createServer(async (req, res) => {
  try {
    let path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname));
    if (path.endsWith('/') || path.endsWith('\\')) path += 'index.html';
    if (path.includes('..')) throw new Error('no');
    const body = await readFile(join(root, path));
    res.writeHead(200, { 'Content-Type': types[extname(path)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(body);
  } catch {
    res.writeHead(404); res.end('Not found');
  }
}).listen(port, () => console.log('Speed Scan: http://localhost:' + port + '/scan/public/'));
