import test from 'node:test';
import assert from 'node:assert/strict';
import { detectCard, cropGray, toGray, region, REGIONS } from './detect.js';

// Synthetic RGBA frame: flat background with a lighter card rectangle and a dark "title bar" inside it.
function frame(W, H, box, { bg = 40, card = 200, noise = 0, seed = 7 } = {}) {
  const data = new Uint8ClampedArray(W * H * 4);
  let s = seed;
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  for (let y = 0; y < H; y += 1) for (let x = 0; x < W; x += 1) {
    const inside = box && x >= box.x && x < box.x + box.w && y >= box.y && y < box.y + box.h;
    let v = inside ? card : bg;
    if (inside && y < box.y + box.h * 0.1) v = 90; // title strip
    v += (rnd() - 0.5) * 2 * noise;
    const p = (y * W + x) * 4; data[p] = data[p + 1] = data[p + 2] = v; data[p + 3] = 255;
  }
  return { width: W, height: H, data };
}

test('finds a portrait card on a plain background', () => {
  const box = { x: 60, y: 20, w: 126, h: 176 };
  const f = detectCard(frame(320, 240, box));
  assert.ok(Math.abs(f.x - box.x) <= 2 && Math.abs(f.y - box.y) <= 2);
  assert.ok(Math.abs(f.w - box.w) <= 3 && Math.abs(f.h - box.h) <= 3);
  assert.ok(f.portrait && f.confidence > 0.8, JSON.stringify(f));
});

test('still finds it with sensor noise and a light background', () => {
  const box = { x: 100, y: 30, w: 126, h: 176 };
  const f = detectCard(frame(320, 240, box, { bg: 120, card: 235, noise: 10 }));
  assert.ok(f && Math.abs(f.w - 126) <= 4 && Math.abs(f.h - 176) <= 4, JSON.stringify(f));
});

test('empty frame and tiny frame give no card', () => {
  assert.equal(detectCard(frame(320, 240, null)), null);
  assert.equal(detectCard(frame(4, 4, null)), null);
});

test('a wrong-shaped blob gets a low confidence', () => {
  const f = detectCard(frame(320, 240, { x: 20, y: 100, w: 280, h: 40 }));
  assert.ok(!f || f.confidence < 0.3, JSON.stringify(f));
});

test('landscape cards are rotated upright by the crop', () => {
  const box = { x: 40, y: 40, w: 176, h: 126 };
  const f = detectCard(frame(320, 240, box));
  assert.equal(f.portrait, false);
  const c = cropGray(frame(320, 240, box), f);
  assert.ok(c.height > c.width);
  assert.equal(c.gray.length, c.width * c.height);
});

test('crop and regions have the right sizes', () => {
  const img = frame(320, 240, { x: 60, y: 20, w: 126, h: 176 });
  const f = detectCard(img);
  const c = cropGray(img, f);
  assert.equal(c.width, f.w);
  const title = region(c, REGIONS.title);
  assert.ok(title.width > 100 && title.height > 10 && title.height < 25);
  assert.ok(Math.min(...title.gray) < 100, 'region covers the dark title strip');
  assert.equal(toGray(img).gray.length, 320 * 240);
});
