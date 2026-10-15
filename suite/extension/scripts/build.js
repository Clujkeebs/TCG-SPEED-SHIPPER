// Zips a clean package (manifest + src only: no tests, fixtures or scripts) into dist/.
// Needs the `zip` command. Run: npm run build
import { execFileSync } from 'node:child_process';
import { readFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = join(fileURLToPath(import.meta.url), '..', '..');
const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
if (manifest.version !== pkg.version) throw new Error(`manifest version ${manifest.version} differs from package.json ${pkg.version}`);
if (readFileSync(join(root, 'src/vendor/models.js'), 'utf8') !== readFileSync(join(root, '..', 'shared', 'models.js'), 'utf8')) {
  throw new Error('src/vendor/models.js is out of date: cp ../shared/models.js src/vendor/models.js');
}

const out = join(root, 'dist');
mkdirSync(out, { recursive: true });
const zipPath = join(out, `tcg-speed-suite-${manifest.version}.zip`);
if (existsSync(zipPath)) rmSync(zipPath);
execFileSync('zip', ['-r', '-X', '-q', zipPath, 'manifest.json', 'src', '-x', '*.DS_Store'], { cwd: root });
console.log('built', zipPath);
