// Caps on tool calls and spend (whole cents), per run and per UTC day, plus a kill switch.
// Spend is what the agent itself would cost the seller (model use, paid look-ups). Read-only tools cost 0.
export function createLimits({
  perRun = { maxCalls: 25, maxSpendCents: 50 },
  perDay = { maxCalls: 500, maxSpendCents: 500 },
  now = () => new Date(),
} = {}) {
  let killed = false;
  let killReason = '';
  const days = new Map(); // 'YYYY-MM-DD' -> { calls, spendCents }
  const today = () => {
    const key = now().toISOString().slice(0, 10);
    if (!days.has(key)) days.set(key, { calls: 0, spendCents: 0 });
    return days.get(key);
  };
  const over = (used, cap, add) => cap !== undefined && used + add > cap;

  return {
    kill(reason = 'stopped by the owner') { killed = true; killReason = reason; },
    resume() { killed = false; killReason = ''; },
    isKilled: () => killed,
    newRun() { return { calls: 0, spendCents: 0 }; },
    // Can one more call costing `costCents` go ahead? Does not change any counter.
    check(run, costCents = 0) {
      if (!Number.isInteger(costCents) || costCents < 0) return { ok: false, reason: 'cost must be whole cents' };
      if (killed) return { ok: false, reason: 'kill switch is on: ' + killReason };
      const d = today();
      if (over(run.calls, perRun.maxCalls, 1)) return { ok: false, reason: 'run call limit reached' };
      if (over(run.spendCents, perRun.maxSpendCents, costCents)) return { ok: false, reason: 'run spending limit reached' };
      if (over(d.calls, perDay.maxCalls, 1)) return { ok: false, reason: 'daily call limit reached' };
      if (over(d.spendCents, perDay.maxSpendCents, costCents)) return { ok: false, reason: 'daily spending limit reached' };
      return { ok: true };
    },
    record(run, costCents = 0, { countCall = true } = {}) {
      const d = today();
      if (countCall) { run.calls += 1; d.calls += 1; }
      run.spendCents += costCents;
      d.spendCents += costCents;
    },
    usage: (run) => ({ run: { ...run }, day: { ...today() } }),
  };
}
