# Speed Scan: reading cards (S1 evaluation)

Status 2026-10-15. **No accuracy number on real cards exists yet.** Nothing below is a claim about real photos.

## What is built (all offline, tested)
| Step | Code | State |
|---|---|---|
| Camera | `public/camera.js` (`getUserMedia`, frames stay on the device) | Starts and captures in a headless browser with a fake camera. Not tried on a real phone. |
| Find and crop the card | `vision/detect.js` | Works on synthetic frames (plain background, noise). Straight-on boxes only, no perspective fix. Unknown on real photos. |
| Read text | `ocr/pipeline.js` takes any engine with `recognize(image)` | **No engine bundled.** The app says so and falls back to search. |
| Text to clues | `ocr/parse.js` (set code, number, name; fixes O/0 and I/1 slips in numbers) | Unit-tested on typed examples for four games. |
| Clues to cards | `ocr/resolve.js` over the offline index | See simulated numbers below. |
| Accept or ask | `core/rapid.js`: auto-accept only if the top score is 0.9+ and 0.15 ahead; otherwise show 3 choices to tap | Tested. Name-only and number+name matches never auto-accept. |

## Measured: card finding on rendered synthetic cards
`eval/render-synthetic.cjs` draws cards on a canvas in headless Chromium (random size, position, tilt, background
brightness, noise; flat cards with two text-like bars, no glare, no clutter), runs `detectCard`, and counts a hit when
the box overlaps the true one by 90% or more. 100 frames per row, 640×480, on this sandbox's CPU:

| Largest random tilt | Found correctly | Mean time per frame |
|---|---|---|
| 0° | 100/100 | 3.4 ms |
| 2° | 100/100 | 2.3 ms |
| 5° | 100/100 | 2.5 ms |
| 10° | 95/100 | 2.3 ms |

This only shows the finder is sound on clean synthetic frames. It says nothing about real photos or a phone's speed.

## The text-reading engine: not chosen, and why
iOS Safari has no text-detection API, so reading must run in WebAssembly. First candidate is a self-hosted
Tesseract.js build. It is a vendored file of several MB plus language data, and needs its licence checked, so I did
not add it without the Builder's say-so (see the log, "Needs Builder"). Image embeddings are the planned fallback for
telling reprints apart. Neither was run, so there is **no speed or accuracy figure for either.**

## Simulated results (lookup only, NOT real OCR accuracy)
`node scan/eval/run-simulated.js` (from `suite/`) builds the text a perfect reader would see for each of the 96
sample cards, damages some characters at random, and checks the lookup. It tests how forgiving the lookup is on a
tiny index. Real cards, glare and sleeves will do worse. 5 random seeds per row, 480 cards each:

| Characters damaged | Right card first | In top 3 | Auto-accepted | Auto-accepted but wrong |
|---|---|---|---|---|
| 0% | 100% | 100% | 71.9% | 0 |
| 2% | 99.4% | 100% | 59.4% | 0 |
| 5% | 98.3% | 99% | 47.9% | 0 |
| 10% | 93.5% | 95.6% | 29.4% | 0 |

Lookup time is about 0.1 ms per card on this index (real reading will be far slower).
Pokémon sets are matched by number and name because the printed set code differs from the provider's code.

## What the owner must supply (board task S5)
About 50 phone photos of real cards: mixed games (Magic, Pokémon, Yu-Gi-Oh!, One Piece), normal room light, a few in
sleeves, a few foils, taken the way a seller would (flat on a table, card filling most of the picture). Name each file
with what the card is, for example `mtg-m11-149.jpg`, or send a list.

## Next steps to a real number
1. Builder approves vendoring a WebAssembly OCR build (name, size, licence).
2. Run the harness on the photos: top-1, top-3, auto-accept error rate, median seconds per card, on a named phone.
3. Targets from the plan: 95% top-1, 98% top-3, median under 3 s. Report plainly if missed.
