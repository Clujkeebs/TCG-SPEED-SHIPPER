// Rapid-fire decisions: when to accept a match by itself and when to ask the seller to tap.
export const DEFAULT_THRESHOLDS = { accept: 0.9, margin: 0.15, choices: 3 };

// candidates: [{ printing, score }] best first. Returns { action: 'accept'|'choose'|'none', pick?, options }.
export function decide(candidates, t = DEFAULT_THRESHOLDS) {
  if (!candidates.length) return { action: 'none', options: [] };
  const [top, next] = candidates;
  const clear = top.score >= t.accept && (!next || top.score - next.score >= t.margin);
  if (clear) return { action: 'accept', pick: top.printing, options: candidates.slice(0, t.choices) };
  return { action: 'choose', options: candidates.slice(0, t.choices) };
}

// Beep and buzz are injected so tests stay silent. In a browser: makeFeedback({ vibrate, beep }).
export function makeFeedback({ vibrate, beep } = {}) {
  return {
    accepted() { vibrate?.(20); beep?.(880, 60); },
    needsTap() { vibrate?.([30, 40, 30]); beep?.(330, 120); },
    miss() { vibrate?.(80); beep?.(200, 160); },
  };
}
export function browserFeedback() {
  let ctx;
  return makeFeedback({
    vibrate: (p) => { try { navigator.vibrate?.(p); } catch { /* not supported */ } },
    beep: (freq, ms) => {
      try {
        ctx ||= new (window.AudioContext || window.webkitAudioContext)();
        const o = ctx.createOscillator(); const g = ctx.createGain();
        g.gain.value = 0.05; o.frequency.value = freq; o.connect(g); g.connect(ctx.destination);
        o.start(); o.stop(ctx.currentTime + ms / 1000);
      } catch { /* no audio */ }
    },
  });
}
