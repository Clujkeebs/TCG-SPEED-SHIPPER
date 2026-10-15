// Runs a browser scenario script in its own process group and reports its exit code and output.
// Chromium helper processes can outlive the browser and hold the test runner's pipes open, so the
// group is always killed afterwards.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';

export const chromePath = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
export const pwPath = process.env.PLAYWRIGHT_PATH || '/opt/node22/lib/node_modules/playwright';
export const canRun = existsSync(chromePath) && existsSync(pwPath);

export async function runScenario(scenarioPath, timeoutMs = 60000) {
  // Allow-listed environment: proxy variables, NODE_OPTIONS, npm_config_* and NODE_TEST_CONTEXT
  // from the caller must not reach the browser scenario, so it behaves the same in every shell.
  const env = {};
  for (const key of ['PATH', 'HOME', 'TMPDIR', 'CHROMIUM_PATH', 'PLAYWRIGHT_PATH', 'PLAYWRIGHT_BROWSERS_PATH']) {
    if (process.env[key] !== undefined) env[key] = process.env[key];
  }
  const child = spawn(process.execPath, [scenarioPath], { detached: true, stdio: ['ignore', 'pipe', 'pipe'], env });
  let log = '';
  child.stdout.on('data', (d) => (log += d));
  child.stderr.on('data', (d) => (log += d));
  const code = await new Promise((resolve) => {
    const timer = setTimeout(() => resolve('timeout'), timeoutMs);
    child.on('exit', (c) => { clearTimeout(timer); resolve(c); });
  });
  try { process.kill(-child.pid, 'SIGKILL'); } catch { /* already gone */ }
  child.stdout.destroy();
  child.stderr.destroy();
  const lines = log.split('\n').filter((l) => !/dbus/.test(l));
  return { code, log: (code === 'timeout' ? `(no result after ${timeoutMs} ms; last output follows)\n` : '') + lines.slice(-30).join('\n') };
}
