// DEV TOOL (never run by tests against the network). Turns a provider's saved data file into compact index files.
//   node data/import/build-index.js <scryfall|pokemontcg|ygoprodeck|onepiece> <input.json> <outDir> [asOf]
// The input is a file you downloaded yourself (see docs/suite/SCAN-COVERAGE.md for sources and terms).
// Tests run this on tiny hand-written fixtures only. Whole files are read into memory: fine for one game on a laptop.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { normalizeScryfallCard } from '../providers/scryfall.js';
import { normalizePokemonCard } from '../providers/pokemontcg.js';
import { normalizeYgoCard } from '../providers/ygoprodeck.js';
import { normalizeOnePieceCard } from '../providers/onepiece.js';
import { packIndex, coverageReport } from '../compact.js';

const PROVIDERS = {
  scryfall: { game: 'mtg', source: 'scryfall', rows: (j) => (Array.isArray(j) ? j : j.data), one: (c, o) => [normalizeScryfallCard(c, o)] },
  pokemontcg: { game: 'pokemon', source: 'pokemontcg', rows: (j) => (Array.isArray(j) ? j : j.data), one: (c, o) => [normalizePokemonCard(c, o)] },
  ygoprodeck: { game: 'yugioh', source: 'ygoprodeck', rows: (j) => (Array.isArray(j) ? j : j.data), one: (c, o) => normalizeYgoCard(c, o) },
  onepiece: { game: 'onepiece', source: 'community-api', rows: (j) => (Array.isArray(j) ? j : j.data), one: (c, o) => [normalizeOnePieceCard(c, o)] },
};

// Returns { index, skipped, coverage }; bad rows are skipped and counted, never repaired by guessing.
export function importCards(provider, json, { asOf = new Date().toISOString().slice(0, 10) } = {}) {
  const p = PROVIDERS[provider];
  if (!p) throw new Error('unknown provider: ' + provider);
  const printings = []; let skipped = 0;
  for (const card of p.rows(json) || []) {
    try { printings.push(...p.one(card, { asOf })); } catch { skipped += 1; }
  }
  return { index: packIndex(printings, { game: p.game, asOf, source: p.source }), skipped, coverage: coverageReport(printings) };
}

if (import.meta.url === 'file://' + process.argv[1]) {
  const [provider, input, outDir, asOf] = process.argv.slice(2);
  if (!provider || !input || !outDir) { console.error('usage: node data/import/build-index.js <provider> <input.json> <outDir> [asOf]'); process.exit(1); }
  const r = importCards(provider, JSON.parse(readFileSync(input, 'utf8')), { asOf });
  mkdirSync(outDir, { recursive: true });
  writeFileSync(outDir + '/' + r.index.game + '.json', JSON.stringify(r.index));
  console.log(r.index.count + ' printings, ' + r.skipped + ' skipped, coverage ' + JSON.stringify(r.coverage));
}
