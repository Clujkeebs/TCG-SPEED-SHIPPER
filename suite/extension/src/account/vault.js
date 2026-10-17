// Holds the signed-in user's ACCESS token. Rules, all tested:
//  - memory first; chrome.storage.session as a backup only so a sleeping service worker keeps it
//    (session storage is cleared when the browser closes and is not readable by web pages);
//  - never chrome.storage.local, never IndexedDB, never a log, never a message back to a page;
//  - dropped at its own expiry, on sign-out and on Clear everything;
//  - the only way to get it out is get(), used for exactly one thing: the Authorization header of a status call.
export const SESSION_KEY = 'tcgss_session_v1';
export const MAX_LIFETIME_MS = 24 * 3600 * 1000;

export function createVault({ area, now = () => Date.now() } = {}) {
  let held = null; // { token, expiresAt }
  // On a wake-up, take back what was held before the worker slept.
  const restored = (async () => {
    try {
      const v = area ? (await area.get(SESSION_KEY))[SESSION_KEY] : null;
      if (v && typeof v.token === 'string' && Number.isFinite(v.expiresAt) && v.expiresAt > now() && held === null) held = { token: v.token, expiresAt: v.expiresAt };
      else if (v && area) await area.remove(SESSION_KEY);
    } catch { /* no session storage: memory only */ }
  })();

  async function drop() {
    held = null;
    try { await area?.remove(SESSION_KEY); } catch { /* ignore */ }
  }

  return {
    // Returns true if kept. A token that is already expired, or valid for more than 24 hours, is refused.
    async set(token, expiresAtMs) {
      await restored;
      if (typeof token !== 'string' || !token || !Number.isFinite(expiresAtMs)) return false;
      const t = now();
      if (expiresAtMs <= t || expiresAtMs - t > MAX_LIFETIME_MS) return false;
      held = { token, expiresAt: expiresAtMs };
      try { await area?.set({ [SESSION_KEY]: held }); } catch { /* memory only */ }
      return true;
    },
    // The token, or null when there is none or it has expired (and then it is dropped).
    async get() {
      await restored;
      if (!held) return null;
      if (held.expiresAt <= now()) { await drop(); return null; }
      return held.token;
    },
    async has() { return (await this.get()) !== null; },
    expiresAt: () => (held ? held.expiresAt : null),
    drop: async () => { await restored; await drop(); }
  };
}

// For anything that must print or store text that might contain a login token.
export function redactTokens(text) {
  return String(text ?? '').replace(/[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}/g, '[login token]').replace(/Bearer\s+\S+/gi, 'Bearer [login token]');
}
