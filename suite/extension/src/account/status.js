// "Can the online assistant be used for this account?" One GET to the site's own status address, with the
// login token in the Authorization header and nowhere else. Returns ONE plain line for the panel, never a token,
// never raw server text. The model itself is not called here.
export const STATUS_PATH = '/api/agent/status';
export const SITE_URL = 'https://tcgspeedshipper.com';

const timeOf = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
};

// Plain words for every code in docs/suite/AGENT-PROXY.md. `resetsAt` (UTC) says when a limit comes back.
export const CODE_LINES = {
  bad_request: () => 'The online assistant could not understand the request. Close and reopen this panel.',
  plan: () => 'The online assistant needs the Premium plan.',
  blocked: () => 'The online assistant is switched off for your account.',
  too_big: () => 'That question was too big for the online assistant. Try a smaller one.',
  runs: (r) => `You have used today's online questions.${r ? ` They come back at ${r}.` : ' They come back tomorrow.'}`,
  calls: (r) => `You have used today's online assistant steps.${r ? ` They come back at ${r}.` : ''}`,
  day: (r) => `You have reached today's online assistant limit.${r ? ` It comes back at ${r}.` : ''}`,
  month: () => "You have reached this month's online assistant limit. It comes back next month.",
  global: () => 'The online assistant is very busy today. Please try again tomorrow.',
  steps: () => 'That question needed too many steps. Try asking something smaller.',
  busy: () => 'The online assistant is still answering your last question. Wait a moment.',
  model_error: () => 'The online assistant could not answer just now. Try again in a minute.',
  off: () => 'The online assistant is not switched on yet.',
  try_again: () => 'The online assistant has a temporary problem. Try again in a minute.'
};
const GENERIC = 'The online assistant is not available right now.';

// body: parsed JSON (or null). Only known fields are read; everything shown comes from the table above.
export function describeStatus(httpStatus, body) {
  if (httpStatus === 401) return { kind: 'signed-out', line: 'You are not signed in.', openSite: true };
  const b = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
  const code = typeof b.code === 'string' ? b.code.slice(0, 20) : '';
  if (httpStatus === 200 && b.available === true) {
    const left = Number.isInteger(b.remaining?.runsToday) && b.remaining.runsToday >= 0 ? b.remaining.runsToday : null;
    return { kind: 'available', line: left === null ? 'The online assistant is available.' : `The online assistant is available. ${left} ${left === 1 ? 'run' : 'runs'} left today.`, openSite: false };
  }
  const resets = typeof b.resetsAt === 'string' ? timeOf(b.resetsAt) : '';
  const say = CODE_LINES[code] ?? (httpStatus === 402 ? CODE_LINES.plan : httpStatus === 403 ? CODE_LINES.blocked : httpStatus === 503 ? CODE_LINES.off : httpStatus === 429 ? CODE_LINES.day : null);
  const kind = code === 'plan' || httpStatus === 402 ? 'needs-plan' : code === 'off' || httpStatus === 503 ? 'off' : 'unavailable';
  return { kind, line: say ? say(resets) : GENERIC, openSite: false };
}

export const OFFLINE_LINE = 'I could not reach tcgspeedshipper.com. Check your internet connection.';

// deps: { vault, fetchFn, base, timeoutMs }
export async function checkAccount({ vault, fetchFn = globalThis.fetch, base = SITE_URL, timeoutMs = 8000 }) {
  const token = await vault.get(); // null when none or expired: then nothing is sent at all
  if (!token) return { kind: 'signed-out', line: 'You are not signed in.', openSite: true };
  const url = base + STATUS_PATH;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchFn(url, {
      method: 'GET', headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' },
      credentials: 'omit', cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer', signal: controller.signal
    });
    let body = null;
    try { body = await res.json(); } catch { body = null; }
    const out = describeStatus(res.status, body);
    if (res.status === 401) await vault.drop(); // the site says it is no good: forget it
    return out;
  } catch {
    return { kind: 'offline', line: OFFLINE_LINE, openSite: false };
  } finally {
    clearTimeout(timer);
  }
}
