// Plain-text problem report the seller can paste into the board inbox. It holds only what is needed to see what went
// wrong: what was typed or read, which service, the exact error, the app version and browser string, the time.
// No photos, no list contents, no buyer data, no names.
const clip = (s, n = 300) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

// last = { at, game, kind: 'search'|'scan', query, service, url?, count, error? } as kept by the app
export function buildReport({ last, version, userAgent, now = () => new Date().toISOString(), online } = {}) {
  const lines = ['TCG Speed Scan problem report', 'time: ' + now(), 'app: ' + (version || 'unknown')];
  lines.push('online: ' + (online === undefined ? 'unknown' : online ? 'yes' : 'no'));
  lines.push('browser: ' + clip(userAgent || 'unknown', 200));
  if (!last) lines.push('last lookup: none yet');
  else {
    lines.push('last lookup:');
    lines.push('  game: ' + (last.game || 'any'));
    lines.push('  how: ' + (last.kind || 'search'));
    lines.push('  typed or read: ' + clip(last.query));
    lines.push('  service: ' + (last.service || 'none (offline list only)'));
    if (last.url) lines.push('  address asked: ' + clip(last.url, 400));
    lines.push('  cards found: ' + (last.count ?? 0));
    lines.push('  error text: ' + (last.error ? clip(last.error, 400) : 'none'));
  }
  return lines.join('\n');
}

export function describeLast(last) {
  if (!last) return 'Last lookup: none yet.';
  const what = clip(last.query, 60) || '(empty)';
  if (last.error) return 'Last lookup: "' + what + '" via ' + (last.service || '?') + ' failed: ' + clip(last.error, 120);
  return 'Last lookup: "' + what + '" via ' + (last.service || 'offline list') + ': ' + (last.count ?? 0) + ' found.';
}
