// Packages a clean zip of the extension: manifest + src only (no tests, fixtures, scripts or dev files),
// stamped with the version, the date and the git commit. Needs the `zip` command. Run: npm run build
//   dist/tcg-speed-suite-<version>-<YYYYMMDD>-<commit>.zip     (BUILD.txt inside says the same)
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, rmSync, cpSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { VENDORED } from './vendor-list.js';

const root = join(fileURLToPath(import.meta.url), '..', '..');
const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
if (manifest.version !== pkg.version) throw new Error(`manifest version ${manifest.version} differs from package.json ${pkg.version}`);
for (const f of VENDORED) {
  if (readFileSync(join(root, 'src/vendor', f), 'utf8') !== readFileSync(join(root, '..', f), 'utf8')) throw new Error(`src/vendor/${f} is out of date: npm run vendor`);
}

let commit = 'nogit';
try { commit = execFileSync('git', ['rev-parse', '--short=7', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(); } catch { /* not a git checkout */ }
const date = new Date().toISOString().slice(0, 10).replaceAll('-', '');
const stamp = `${manifest.version}-${date}-${commit}`;

const out = join(root, 'dist');
const stage = join(out, 'stage');
rmSync(stage, { recursive: true, force: true });
mkdirSync(stage, { recursive: true });
cpSync(join(root, 'manifest.json'), join(stage, 'manifest.json'));
cpSync(join(root, 'src'), join(stage, 'src'), { recursive: true });
writeFileSync(join(stage, 'BUILD.txt'), `TCG Speed Suite extension\nversion ${manifest.version}\nbuilt ${new Date().toISOString().slice(0, 10)}\ncommit ${commit}\n`);

const zipPath = join(out, `tcg-speed-suite-${stamp}.zip`);
if (existsSync(zipPath)) rmSync(zipPath);
execFileSync('zip', ['-r', '-X', '-q', zipPath, '.', '-x', '*.DS_Store'], { cwd: stage });
rmSync(stage, { recursive: true, force: true });
console.log('built', zipPath);
