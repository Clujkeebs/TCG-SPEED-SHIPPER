// DEV script (needs Playwright + Chromium): renders each sample card as a synthetic photo (flat card, printed title,
// small number/set text), runs the REAL pipeline in the browser (find card, crop, Tesseract, parse, lookup) and
// reports accuracy and time per card. SYNTHETIC: clean fonts, no glare, no sleeves, no tilt. Real photos will do worse.
// Usage: node scan/serve.js 8127 &   then   NODE_PATH=... node scan/eval/ocr-synthetic.cjs [url] [cardHeightPx]
const { chromium } = require('playwright');
const base = process.argv[2] || 'http://localhost:8127';
const cardH = Number(process.argv[3]) || 700;
const noGame = process.argv[4] === 'nogame'; // seller has not picked a game
const mode = process.argv[5] || 'split'; // split | whole | split-bin
const maxSide = Number(process.argv[6]) || 0; // shrink the picture so its long side is at most this (0 = leave as drawn)
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage();
  p.on('console', (m) => m.type() === 'error' && console.error('page error:', m.text()));
  await p.goto(base + '/scan/public/index.html');
  const res = await p.evaluate(async ({ cardH, noGame, mode, maxSide }) => {
    const { createBrowserEngine } = await import('../ocr/engine-browser.js');
    const { identifyFrame } = await import('../ocr/pipeline.js');
    const { createIndex } = await import('../data/index.js');
    const { printedText } = await import('../eval/simulate.js');
    const printings = await (await fetch('../data/sample/printings.json')).json();
    const index = createIndex(printings);
    const engine = createBrowserEngine({ binarize: mode === 'split-bin' });
    const t0 = performance.now(); await engine.ready(); const loadMs = performance.now() - t0;
    const rows = [];
    for (const pr of printings) {
      const W = Math.round(cardH * 0.9 + 120), H = cardH + 100, cw = Math.round(cardH * 63 / 88);
      const c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d', { willReadFrequently: true });
      g.fillStyle = '#2a2a2a'; g.fillRect(0, 0, W, H);
      const x0 = Math.round((W - cw) / 2), y0 = 50;
      g.fillStyle = '#efe7d2'; g.fillRect(x0, y0, cw, cardH);
      g.fillStyle = '#111'; g.textBaseline = 'middle';
      const lines = printedText(pr).split('\n');
      g.font = 'bold ' + Math.round(cardH * 0.04) + 'px Georgia, serif'; g.fillText(lines[0], x0 + cw * 0.08, y0 + cardH * 0.075);
      g.fillStyle = '#9a8f78'; g.fillRect(x0 + cw * 0.08, y0 + cardH * 0.15, cw * 0.84, cardH * 0.6); // "art"
      g.fillStyle = '#111'; g.font = Math.round(cardH * 0.024) + 'px Arial, sans-serif';
      lines.slice(1).forEach((l, i) => g.fillText(l, x0 + cw * 0.06, y0 + cardH * (0.925 + i * 0.033)));
      let frame = { width: W, height: H, data: g.getImageData(0, 0, W, H).data };
      if (maxSide && Math.max(W, H) > maxSide) { // same shrink the app does (core/imagesize.js)
        const k = maxSide / Math.max(W, H); const w2 = Math.round(W * k), h2 = Math.round(H * k);
        const s = document.createElement('canvas'); s.width = w2; s.height = h2; const sg = s.getContext('2d', { willReadFrequently: true }); sg.drawImage(c, 0, 0, w2, h2);
        frame = { width: w2, height: h2, data: sg.getImageData(0, 0, w2, h2).data };
      }
      const t1 = performance.now();
      const r = await identifyFrame(frame, { engine, index, game: noGame ? undefined : pr.game, strips: mode === 'whole' ? 'whole' : 'split' });
      const ms = performance.now() - t1;
      const ids = r.ok ? r.candidates.map((x) => x.printing.id) : [];
      rows.push({ game: pr.game, name: pr.name, top1: ids[0] === pr.id, top3: ids.slice(0, 3).includes(pr.id), auto: r.ok && r.decision.action === 'accept', wrong: r.ok && r.decision.action === 'accept' && ids[0] !== pr.id, ms, text: r.text });
    }
    const by = (f) => rows.filter(f);
    const pct = (a, n) => Math.round((a / n) * 1000) / 10;
    const sum = (rs) => ({ n: rs.length, top1: pct(rs.filter((r) => r.top1).length, rs.length), top3: pct(rs.filter((r) => r.top3).length, rs.length), autoAccepted: pct(rs.filter((r) => r.auto).length, rs.length), autoWrong: rs.filter((r) => r.wrong).length });
    const ms = rows.map((r) => r.ms).sort((a, b) => a - b);
    const games = {}; for (const g of ['mtg', 'pokemon', 'yugioh', 'onepiece']) games[g] = sum(by((r) => r.game === g));
    return { loadMs: Math.round(loadMs), overall: sum(rows), games, msPerCard: { median: Math.round(ms[ms.length >> 1]), p90: Math.round(ms[Math.floor(ms.length * 0.9)]), max: Math.round(ms[ms.length - 1]) }, misses: rows.filter((r) => !r.top1 || (r.game === 'mtg' && !r.auto)).slice(0, 6).map((r) => [r.name, r.text.replace(/\n+/g, ' | ')]) };
  }, { cardH, noGame, mode, maxSide });
  console.log(JSON.stringify(res, null, 1));
  await b.close();
})();
