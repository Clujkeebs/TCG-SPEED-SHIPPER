// DEV script (needs Playwright + Chromium, which the app itself does not): draws synthetic cards at random
// sizes, positions, tilts, backgrounds and noise on a canvas, runs vision/detect.js on them in the browser and
// reports how often the box matches the truth (IoU >= 0.9) and how long detection takes.
// Usage: node scan/serve.js 8125 &   then   node scan/eval/render-synthetic.cjs [http://localhost:8125]
// SYNTHETIC cards only: real photos have glare, sleeves, shadows and clutter, so expect worse.
const { chromium } = require('playwright');
const base = process.argv[2] || 'http://localhost:8125';
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage();
  await p.goto(base + '/scan/public/index.html');
  const res = await p.evaluate(async () => {
    const { detectCard } = await import('../vision/detect.js');
    let seed = 42; const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    const out = [];
    for (const tilt of [0, 2, 5, 10]) {
      let ok = 0, ms = 0; const N = 100;
      for (let i = 0; i < N; i += 1) {
        const W = 640, H = 480, c = document.createElement('canvas'); c.width = W; c.height = H;
        const g = c.getContext('2d', { willReadFrequently: true });
        const bg = 30 + rnd() * 160; g.fillStyle = `rgb(${bg},${bg},${bg})`; g.fillRect(0, 0, W, H);
        const ch = 220 + rnd() * 140, cw = ch * 63 / 88;
        const cx = cw / 2 + 20 + rnd() * (W - cw - 40), cy = ch / 2 + 10 + rnd() * (H - ch - 20);
        const a = (rnd() * 2 - 1) * tilt * Math.PI / 180;
        const face = bg > 110 ? 25 + rnd() * 40 : 190 + rnd() * 60;
        g.save(); g.translate(cx, cy); g.rotate(a); g.fillStyle = `rgb(${face},${face},${face})`; g.fillRect(-cw / 2, -ch / 2, cw, ch);
        g.fillStyle = `rgb(${255 - face},${255 - face},${255 - face})`; g.fillRect(-cw / 2 + 8, -ch / 2 + 8, cw - 16, 22); g.fillRect(-cw / 2 + 8, ch / 2 - 30, cw - 16, 18);
        g.restore();
        const img = g.getImageData(0, 0, W, H);
        for (let k = 0; k < img.data.length; k += 4) { const n = (rnd() - 0.5) * 16; img.data[k] += n; img.data[k + 1] += n; img.data[k + 2] += n; }
        const ex = Math.abs(Math.cos(a)) * cw / 2 + Math.abs(Math.sin(a)) * ch / 2, ey = Math.abs(Math.sin(a)) * cw / 2 + Math.abs(Math.cos(a)) * ch / 2;
        const gt = { x: cx - ex, y: cy - ey, w: 2 * ex, h: 2 * ey };
        const t0 = performance.now(); const f = detectCard(img); ms += performance.now() - t0;
        if (f) {
          const iw = Math.max(0, Math.min(f.x + f.w, gt.x + gt.w) - Math.max(f.x, gt.x)), ih = Math.max(0, Math.min(f.y + f.h, gt.y + gt.h) - Math.max(f.y, gt.y));
          const inter = iw * ih; if (inter / (f.w * f.h + gt.w * gt.h - inter) >= 0.9) ok += 1;
        }
      }
      out.push({ tiltDegMax: tilt, frames: N, foundPct: ok, meanMsPerFrame: Math.round(ms / N * 10) / 10 });
    }
    return out;
  });
  console.log(JSON.stringify(res, null, 1));
  await b.close();
})();
