// "Check my device": what this browser can do, in plain sentences. Everything comes from an injected env so it is
// testable in Node; in the browser pass browserEnv().
const SIMD_PROBE = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11]);

export function browserEnv() {
  return {
    isSecureContext: window.isSecureContext,
    nav: navigator,
    WebAssembly: typeof WebAssembly === 'undefined' ? undefined : WebAssembly,
    storageProbe: async () => { // can we really write to IndexedDB? (private modes can refuse)
      if (typeof indexedDB === 'undefined') return false;
      return new Promise((resolve) => {
        const req = indexedDB.open('tcg-speed-scan-probe', 1);
        req.onupgradeneeded = () => req.result.createObjectStore('k');
        req.onsuccess = () => { req.result.close(); indexedDB.deleteDatabase('tcg-speed-scan-probe'); resolve(true); };
        req.onerror = () => resolve(false);
        req.onblocked = () => resolve(false);
      });
    },
  };
}

const line = (key, label, ok, good, bad) => ({ key, label, ok, text: ok ? good : bad });

// Returns [{ key, label, ok, text }] (ok true = green, false = red).
export async function checkDevice(env) {
  const nav = env.nav || {};
  const out = [];
  out.push(line('secure', 'Secure page (https)', Boolean(env.isSecureContext),
    'This page is secure, so the camera is allowed.', 'This page is not secure (needs https), so the camera will not work. Open the https link.'));
  out.push(line('camera', 'Camera', Boolean(nav.mediaDevices && typeof nav.mediaDevices.getUserMedia === 'function'),
    'This browser can use the camera.', 'This browser cannot use the camera. Use Safari or Chrome, or upload photos instead.'));
  const W = env.WebAssembly;
  const wasm = Boolean(W && typeof W.validate === 'function');
  out.push(line('wasm', 'Card reading engine', wasm, 'The card reader can run here.', 'The card reader cannot run here (no WebAssembly). Update the browser.'));
  let simd = false;
  try { simd = wasm && W.validate(SIMD_PROBE); } catch { simd = false; }
  out.push(line('simd', 'Fast reading (SIMD)', Boolean(simd), 'Fast reading is available.', 'Fast reading is not available, so card reading will be slower but should still work.'));
  let storage = false;
  try { storage = await env.storageProbe(); } catch { storage = false; }
  out.push(line('storage', 'Saving on this device', Boolean(storage), 'Your list and found cards can be saved on this device.', 'This device will not save your list (private browsing?). Download the CSV before closing the page.'));
  out.push(line('online', 'Internet', nav.onLine !== false, 'You are online, so cards can be looked up.', 'You are offline. Only saved cards and the sample list can be found.'));
  out.push(line('clipboard', 'Copy button', Boolean(nav.clipboard && typeof nav.clipboard.writeText === 'function' && env.isSecureContext),
    'Copying the problem note will work.', 'Copying may not work; the note will be shown so you can select and copy it by hand.'));
  return out;
}

export function checksToText(checks) {
  return (checks || []).map((c) => (c.ok ? 'OK   ' : 'FAIL ') + c.key + ': ' + c.text).join('\n');
}
