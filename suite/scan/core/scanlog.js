// The anonymous "Share my results" text. One short line per scanned card: the raw text the reader saw (title strip and
// number strip), the card we matched, the card the seller ended with, the game, how sure we were. No pictures, no names,
// no prices, no list contents. At most 60 rows (the newest).
export const MAX_ROWS = 60;
export const FORMAT_LINE = '#speed-scan-results v1';
const clip = (s, n = 120) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

// entry = { g: game, t: title strip text, n: number strip text, m: matched label, c: final label, h: how, s: score }
export function addEntry(log, entry, max = MAX_ROWS) {
  const row = { g: String(entry.g || ''), t: clip(entry.t), n: clip(entry.n), m: clip(entry.m, 80), c: clip(entry.c, 80), h: entry.h || 'none', s: Math.round((Number(entry.s) || 0) * 100) / 100 };
  return [...log, row].slice(-max);
}

export function buildResultsText(log, { version = 'unknown', now = () => new Date().toISOString() } = {}) {
  const rows = (log || []).slice(-MAX_ROWS);
  return [FORMAT_LINE, '#app ' + version, '#date ' + now().slice(0, 10), '#rows ' + rows.length, ...rows.map((r) => JSON.stringify(r))].join('\n');
}

// Reads a pasted results text back. Ignores anything that is not a header or a row; never throws on junk.
export function parseResultsText(text) {
  const out = { ok: false, app: '', date: '', rows: [], skipped: 0 };
  const lines = String(text || '').split(/\r?\n/);
  if (!lines.some((l) => l.trim() === FORMAT_LINE)) return out;
  out.ok = true;
  for (const line of lines) {
    const l = line.trim();
    if (!l) continue;
    if (l.startsWith('#app ')) out.app = l.slice(5);
    else if (l.startsWith('#date ')) out.date = l.slice(6);
    else if (l.startsWith('{')) {
      try {
        const r = JSON.parse(l);
        if (r && typeof r === 'object' && 'h' in r) out.rows.push({ g: String(r.g || ''), t: String(r.t || ''), n: String(r.n || ''), m: String(r.m || ''), c: String(r.c || ''), h: String(r.h), s: Number(r.s) || 0 });
        else out.skipped += 1;
      } catch { out.skipped += 1; }
    }
  }
  return out;
}
