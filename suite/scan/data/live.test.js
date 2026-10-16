import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createLiveLookup, liveUrls } from './live.js';
import { createIndex } from './index.js';
import { createMemoryStore } from '../core/session.js';

const read = (p) => JSON.parse(readFileSync(new URL('./fixtures/' + p, import.meta.url), 'utf8'));
const noSleep = async () => {};

function setup(routes, store = createMemoryStore()) {
  const calls = [];
  const fetchJson = async (url) => { calls.push(url); for (const [k, v] of Object.entries(routes)) if (url.includes(k)) { if (v instanceof Error) throw v; return v; } throw new Error('404'); };
  const index = createIndex([]);
  return { live: createLiveLookup({ fetchJson, index, store, sleep: noSleep, minGapMs: 0 }), index, calls, store };
}

test('urls: exact set+number for Magic, name searches for the others, nothing for empty or unsupported', () => {
  assert.deepEqual(liveUrls('mtg', { setCode: 'M11', number: '0149' }), ['https://api.scryfall.com/cards/m11/149']);
  assert.equal(liveUrls('mtg', { setCode: 'M11', number: '149', name: 'bolt' }).length, 2);
  assert.match(liveUrls('mtg', { name: 'Lightning Bolt!' })[0], /q=lightning%20bolt$/);
  assert.match(liveUrls('pokemon', { name: 'Charizard ex', number: '004' })[0], /q=name:charizard\*%20number:4$/);
  assert.match(liveUrls('yugioh', { name: 'Dark Magician' })[0], /fname=dark%20magician$/);
  assert.deepEqual(liveUrls('mtg', {}), []);
  assert.deepEqual(liveUrls('onepiece', { name: 'Nami' }), []);
});

test('finds cards online, adds them to the index, keeps product ids and prices', async () => {
  const { live, index } = setup({ 'cards/search': read('scryfall-search.json') });
  const r = await live.find('mtg', { name: 'test bolt' });
  assert.equal(r.printings.length, 2); assert.deepEqual(r.errors, []);
  assert.equal(index.search('test bolt').length, 2);
  assert.equal(index.findBySetNumber('TSA', '10', 'mtg')[0].tcgplayerProductId, 910001);
  assert.equal(index.findBySetNumber('TSB', '77', 'mtg')[0].prices.byFinish.nonfoil.market, 200);
  assert.equal(live.cachedCount(), 2);
});

test('a single card by set and number', async () => {
  const { live } = setup({ 'cards/tst/149': read('scryfall-card.json') });
  const r = await live.find('mtg', { setCode: 'TST', number: '149' });
  assert.equal(r.printings[0].tcgplayerProductId, 900001);
});

test('what was found is remembered on the device and works offline next time', async () => {
  const store = createMemoryStore();
  const a = setup({ 'cards/search': read('scryfall-search.json') }, store);
  await a.live.find('mtg', { name: 'test bolt' });
  const b = setup({}, store); // new session, no network at all
  await b.live.ready;
  assert.equal(b.index.search('test bolt').length, 2);
});

test('no results (404) is quiet; real failures give a plain message; switched off does nothing', async () => {
  const none = setup({});
  assert.deepEqual(await none.live.find('mtg', { name: 'zzzz' }), { printings: [], errors: [] });
  const down = setup({ 'scryfall': new Error('Failed to fetch') });
  const r = await down.live.find('mtg', { name: 'bolt' });
  assert.match(r.errors[0], /Could not reach the Scryfall lookup/);
  const off = setup({ 'scryfall': read('scryfall-search.json') }); off.live.enabled = false;
  assert.equal((await off.live.find('mtg', { name: 'bolt' })).printings.length, 0);
  assert.equal(off.calls.length, 0);
});

test('findAny asks every supported game when none is chosen, one when it is', async () => {
  const s = setup({ 'ygoprodeck': { data: [read('ygoprodeck-card.json')] } });
  const all = await s.live.findAny('', { name: 'test dragon' });
  assert.equal(s.calls.length, 3);
  assert.equal(all.printings.length, 2);
  const one = setup({}); await one.live.findAny('pokemon', { name: 'x' });
  assert.equal(one.calls.length, 1);
  assert.deepEqual((await one.live.findAny('onepiece', { name: 'x' })).printings, []);
});

test('requests are spaced out', async () => {
  let t = 0; const waits = [];
  const live = createLiveLookup({ fetchJson: async () => ({ object: 'list', data: [] }), index: createIndex([]), now: () => t, sleep: async (ms) => { waits.push(ms); t += ms; }, minGapMs: 100 });
  await live.find('mtg', { name: 'a' }); await live.find('mtg', { name: 'b' });
  assert.deepEqual(waits, [100]); // the first goes at once, the second waits
});

test('the cache is capped, oldest first', async () => {
  const store = createMemoryStore();
  const index = createIndex([]);
  const live = createLiveLookup({ fetchJson: async () => read('scryfall-search.json'), index, store, sleep: noSleep, minGapMs: 0, maxCached: 1 });
  await live.find('mtg', { name: 'x' });
  assert.equal(live.cachedCount(), 1);
});
