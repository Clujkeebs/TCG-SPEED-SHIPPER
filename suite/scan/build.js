// Builds a static folder that any plain web host can serve: node scan/build.js [outDir]  (default scan/dist).
// Layout inside the folder mirrors the source (scan/public, scan/core, ..., shared) so the app's imports keep
// working, and index.html at the top sends visitors to the app. No build tools, no changes to the code.
import { cpSync, mkdirSync, rmSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const suite = fileURLToPath(new URL('..', import.meta.url));
const out = process.argv[2] || join(suite, 'scan', 'dist');
rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, 'scan'), { recursive: true });
const keep = (src) => !/\.test\.js$/.test(src) && !/[\\/]data[\\/]cache/.test(src);
for (const dir of ['public', 'core', 'data', 'vision', 'ocr', 'vendor']) cpSync(join(suite, 'scan', dir), join(out, 'scan', dir), { recursive: true, filter: keep });
cpSync(join(suite, 'shared', 'models.js'), join(out, 'shared', 'models.js'));
writeFileSync(join(out, 'index.html'), '<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0; url=scan/public/"><title>TCG Speed Scan</title><a href="scan/public/">Open TCG Speed Scan</a>\n');
let files = 0, bytes = 0;
(function walk(d) { for (const f of readdirSync(d)) { const p = join(d, f); const s = statSync(p); if (s.isDirectory()) walk(p); else { files += 1; bytes += s.size; } } })(out);
console.log('built ' + files + ' files (' + Math.round(bytes / 1024) + ' KB) in ' + out);
