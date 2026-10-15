// DEV script: draws 20 synthetic card photos (flat card, printed text, no art) into sample-photos/ using headless Chromium.
// Usage: node scan/serve.js 8128 &  then  NODE_PATH=<playwright> node scan/dev/make-sample-photos.cjs [url]
// They are made-up renderings of sample-list cards, for trying the app with no camera. Not real photos.
const { chromium } = require('playwright'); const fs = require('fs'); const path = require('path');
const base = process.argv[2] || 'http://localhost:8128';
const names = ['Lightning Bolt', 'Sol Ring', 'Counterspell', 'Llanowar Elves', 'Birds of Paradise', 'Charizard', 'Pikachu', 'Mewtwo', 'Mew ex', 'Iono', 'Blue-Eyes White Dragon', 'Dark Magician', 'Mirror Force', 'Exodia the Forbidden One', 'Pot of Greed', 'Nami', 'Roronoa Zoro', 'Monkey D. Luffy', 'Boa Hancock', 'Shanks'];
(async () => {
  const b = await chromium.launch(); const p = await b.newPage(); await p.goto(base + '/scan/public/index.html');
  const out = await p.evaluate(async (names) => {
    const { printedText } = await import('../eval/simulate.js');
    const all = await (await fetch('../data/sample/printings.json')).json();
    const res = [];
    for (const n of names) {
      const pr = all.find((x) => x.name === n); const cardH = 700, W = 740, H = 800, cw = 493;
      const c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d');
      g.fillStyle = '#2a2a2a'; g.fillRect(0, 0, W, H); const x0 = (W - cw) / 2, y0 = 50;
      g.fillStyle = '#efe7d2'; g.fillRect(x0, y0, cw, cardH); g.fillStyle = '#111'; g.textBaseline = 'middle';
      const lines = printedText(pr).split('\n');
      g.font = 'bold 28px Georgia, serif'; g.fillText(lines[0], x0 + cw * 0.08, y0 + cardH * 0.075);
      g.fillStyle = '#9a8f78'; g.fillRect(x0 + cw * 0.08, y0 + cardH * 0.15, cw * 0.84, cardH * 0.6);
      g.fillStyle = '#111'; g.font = '17px Arial, sans-serif';
      lines.slice(1).forEach((l, i) => g.fillText(l, x0 + cw * 0.06, y0 + cardH * (0.925 + i * 0.033)));
      res.push([pr.game + '-' + pr.setCode.toLowerCase() + '-' + pr.number.toLowerCase() + '.png', c.toDataURL('image/png')]);
    }
    return res;
  }, names);
  const dir = path.join(__dirname, '..', 'sample-photos'); fs.mkdirSync(dir, { recursive: true });
  for (const [f, url] of out) fs.writeFileSync(path.join(dir, f), Buffer.from(url.split(',')[1], 'base64'));
  console.log('wrote', out.length, 'images to', dir); await b.close();
})();
