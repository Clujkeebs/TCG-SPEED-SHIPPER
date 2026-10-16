// Build the search index from the sample list plus any per-game index files that exist (data/index/<game>.json).
// fetchJson(url) is injected: fetch in the browser, readFile in Node. A missing game file is not an error.
import { createIndex } from './index.js';
import { unpackIndex } from './compact.js';

export async function loadIndex(fetchJson, { base = '', games = ['mtg', 'pokemon', 'yugioh', 'onepiece'], useSample = true } = {}) {
  const index = createIndex(useSample ? await fetchJson(base + 'sample/printings.json') : []);
  const loaded = [];
  for (const g of games) {
    let file;
    try { file = await fetchJson(base + 'index/' + g + '.json'); } catch { continue; }
    if (!file) continue;
    for (const p of unpackIndex(file)) { try { index.add(p); } catch { /* skip a bad row */ } }
    loaded.push(g);
  }
  return { index, loaded };
}
