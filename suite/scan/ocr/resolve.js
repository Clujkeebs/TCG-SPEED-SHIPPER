// Clues -> ranked printings from the offline index. Scores are 0..1 and are heuristics, not probabilities.
const fold = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

export function similarity(a, b) {
  a = fold(a); b = fold(b);
  if (!a || !b) return 0;
  if (a === b) return 1;
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j += 1) dp[0][j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return 1 - dp[a.length][b.length] / Math.max(a.length, b.length);
}

export function resolveClues(clues, index, { limit = 5 } = {}) {
  const game = clues.game || undefined;
  const scored = new Map();
  const bump = (p, s) => { if (s > (scored.get(p.id)?.score ?? 0)) scored.set(p.id, { printing: p, score: Math.round(s * 100) / 100 }); };
  const nameSim = (p) => (clues.name ? similarity(clues.name, p.name) : 0);

  if (clues.setCode && clues.number) {
    for (const p of index.findBySetNumber(clues.setCode, clues.number, game)) bump(p, 0.9 + 0.1 * nameSim(p));
  }
  if (clues.setCode && clues.number) {
    // Set code read with a slip (M11 read as MII, OP01 as OPO1): same number and a similar code still counts, just less sure.
    const num = fold(clues.number).replace(/^0+/, '');
    for (const p of index.all()) {
      if (game && p.game !== game) continue;
      if (fold(p.number).replace(/^0+/, '') !== num) continue;
      const ss = similarity(clues.setCode, p.setCode);
      if (ss < 0.6 || ss === 1) continue;
      const ns = clues.name ? nameSim(p) : 0.5;
      if (ns >= 0.6) bump(p, 0.7 + 0.1 * ss + 0.1 * ns);
    }
  }
  if (clues.number) {
    // Set code unreadable or spelled differently by the provider: number plus a similar name still pins it down.
    for (const p of index.all()) {
      if (game && p.game !== game) continue;
      if (fold(p.number).replace(/^0+/, '') !== fold(clues.number).replace(/^0+/, '') && fold(p.number) !== fold(clues.number)) continue;
      const ns = nameSim(p);
      if (ns >= 0.7) bump(p, 0.5 + 0.35 * ns); // tops out at 0.85: number + name may still match several sets
    }
  }
  if (clues.name) {
    for (const p of index.all()) {
      if (game && p.game !== game) continue;
      const ns = nameSim(p);
      if (ns >= 0.75) bump(p, 0.5 * ns); // name alone cannot tell reprints apart, so it never auto-accepts
    }
  }
  return [...scored.values()].sort((a, b) => b.score - a.score || a.printing.id.localeCompare(b.printing.id)).slice(0, limit);
}
