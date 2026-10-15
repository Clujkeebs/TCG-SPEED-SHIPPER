// Feature flags kept in chrome.storage.local. Everything defaults to off.
// Modules that touch a TCGplayer page are also behind TOS_OK, which stays false until the
// Builder writes "TOS OK" in docs/suite/LOG.md (then a reviewed change flips it).

export const TOS_OK = false;
export const STORAGE_KEY = 'tcgss_flags_v1';

export const FLAG_DEFS = {
  pasteTracking: { label: 'Paste tracking', touchesTcgplayer: true },
  printShipping: { label: 'Print shipping', touchesTcgplayer: true },
  uploadToTcgplayer: { label: 'Upload to TCGplayer', touchesTcgplayer: true },
  agentPanel: { label: 'Agent side panel', touchesTcgplayer: false }
};

export const DEFAULT_FLAGS = Object.freeze(Object.fromEntries(Object.keys(FLAG_DEFS).map((k) => [k, false])));

// A tiny in-memory stand-in with the same get/set shape as chrome.storage.local (tests, fallback).
export function memoryArea() {
  const data = {};
  return {
    async get(key) {
      return key in data ? { [key]: structuredClone(data[key]) } : {};
    },
    async set(obj) {
      for (const [k, v] of Object.entries(obj)) data[k] = structuredClone(v);
    }
  };
}

function defaultArea() {
  return globalThis.chrome?.storage?.local ?? memoryArea();
}

// Stored values are only trusted when they are exactly true; unknown keys are dropped.
export async function getFlags(area = defaultArea()) {
  const out = { ...DEFAULT_FLAGS };
  try {
    const stored = (await area.get(STORAGE_KEY))[STORAGE_KEY];
    if (stored && typeof stored === 'object') {
      for (const key of Object.keys(DEFAULT_FLAGS)) if (stored[key] === true) out[key] = true;
    }
  } catch {
    // storage unavailable: stay with the safe defaults (all off)
  }
  return out;
}

export async function setFlag(name, value, area = defaultArea()) {
  if (!(name in DEFAULT_FLAGS)) throw new Error('unknown flag: ' + name);
  if (typeof value !== 'boolean') throw new Error('flag value must be true or false');
  const next = await getFlags(area);
  next[name] = value;
  await area.set({ [STORAGE_KEY]: next });
  return next;
}

// What code should ask. A TCGplayer-touching module is off unless the flag is on AND the TOS gate is open.
export async function isEnabled(name, { area = defaultArea(), tosOk = TOS_OK } = {}) {
  if (!(name in FLAG_DEFS)) return false;
  if (FLAG_DEFS[name].touchesTcgplayer && !tosOk) return false;
  return (await getFlags(area))[name] === true;
}
