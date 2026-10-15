// Find a card in a camera frame and crop it. Pure functions over { width, height, data } where data is
// RGBA (as from canvas ImageData) so the same code runs in the browser and in Node tests.
// Limits (honest): axis-aligned box only, no perspective correction; needs a card that differs from the
// background by a visible amount. Tilted cards give a looser box. Measured only on synthetic frames so far.
const CARD_ASPECT = 63 / 88; // width / height of a standard trading card

export function toGray({ width, height, data }) {
  const g = new Uint8ClampedArray(width * height);
  for (let i = 0, p = 0; i < g.length; i += 1, p += 4) g[i] = (data[p] * 77 + data[p + 1] * 150 + data[p + 2] * 29) >> 8;
  return { width, height, gray: g };
}

const median = (arr) => { const a = Array.from(arr).sort((x, y) => x - y); return a[a.length >> 1]; };

// Returns { x, y, w, h, confidence } or null. confidence is 0..1 from card-shaped aspect and how full the box is.
export function detectCard(image, { threshold = 28, minAreaFrac = 0.1 } = {}) {
  const { width: W, height: H, gray } = image.gray ? image : toGray(image);
  if (W < 8 || H < 8) return null;
  const border = [];
  for (let x = 0; x < W; x += 1) { border.push(gray[x], gray[(H - 1) * W + x]); }
  for (let y = 0; y < H; y += 1) { border.push(gray[y * W], gray[y * W + W - 1]); }
  const bg = median(border);
  const rows = new Uint32Array(H);
  const cols = new Uint32Array(W);
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      if (Math.abs(gray[y * W + x] - bg) > threshold) { rows[y] += 1; cols[x] += 1; }
    }
  }
  const trim = (counts, total) => {
    const need = Math.max(2, total * 0.25); // a card edge fills a good part of its row or column
    let a = 0; let b = counts.length - 1;
    while (a < b && counts[a] < need) a += 1;
    while (b > a && counts[b] < need) b -= 1;
    return [a, b];
  };
  const [y0, y1] = trim(rows, W * 0.3);
  const [x0, x1] = trim(cols, H * 0.3);
  const w = x1 - x0 + 1;
  const h = y1 - y0 + 1;
  if (w * h < W * H * minAreaFrac) return null;
  let on = 0;
  for (let y = y0; y <= y1; y += 1) for (let x = x0; x <= x1; x += 1) if (Math.abs(gray[y * W + x] - bg) > threshold) on += 1;
  const fill = on / (w * h);
  const aspect = Math.min(w / h, h / w);
  const aspectScore = Math.max(0, 1 - Math.abs(aspect - CARD_ASPECT) / 0.25);
  return { x: x0, y: y0, w, h, portrait: h >= w, confidence: Math.round(aspectScore * Math.min(1, fill / 0.8) * 100) / 100 };
}

// Cut the box out of the image; rotates landscape boxes to portrait so later steps see an upright card.
export function cropGray(image, box) {
  const { width: W, gray } = image.gray ? image : toGray(image);
  const out = new Uint8ClampedArray(box.w * box.h);
  for (let y = 0; y < box.h; y += 1) for (let x = 0; x < box.w; x += 1) out[y * box.w + x] = gray[(box.y + y) * W + box.x + x];
  if (box.portrait) return { width: box.w, height: box.h, gray: out };
  const rot = new Uint8ClampedArray(out.length);
  for (let y = 0; y < box.h; y += 1) for (let x = 0; x < box.w; x += 1) rot[x * box.h + (box.h - 1 - y)] = out[y * box.w + x];
  return { width: box.h, height: box.w, gray: rot };
}

// The strips of a card where set code and number are printed. Fractions of the cropped card.
export const REGIONS = {
  title: { x: 0.05, y: 0.03, w: 0.9, h: 0.1 },
  bottom: { x: 0.03, y: 0.9, w: 0.94, h: 0.09 },
};
export function region(image, r) {
  const x0 = Math.floor(r.x * image.width), y0 = Math.floor(r.y * image.height);
  const w = Math.max(1, Math.floor(r.w * image.width)), h = Math.max(1, Math.floor(r.h * image.height));
  const out = new Uint8ClampedArray(w * h);
  for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) out[y * w + x] = image.gray[(y0 + y) * image.width + x0 + x];
  return { width: w, height: h, gray: out };
}
