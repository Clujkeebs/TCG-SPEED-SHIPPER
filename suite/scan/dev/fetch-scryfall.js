// DEV SCRIPT, not used by the app or the tests. Fetches one set from Scryfall into data/cache/ (git-ignored).
// Usage: node dev/fetch-scryfall.js m11
// Polite: sends a User-Agent and Accept header, waits 120 ms between pages, caches to disk and
// never refetches a cached page. Check Scryfall's current API terms before using the data.
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { normalizeScryfallCard } from '../data/providers/scryfall.js';

const set = (process.argv[2] || '').toLowerCase();
if (!/^[a-z0-9]{2,6}$/.test(set)) { console.error('usage: node dev/fetch-scryfall.js <setcode>'); process.exit(1); }
const dir = fileURLToPath(new URL('../data/cache/', import.meta.url));
mkdirSync(dir, { recursive: true });
const headers = { 'User-Agent': 'TCGSpeedScan-dev/0.1', Accept: 'application/json' };
let url = 'https://api.scryfall.com/cards/search?q=' + encodeURIComponent('set:' + set) + '&unique=prints';
const printings = [];
for (let page = 1; url; page += 1) {
  const file = dir + 'scryfall-' + set + '-' + page + '.json';
  let body;
  if (existsSync(file)) body = JSON.parse(readFileSync(file, 'utf8'));
  else {
    await new Promise((r) => setTimeout(r, 120));
    const res = await fetch(url, { headers });
    if (!res.ok) { console.error('Scryfall said', res.status); process.exit(1); }
    body = await res.json();
    writeFileSync(file, JSON.stringify(body));
  }
  for (const c of body.data) printings.push(normalizeScryfallCard(c));
  url = body.has_more ? body.next_page : null;
}
writeFileSync(dir + 'printings-' + set + '.json', JSON.stringify(printings));
console.log('wrote', printings.length, 'printings to data/cache/printings-' + set + '.json');
