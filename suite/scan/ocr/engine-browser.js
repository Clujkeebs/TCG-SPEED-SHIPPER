// Browser text reader: self-hosted Tesseract.js (see vendor/VENDOR.md). Loaded on first use, runs in a worker, offline.
// engine.recognize(grayImage, { region }) -> Promise<string>
const BASE = new URL('../vendor/tesseract/', import.meta.url).href;
const MODES = { title: '7', bottom: '6' }; // single line for the name; a small block for number and set code

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (window.Tesseract) return resolve();
    const s = document.createElement('script');
    s.src = src; s.onload = () => resolve(); s.onerror = () => reject(new Error('could not load the text reader'));
    document.head.append(s);
  });
}

// Bigger and higher contrast reads better: scale small strips up to ~900 px wide and stretch the grey range.
function toCanvas(img) {
  const scale = Math.max(1, Math.min(4, 900 / img.width));
  const c = document.createElement('canvas');
  c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
  const src = document.createElement('canvas'); src.width = img.width; src.height = img.height;
  const sg = src.getContext('2d'); const d = sg.createImageData(img.width, img.height);
  let lo = 255, hi = 0;
  for (const v of img.gray) { if (v < lo) lo = v; if (v > hi) hi = v; }
  const span = Math.max(1, hi - lo);
  for (let i = 0; i < img.gray.length; i += 1) {
    const v = ((img.gray[i] - lo) * 255) / span;
    d.data[i * 4] = d.data[i * 4 + 1] = d.data[i * 4 + 2] = v; d.data[i * 4 + 3] = 255;
  }
  sg.putImageData(d, 0, 0);
  const g = c.getContext('2d'); g.imageSmoothingQuality = 'high'; g.drawImage(src, 0, 0, c.width, c.height);
  return c;
}

export function createBrowserEngine() {
  let workerP = null;
  const worker = () => (workerP ||= (async () => {
    await loadScript(BASE + 'tesseract.min.js');
    const w = await window.Tesseract.createWorker('eng', 1, { workerPath: BASE + 'worker.min.js', corePath: BASE + 'core/', langPath: BASE + 'lang/', workerBlobURL: false });
    await w.setParameters({ user_defined_dpi: '300' });
    return w;
  })().catch((e) => { workerP = null; throw e; }));
  let mode = '';
  return {
    ready: () => worker().then(() => true),
    async recognize(img, { region = 'title' } = {}) {
      const w = await worker();
      if (mode !== region) { await w.setParameters({ tessedit_pageseg_mode: MODES[region] || '6' }); mode = region; }
      const { data } = await w.recognize(toCanvas(img));
      return data.text || '';
    },
    async close() { if (workerP) { const w = await workerP; await w.terminate(); workerP = null; } },
  };
}
