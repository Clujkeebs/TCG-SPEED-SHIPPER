// Evaluation harness: run a set of labeled cases through the lookup and count how often the right card
// comes first (top-1) or in the top three. Cases: { id, game, expected (printingId), text }.
// Real-photo cases come from the owner (see docs/suite/SCAN-EVAL.md); simulated cases test only the lookup.
import { identifyText } from '../ocr/pipeline.js';

export function runEval(cases, { index, now = () => performance.now() }) {
  const rows = [];
  for (const c of cases) {
    const t0 = now();
    const r = identifyText(c.text, { index, game: c.game });
    const ms = now() - t0;
    const ids = r.candidates.map((x) => x.printing.id);
    rows.push({ id: c.id, game: c.game, top1: ids[0] === c.expected, top3: ids.slice(0, 3).includes(c.expected),
      auto: r.decision.action === 'accept', autoWrong: r.decision.action === 'accept' && ids[0] !== c.expected, ms });
  }
  return summarize(rows);
}

const pct = (n, d) => (d ? Math.round((n / d) * 1000) / 10 : 0);
const med = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[s.length >> 1] : 0; };

export function summarize(rows) {
  const games = {};
  for (const r of rows) (games[r.game] ||= []).push(r);
  const one = (rs) => ({
    n: rs.length,
    top1: pct(rs.filter((r) => r.top1).length, rs.length),
    top3: pct(rs.filter((r) => r.top3).length, rs.length),
    autoAccepted: pct(rs.filter((r) => r.auto).length, rs.length),
    autoWrong: rs.filter((r) => r.autoWrong).length,
    medianMs: Math.round(med(rs.map((r) => r.ms)) * 100) / 100,
  });
  return { overall: one(rows), byGame: Object.fromEntries(Object.entries(games).map(([g, rs]) => [g, one(rs)])) };
}
