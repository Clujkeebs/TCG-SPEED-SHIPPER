// Settings that are not on/off switches. Right now: the address of a future Agent server (a proxy, so no
// key is ever stored in the browser). It is OFF by default and nothing uses it yet: practice mode makes no
// network requests at all.
export const SETTINGS_KEY = 'tcgss_settings_v1';
export const DEFAULT_SETTINGS = Object.freeze({ agentEndpoint: '', agentEndpointEnabled: false });

// https only, no embedded passwords, no query or fragment, a plain host (no IP literals or localhost).
export function validateEndpoint(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 200) return { ok: false, error: 'Enter a web address (https://...).' };
  let u;
  try { u = new URL(value); } catch { return { ok: false, error: 'That does not look like a web address.' }; }
  if (u.protocol !== 'https:') return { ok: false, error: 'The address must start with https://' };
  if (u.username || u.password) return { ok: false, error: 'Do not put a password in the address.' };
  if (u.search || u.hash) return { ok: false, error: 'Leave out everything after the path (no ? or #).' };
  if (!u.hostname.includes('.') || /^[\d.]+$/.test(u.hostname) || u.hostname.startsWith('[') || u.hostname === 'localhost') return { ok: false, error: 'Use a real web address, not an IP number or localhost.' };
  return { ok: true, value: u.origin + (u.pathname === '/' ? '' : u.pathname.replace(/\/$/, '')) };
}

export async function getSettings(area = globalThis.chrome?.storage?.local) {
  const out = { ...DEFAULT_SETTINGS };
  try {
    const s = (await area.get(SETTINGS_KEY))[SETTINGS_KEY];
    if (s && typeof s === 'object') {
      if (typeof s.agentEndpoint === 'string' && validateEndpoint(s.agentEndpoint).ok) out.agentEndpoint = s.agentEndpoint;
      if (s.agentEndpointEnabled === true && out.agentEndpoint) out.agentEndpointEnabled = true;
    }
  } catch { /* storage unavailable: defaults (off) */ }
  return out;
}

export async function saveEndpoint(value, enabled, area = globalThis.chrome?.storage?.local) {
  const check = value === '' ? { ok: true, value: '' } : validateEndpoint(value);
  if (!check.ok) return check;
  await area.set({ [SETTINGS_KEY]: { agentEndpoint: check.value, agentEndpointEnabled: enabled === true && check.value !== '' } });
  return { ok: true };
}
