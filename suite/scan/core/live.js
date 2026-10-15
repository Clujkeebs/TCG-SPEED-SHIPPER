// Live scanning: look at camera frames one after another, wait until a card holds still, identify it once,
// then ignore it until it leaves the picture. Pure logic (no timers, no camera) so it is tested in Node;
// the app calls step(frame) every few hundred milliseconds.
function iou(a, b) {
  const iw = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const ih = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  const inter = iw * ih;
  return inter / (a.w * a.h + b.w * b.h - inter);
}

export function createLiveScanner({ detect, identify, stableFrames = 3, sameBox = 0.85, minConfidence = 0.3, missFrames = 2 }) {
  let last = null; let stable = 0; let locked = false; let busy = false; let misses = 0;
  return {
    // Returns { type: 'none'|'tracking'|'busy'|'held'|'result', box?, stable?, result? }
    async step(frame) {
      if (busy) return { type: 'busy' };
      const box = detect(frame);
      if (!box || box.confidence < minConfidence) {
        misses += 1;
        if (misses >= missFrames) { last = null; stable = 0; locked = false; } // card left: ready for the next one
        return { type: 'none' };
      }
      misses = 0;
      stable = last && iou(last, box) >= sameBox ? stable + 1 : 1;
      last = box;
      if (locked) return { type: 'held', box };
      if (stable < stableFrames) return { type: 'tracking', box, stable };
      busy = true;
      try {
        const result = await identify(frame);
        locked = true; // one try per card; remove it and show the next
        return { type: 'result', box, result };
      } finally { busy = false; }
    },
    reset() { last = null; stable = 0; locked = false; misses = 0; },
  };
}
