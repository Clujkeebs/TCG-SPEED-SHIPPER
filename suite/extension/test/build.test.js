import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { readdirSync } from 'node:fs';

const root = join(fileURLToPath(import.meta.url), '..', '..');
const haveZip = spawnSync('zip', ['-v']).status === 0 && spawnSync('unzip', ['-v']).status === 0;

test('the build makes a stamped zip with only what the extension needs', { skip: !haveZip && 'zip/unzip not installed' }, () => {
  execFileSync(process.execPath, [join(root, 'scripts/build.js')], { cwd: root, stdio: 'pipe' });
  const zips = readdirSync(join(root, 'dist')).filter((f) => /^tcg-speed-suite-\d+\.\d+\.\d+-\d{8}-[0-9a-z]+\.zip$/.test(f));
  assert.ok(zips.length >= 1, 'zip name carries version, date and commit');
  const listing = execFileSync('unzip', ['-Z1', join(root, 'dist', zips.at(-1))], { encoding: 'utf8' }).split('\n').filter(Boolean);
  assert.ok(listing.includes('manifest.json') && listing.includes('BUILD.txt') && listing.includes('src/background.js') && listing.includes('src/vendor/agent/loop.js'));
  for (const f of listing) assert.ok(!/^(test|e2e|scripts|node_modules|dist)\//.test(f) && !/\.test\.js$|package\.json$/.test(f), f + ' should not ship');
  const build = execFileSync('unzip', ['-p', join(root, 'dist', zips.at(-1)), 'BUILD.txt'], { encoding: 'utf8' });
  assert.match(build, /version 0\.1\.0/);
});
