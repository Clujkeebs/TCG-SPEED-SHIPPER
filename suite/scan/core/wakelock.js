// Keep the screen awake while the camera is on. Uses the Wake Lock API where it exists (Safari 16.4+, Chrome);
// otherwise does nothing and says nothing. The lock is dropped by the browser when the page is hidden, so it is
// asked for again when the page comes back.
export function createWakeLock({ nav, doc }) {
  let sentinel = null; let wanted = false; let supported = Boolean(nav && nav.wakeLock && nav.wakeLock.request);
  async function acquire() {
    if (!supported || !wanted || sentinel) return false;
    try {
      sentinel = await nav.wakeLock.request('screen');
      if (sentinel && sentinel.addEventListener) sentinel.addEventListener('release', () => { sentinel = null; });
      return true;
    } catch { sentinel = null; return false; } // refused (low battery, no gesture): carry on without it
  }
  const onVisible = () => { if (doc && doc.visibilityState === 'visible') acquire(); };
  if (doc && doc.addEventListener) doc.addEventListener('visibilitychange', onVisible);
  return {
    get supported() { return supported; },
    get active() { return Boolean(sentinel); },
    async on() { wanted = true; return acquire(); },
    async off() {
      wanted = false;
      const s = sentinel; sentinel = null;
      try { if (s && s.release) await s.release(); } catch { /* already released */ }
    },
  };
}
