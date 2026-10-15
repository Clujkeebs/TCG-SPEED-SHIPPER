// Copies the files in vendor-list.js from suite/ into src/vendor/. Run: npm run vendor
import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { VENDORED } from './vendor-list.js';

const root = join(fileURLToPath(import.meta.url), '..', '..');
const suite = join(root, '..');
rmSync(join(root, 'src/vendor'), { recursive: true, force: true });
for (const f of VENDORED) {
  const to = join(root, 'src/vendor', f);
  mkdirSync(dirname(to), { recursive: true });
  cpSync(join(suite, f), to);
}
console.log('vendored', VENDORED.length, 'files into src/vendor/');
