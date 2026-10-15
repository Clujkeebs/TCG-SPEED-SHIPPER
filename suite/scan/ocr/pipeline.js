// Frame -> card? -> crop -> read text -> clues -> candidates -> decision.
// The text reader is an injected engine: { recognize(grayImage) -> Promise<string> }. No engine is bundled yet
// (see docs/suite/SCAN-EVAL.md), so tests use a fake one and the app falls back to typing.
import { detectCard, cropGray, region, REGIONS } from '../vision/detect.js';
import { parseCardText } from './parse.js';
import { resolveClues } from './resolve.js';
import { decide } from '../core/rapid.js';

export async function identifyFrame(frame, { engine, index, game, now = () => Date.now(), thresholds } = {}) {
  const t0 = now();
  const box = detectCard(frame);
  if (!box || box.confidence < 0.3) return { ok: false, reason: 'no-card', box, ms: now() - t0 };
  const card = cropGray(frame, box);
  const parts = [];
  for (const key of ['title', 'bottom']) parts.push(await engine.recognize(region(card, REGIONS[key]), { region: key }));
  const text = parts.join('\n');
  const clues = parseCardText(text, game);
  const candidates = resolveClues(clues, index);
  return { ok: true, box, text, clues, candidates, decision: decide(candidates, thresholds), ms: now() - t0 };
}

// Same, starting from text that was read already (used by the evaluation harness).
export function identifyText(text, { index, game, thresholds }) {
  const clues = parseCardText(text, game);
  const candidates = resolveClues(clues, index);
  return { clues, candidates, decision: decide(candidates, thresholds) };
}
