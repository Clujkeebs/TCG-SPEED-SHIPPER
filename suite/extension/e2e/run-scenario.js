// Runs a browser scenario script in its own process group and reports its exit code and output.
// Chromium helper processes can outlive the browser and hold the test runner's pipes open, so the
// group is always killed afterwards.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';

export const chromePath = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
export const pwPath = process.env.PLAYWRIGHT_PATH || '/opt/node22/lib/node_modules/playwright';
export const canRun = existsSync(chromePath) && existsSync(pwPath);

export async function runScenario(scenarioPath, timeoutMs = 60000) {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT; // otherwise the child behaves as a test-runner child and can hang
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
  return { code, log: log.split('\n').filter((l) => !/dbus/.test(l)).slice(-20).join('\n') };
}
