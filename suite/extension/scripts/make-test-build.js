// Makes a TEST copy of the extension for the browser tests: the same code, plus localhost as an allowed page
// (manifest match and bridge switch). The production build and the committed manifest never include localhost.
// Usage: import { makeTestBuild } from './make-test-build.js'; const dir = makeTestBuild(tmpDir);
import { cpSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = join(fileURLToPath(import.meta.url), '..', '..');

export function makeTestBuild(outDir, { apiBase = 'http://localhost:9' } = {}) {
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  cpSync(join(root, 'src'), join(outDir, 'src'), { recursive: true });
  const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));
  manifest.content_scripts[0].matches = [...manifest.content_scripts[0].matches, 'http://localhost/*'];
  manifest.web_accessible_resources[0].matches = [...manifest.web_accessible_resources[0].matches, 'http://localhost/*'];
  manifest.host_permissions = [...(manifest.host_permissions ?? []), 'http://localhost/*'];
  manifest.name += ' (test build)';
  writeFileSync(join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  writeFileSync(join(outDir, 'src/build-config.js'), `export const ALLOW_LOCALHOST = true; // TEST BUILD ONLY\nexport const API_BASE = ${JSON.stringify(apiBase)}; // TEST BUILD ONLY: a local stub server\n`);
  return outDir;
}
