# vendor/ : third-party files kept in the repo on purpose

Self-hosted so the app works offline and loads nothing from other sites. Approved by the Builder (log, 2026-10-15).
Nothing here is edited. To update, replace the files and change this note.

| File | From | Version | Licence | SHA-256 (first 16) |
|---|---|---|---|---|
| `tesseract/tesseract.min.js`, `tesseract/worker.min.js` | npm `tesseract.js` | 5.1.1 | Apache-2.0 (`LICENSE-tesseract.js.md`, `*.LICENSE.txt`) | a8e29918d098b2b0, aca1229639fc9907 |
| `tesseract/core/tesseract-core-simd-lstm.wasm.js`, `tesseract/core/tesseract-core-lstm.wasm.js` (WebAssembly inside; the SIMD one is used when the browser supports it) | npm `tesseract.js-core` | 5.1.1 | Apache-2.0 (`LICENSE-tesseract.js-core.txt`) | ce20eda9533cbed1, 8f04aa0cc81e7bde |
| `tesseract/lang/eng.traineddata.gz` (English model, "best" quality, integer) | npm `@tesseract.js-data/eng` `4.0.0_best_int` (package 1.0.0) | tessdata_best | Apache-2.0 per the Tesseract tessdata_best project; **confirm** before launch | 45b4cb346724ac17 |

About 11 MB in total. The browser downloads them only when the camera or a photo is first used, then keeps them for
offline use. Fetched from npm on 2026-10-15; no code from other sources, no network calls at run time.
