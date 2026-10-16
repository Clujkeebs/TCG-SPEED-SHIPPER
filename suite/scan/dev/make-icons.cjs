// DEV script: draws icon-180/192/512.png from public/icon.svg with headless Chromium (iOS needs PNG for the home-screen icon).
// Full-bleed green square: iOS rounds the corners itself and paints transparent corners black.
// Usage: node scan/serve.js 8133 &  then  NODE_PATH=<playwright> node scan/dev/make-icons.cjs [url]
const { chromium } = require('playwright'); const fs = require('fs'); const path = require('path');
const base = process.argv[2] || 'http://localhost:8133';
(async () => {
  const b = await chromium.launch(); const p = await b.newPage(); await p.goto(base + '/scan/public/index.html');
  const out = await p.evaluate(async () => {
    const svg = await (await fetch('icon.svg')).text();
    const img = new Image(); img.src = 'data:image/svg+xml;utf8,' + encodeURIComponent(svg); await img.decode();
    return [180, 192, 512].map((n) => { const c = document.createElement('canvas'); c.width = c.height = n; const g = c.getContext('2d'); g.fillStyle = '#2d6a4f'; g.fillRect(0, 0, n, n); g.drawImage(img, 0, 0, n, n); return [n, c.toDataURL('image/png')]; });
  });
  for (const [n, url] of out) fs.writeFileSync(path.join(__dirname, '..', 'public', 'icon-' + n + '.png'), Buffer.from(url.split(',')[1], 'base64'));
  console.log('wrote', out.map((o) => o[0]).join(', ')); await b.close();
})();
