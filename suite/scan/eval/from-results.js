// Reads a "Share my results" text (pasted from the app) and prints accuracy plus the commonest failure patterns, so the
// parser can be tuned on REAL reader output without any photos.
//   node eval/from-results.js <results.txt>
import { readFileSync } from 'node:fs';
import { parseResultsText } from '../core/scanlog.js';
import { parseCardText } from '../ocr/parse.js';
import { similarity } from '../ocr/resolve.js';

const stripZeros = (s) => String(s).toLowerCase().replace(/^0+(?=\d)/, '');
const splitLabel = (c) => { const [name = '', set = '', number = ''] = String(c).split('|'); return { name, set, number }; };

// Why did this row go wrong? A row can have several reasons. Uses what the reader saw, not the picture.
export function failureReasons(row) {
  const reasons = [];
  const want = splitLabel(row.c);
  const clues = parseCardText(row.t + '\n' + row.n, row.g || undefined);
  if (!row.t.trim() && !row.n.trim()) return ['reader-saw-nothing'];
  if (!clues.name && !clues.number && !clues.setCode) return ['no-usable-text'];
  if (!want.name) return ['never-resolved'];
  if (clues.name ? similarity(clues.name, want.name) < 0.8 : true) reasons.push('title-misread');
  if (!clues.number || stripZeros(clues.number) !== stripZeros(want.number)) reasons.push('number-misread');
  if (row.g !== 'pokemon' && (!clues.setCode || clues.setCode.toLowerCase() !== want.set.toLowerCase())) reasons.push('set-code-misread');
  if (!reasons.length) reasons.push('ambiguous-reprint'); // text was fine, several printings fit
  return reasons;
}

export function analyze(rows) {
  const n = rows.length;
  const count = (f) => rows.filter(f).length;
  const rightFirst = count((r) => r.h === 'auto' || r.h === 'tap');
  const bad = rows.filter((r) => r.h === 'fixed' || r.h === 'none');
  const patterns = {};
  for (const r of bad) {
    for (const why of failureReasons(r)) {
      const p = (patterns[why] ||= { count: 0, examples: [] });
      p.count += 1;
      if (p.examples.length < 3) p.examples.push({ game: r.g, title: r.t, numbers: r.n, wanted: r.c });
    }
  }
  const byGame = {};
  for (const r of rows) { const g = (byGame[r.g || '?'] ||= { n: 0, rightFirst: 0 }); g.n += 1; if (r.h === 'auto' || r.h === 'tap') g.rightFirst += 1; }
  const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : 0);
  return {
    n, rightFirst, rightFirstPct: pct(rightFirst, n),
    autoPct: pct(count((r) => r.h === 'auto'), n), tapPct: pct(count((r) => r.h === 'tap'), n),
    fixedPct: pct(count((r) => r.h === 'fixed'), n), notFoundPct: pct(count((r) => r.h === 'none'), n),
    byGame: Object.fromEntries(Object.entries(byGame).map(([g, v]) => [g, { n: v.n, rightFirstPct: pct(v.rightFirst, v.n) }])),
    patterns: Object.entries(patterns).sort((a, b) => b[1].count - a[1].count).map(([why, v]) => ({ why, ...v })),
  };
}

export function report(text) {
  const p = parseResultsText(text);
  if (!p.ok) return 'Not a Speed Scan results text (the first line should be #speed-scan-results v1).';
  if (!p.rows.length) return 'Results text has no rows.';
  const a = analyze(p.rows);
  const lines = ['Speed Scan results from ' + (p.app || 'unknown app') + ', ' + (p.date || 'no date') + ': ' + a.n + ' cards' + (p.skipped ? ' (' + p.skipped + ' unreadable lines skipped)' : ''),
    'Right first time: ' + a.rightFirst + ' of ' + a.n + ' (' + a.rightFirstPct + '%)  | added by itself ' + a.autoPct + '%, tapped first guess ' + a.tapPct + '%, fixed ' + a.fixedPct + '%, not found ' + a.notFoundPct + '%',
    'By game: ' + Object.entries(a.byGame).map(([g, v]) => g + ' ' + v.rightFirstPct + '% of ' + v.n).join(', '), ''];
  if (!a.patterns.length) lines.push('No failures to look at.');
  else {
    lines.push('Top failure patterns (a card can have several):');
    for (const pat of a.patterns) {
      lines.push('  ' + pat.count + 'x ' + pat.why);
      for (const e of pat.examples) lines.push('      ' + (e.game || '?') + ': title "' + e.title + '" | numbers "' + e.numbers + '" | wanted ' + (e.wanted || '(none)'));
    }
  }
  return lines.join('\n');
}

if (import.meta.url === 'file://' + process.argv[1]) {
  const file = process.argv[2];
  if (!file) { console.error('usage: node eval/from-results.js <results.txt>'); process.exit(1); }
  console.log(report(readFileSync(file, 'utf8')));
}
