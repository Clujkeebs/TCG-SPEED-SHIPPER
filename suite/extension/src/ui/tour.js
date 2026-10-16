// First-run tour of practice mode. Pure data plus a tiny state holder, so it can be tested.
export const UI_KEY = 'tcgss_ui_v1';

export const STEPS = [
  { title: 'This is practice mode', body: 'The assistant works on a made-up shop. Nothing here is real, and nothing leaves your computer.' },
  { title: 'You have the last word', body: 'Before it changes anything, it shows a card. Nothing happens until you press Approve. Deny, and nothing changes.' },
  { title: 'You are always in control', body: 'Press Stop at the top at any time. It can remember facts about your shop: type "remember that ...". See them below, and press Forget to remove one.' }
];

export function createTour(steps = STEPS) {
  let i = 0;
  return {
    get index() { return i; },
    get step() { return steps[i]; },
    get total() { return steps.length; },
    get isFirst() { return i === 0; },
    get isLast() { return i === steps.length - 1; },
    next() { if (i < steps.length - 1) i += 1; return i; },
    back() { if (i > 0) i -= 1; return i; }
  };
}

export async function tourSeen(area = globalThis.chrome?.storage?.local) {
  try { return (await area.get(UI_KEY))[UI_KEY]?.tourDone === true; } catch { return true; } // if storage fails, do not nag
}
export async function markTourSeen(area = globalThis.chrome?.storage?.local) {
  try { await area.set({ [UI_KEY]: { tourDone: true } }); } catch { /* ignore */ }
}
