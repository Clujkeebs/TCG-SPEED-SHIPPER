// "Right first time", measured from this device's own use. Counts only: nothing about which cards.
//   auto  = read and added by itself, left alone
//   tap   = the app asked, and the seller tapped its TOP guess (the app was right, just not sure enough)
//   fixed = the seller had to correct it (tapped another guess, or searched for the card instead)
//   autoUndone = an auto-added card the seller then removed (it was wrong after all)
//   notFound = a scan that matched nothing and was never fixed
export const emptyStats = () => ({ auto: 0, tap: 0, fixed: 0, autoUndone: 0, notFound: 0 });

export function recordScan(stats, kind) {
  if (!(kind in emptyStats())) throw new Error('unknown kind: ' + kind);
  return { ...stats, [kind]: (stats[kind] || 0) + 1 };
}

export function summarize(stats = emptyStats()) {
  const s = { ...emptyStats(), ...stats };
  const total = s.auto + s.tap + s.fixed;
  const rightFirst = Math.max(0, s.auto - s.autoUndone) + s.tap;
  const text = total === 0
    ? 'Right first time: no scanned cards yet.'
    : 'Right first time: ' + Math.min(rightFirst, total) + ' of ' + total + ' (added by itself ' + s.auto + ', you tapped its first guess ' + s.tap + ', you fixed ' + s.fixed + (s.autoUndone ? ', removed after auto-add ' + s.autoUndone : '') + (s.notFound ? '; not found ' + s.notFound : '') + '). Measured from this device’s own use.';
  return { total, rightFirst: Math.min(rightFirst, total), text, ...s };
}
