// Look cards up online from the seller's own browser, so ANY card can be found, not just the sample list.
// Free public APIs, no keys: Scryfall (Magic), Pokémon TCG API, YGOPRODeck (Yu-Gi-Oh!). One Piece has no source yet.
// What the seller types goes to those services; the app says so on screen. Found cards are added to the index and
// remembered on the device (offline next time). Requests are spaced out to stay polite.
// UNVERIFIED against the live services (the build sandbox cannot reach them): tests use fixtures with fake fetch.
import { normalizeScryfallCard } from './providers/scryfall.js';
import { normalizePokemonCard } from './providers/pokemontcg.js';
import { normalizeYgoCard } from './providers/ygoprodeck.js';
import { normalizeOnePieceCard } from './providers/onepiece.js';
import { FLAGS } from './flags.js';

export const LIVE_GAMES = ['mtg', 'pokemon', 'yugioh'];
const enc = encodeURIComponent;
const words = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9' -]+/g, ' ').trim().split(/\s+/).filter(Boolean);

export function liveUrls(game, { name, setCode, number } = {}, flags = FLAGS) {
  const n = words(name).join(' ');
  if (game === 'mtg') {
    const urls = [];
    if (setCode && number) urls.push('https://api.scryfall.com/cards/' + enc(String(setCode).toLowerCase()) + '/' + enc(String(number).replace(/^0+(?=\d)/, '')));
    if (n) urls.push('https://api.scryfall.com/cards/search?unique=prints&order=released&q=' + enc(n));
    return urls;
  }
  if (game === 'pokemon') {
    const parts = [];
    const first = words(name)[0];
    if (first) parts.push('name:' + enc(first) + '*');
    if (number && /^\d+$/.test(String(number).replace(/^0+(?=\d)/, ''))) parts.push('number:' + String(number).replace(/^0+(?=\d)/, ''));
    return parts.length ? ['https://api.pokemontcg.io/v2/cards?pageSize=24&q=' + parts.join('%20')] : [];
  }
  if (game === 'yugioh') return n ? ['https://db.ygoprodeck.com/api/v7/cardinfo.php?fname=' + enc(n)] : [];
  // One Piece: OFF unless the flag is on. The endpoint is as found by search and UNVERIFIED; there is no known name search.
  if (game === 'onepiece' && flags.onePieceLive && setCode && number) return ['https://optcgapi.com/api/sets/card/' + enc(String(setCode).toUpperCase()) + '-' + enc(String(number).padStart(3, '0')) + '/'];
  return [];
}

function parse(game, json, asOf) {
  if (!json) return [];
  if (game === 'mtg') return (json.object === 'list' ? json.data : json.object === 'card' ? [json] : []).map((c) => normalizeScryfallCard(c, { asOf }));
  if (game === 'pokemon') return (json.data || []).map((c) => normalizePokemonCard(c, { asOf }));
  if (game === 'yugioh') return (json.data || []).flatMap((c) => normalizeYgoCard(c, { asOf }));
  if (game === 'onepiece') { // ASSUMED shape: a list of card rows (or one row); bad rows are skipped, never repaired
    const rows = Array.isArray(json) ? json : [json];
    return rows.flatMap((r) => { try { return [normalizeOnePieceCard(r, { asOf })]; } catch { return []; } });
  }
  return [];
}

// fetchJson(url) -> parsed JSON, or throws. store: { load(), save(state) } for the on-device cache. index: createIndex() result.
const SERVICE = { mtg: 'Scryfall', pokemon: 'Pokémon TCG API', yugioh: 'YGOPRODeck', onepiece: 'optcgapi.com' };

export function createLiveLookup({ flags = FLAGS, fetchJson, index, store, minGapMs = 120, maxCached = 5000, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), now = () => Date.now() }) {
  let lastLookup = null; let cache = {}; let last = -Infinity; let chain = Promise.resolve(); let enabled = true;
  const ready = (async () => {
    try { cache = (store && (await store.load())) || {}; } catch { cache = {}; }
    for (const p of Object.values(cache)) { try { index.add(p); } catch { /* skip a bad cached row */ } }
  })();

  function polite(fn) { // one request at a time, spaced out
    const run = chain.then(async () => { const wait = last + minGapMs - now(); if (wait > 0) await sleep(wait); last = now(); return fn(); });
    chain = run.catch(() => {});
    return run;
  }
  async function remember(printings) {
    let added = 0;
    for (const p of printings) {
      const old = cache[p.id];
      const fresher = !old || (p.prices && (!old.prices || Date.parse(p.prices.asOf) > Date.parse(old.prices.asOf)));
      try { index.add(p, { replace: Boolean(fresher) }); } catch { continue; }
      if (fresher) { cache[p.id] = p; added += 1; }
    }
    const ids = Object.keys(cache);
    for (const id of ids.slice(0, Math.max(0, ids.length - maxCached))) delete cache[id]; // oldest first
    if (added && store) { try { await store.save(cache); } catch { /* cache is a convenience */ } }
  }

  return {
    ready,
    get enabled() { return enabled; },
    set enabled(v) { enabled = Boolean(v); },
    // Returns { printings, errors } where errors are plain-language strings. Never throws.
    async find(game, clue) {
      await ready;
      const out = []; const errors = [];
      if (!enabled) return { printings: out, errors };
      const rec = { at: new Date(now()).toISOString(), game, kind: clue.kind || 'search', query: [clue.name, clue.setCode, clue.number].filter(Boolean).join(' '), service: SERVICE[game], url: '', count: 0, error: '' };
      for (const url of liveUrls(game, clue, flags)) {
        rec.url = url;
        try {
          const json = await polite(() => fetchJson(url));
          out.push(...parse(game, json, new Date(now()).toISOString()));
        } catch (e) {
          const msg = e && e.message ? e.message : 'offline';
          if (!/^(404|400)$/.test(msg)) { errors.push('Could not reach the ' + SERVICE[game] + ' lookup (' + msg + ').'); rec.error = msg; }
        }
      }
      rec.count = out.length;
      lastLookup = rec;
      await remember(out);
      return { printings: out, errors };
    },
    // Several games at once (or the chosen one). Same result shape.
    async findAny(game, clue) {
      const allowed = flags.onePieceLive ? [...LIVE_GAMES, 'onepiece'] : LIVE_GAMES;
      const games = game ? (allowed.includes(game) ? [game] : []) : allowed;
      const printings = []; const errors = [];
      const recs = [];
      for (const g of games) { const r = await this.find(g, clue); printings.push(...r.printings); errors.push(...r.errors); if (lastLookup) recs.push(lastLookup); }
      // Several services were asked: keep the most telling record (a failure first, then one that found cards).
      if (recs.length) lastLookup = recs.find((x) => x.error) || recs.find((x) => x.count > 0) || recs[recs.length - 1];
      return { printings, errors: [...new Set(errors)] };
    },
    cachedCount: () => Object.keys(cache).length,
    // The facts of the most recent online lookup (for the "last lookup" line and the problem report).
    get lastLookup() { return lastLookup; },
    // Ask again for one printing so its price is current. Returns the fresh printing, or null if it could not be had.
    async refresh(printing) {
      const r = await this.find(printing.game, { setCode: printing.setCode, number: printing.number, name: printing.name, kind: 'price refresh' });
      return r.printings.find((p) => p.id === printing.id) || null;
    },
    // The facts of the most recent online lookup (for the "last lookup" line and the problem report).
    get lastLookup() { return lastLookup; },
    // Ask again for one printing so its price is current. Returns the fresh printing, or null if it could not be had.
    async refresh(printing) {
      const r = await this.find(printing.game, { setCode: printing.setCode, number: printing.number, name: printing.name, kind: 'price refresh' });
      return r.printings.find((p) => p.id === printing.id) || null;
    },
  };
}
