// Run `close` after `ms` of nothing happening (the card reader is released after a minute idle to give memory back).
// touch() restarts the wait. Timer functions are injectable for tests.
export function createIdleCloser({ ms = 60000, close, setTimer = setTimeout, clearTimer = clearTimeout }) {
  let t = null;
  return {
    touch() { if (t !== null) clearTimer(t); t = setTimer(() => { t = null; close(); }, ms); },
    cancel() { if (t !== null) { clearTimer(t); t = null; } },
    get waiting() { return t !== null; },
  };
}
