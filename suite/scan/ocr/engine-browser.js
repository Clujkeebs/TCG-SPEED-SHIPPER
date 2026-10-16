// Browser text reader: self-hosted Tesseract.js (see vendor/VENDOR.md). Loaded on first use, runs in a worker, offline.
// engine.recognize(grayImage, { region }) -> Promise<string>
import { createIdleCloser } from '../core/idle.js';

const BASE = new URL('../vendor/tesseract/', import.meta.url).href;
const MODES = { title: '7', bottom: '6', whole: '11' }; // single line for the name; a small block for number and set code

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (window.Tesseract) return resolve();
    const s = document.createElement('script');
    s.src = src; s.onload = () => resolve(); s.onerror = () => reject(new Error('could not load the text reader'));
    document.head.append(s);
  });
}

// Bigger and higher contrast reads better: scale small strips up to ~900 px wide and stretch the grey range.
// Otsu threshold: the grey level that best splits dark ink from light card.
function otsu(gray) {
  const h = new Array(256).fill(0); for (const v of gray) h[v] += 1;
  const total = gray.length; let sum = 0; for (let i = 0; i < 256; i += 1) sum += i * h[i];
  let wB = 0, sB = 0, best = 0, t = 128;
  for (let i = 0; i < 256; i += 1) { wB += h[i]; if (!wB) continue; const wF = total - wB; if (!wF) break; sB += i * h[i]; const mB = sB / wB, mF = (sum - sB) / wF; const v = wB * wF * (mB - mF) ** 2; if (v > best) { best = v; t = i; } }
  return t;
}

function toCanvas(img, binarize = false) {
  const scale = Math.max(1, Math.min(4, 900 / img.width));
  const c = document.createElement('canvas');
  c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
  const src = document.createElement('canvas'); src.width = img.width; src.height = img.height;
  const sg = src.getContext('2d'); const d = sg.createImageData(img.width, img.height);
  let lo = 255, hi = 0;
  for (const v of img.gray) { if (v < lo) lo = v; if (v > hi) hi = v; }
  const span = Math.max(1, hi - lo);
  const thr = binarize ? otsu(img.gray) : 0;
  for (let i = 0; i < img.gray.length; i += 1) {
    let v = ((img.gray[i] - lo) * 255) / span;
    if (binarize) v = img.gray[i] > thr ? 255 : 0;
    d.data[i * 4] = d.data[i * 4 + 1] = d.data[i * 4 + 2] = v; d.data[i * 4 + 3] = 255;
  }
  sg.putImageData(d, 0, 0);
  const g = c.getContext('2d'); g.imageSmoothingQuality = 'high'; g.drawImage(src, 0, 0, c.width, c.height);
  return c;
}

// options.binarize: black-and-white the strip before reading (measured in docs/suite/SCAN-EVAL.md).
export function createBrowserEngine({ binarize = false } = {}) {
  let workerP = null;
  const worker = () => (workerP ||= (async () => {
    await loadScript(BASE + 'tesseract.min.js');
    const w = await window.Tesseract.createWorker('eng', 1, { workerPath: BASE + 'worker.min.js', corePath: BASE + 'core/', langPath: BASE + 'lang/', workerBlobURL: false });
    await w.setParameters({ user_defined_dpi: '300' });
    return w;
  })().catch((e) => { workerP = null; throw e; }));
  let mode = '';
  // After a minute of nothing the reader is shut down to give memory back (it starts again on the next scan).
  const idle = createIdleCloser({ ms: 60000, close: () => { api.close(); } });
  const api = {
    ready: () => worker().then(() => { idle.touch(); return true; }),
    async recognize(img, { region = 'title' } = {}) {
      idle.cancel();
      const w = await worker();
      if (mode !== region) { await w.setParameters({ tessedit_pageseg_mode: MODES[region] || '6' }); mode = region; }
      const { data } = await w.recognize(toCanvas(img, binarize));
      idle.touch();
      return data.text || '';
    },
    async close() { idle.cancel(); if (workerP) { const p = workerP; workerP = null; mode = ''; try { const w = await p; await w.terminate(); } catch { /* never started */ } } },
  };
  return api;
}
