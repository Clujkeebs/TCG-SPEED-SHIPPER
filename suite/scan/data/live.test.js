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

test('prices carry the time they were fetched; a refetch replaces an older price', async () => {
  let t = Date.parse('2026-10-15T10:00:00Z');
  let usd = '0.40';
  const index = createIndex([]);
  const fetchJson = async () => ({ object: 'list', data: [{ ...read('scryfall-search.json').data[0], prices: { usd } }] });
  const live = createLiveLookup({ fetchJson, index, store: createMemoryStore(), sleep: noSleep, minGapMs: 0, now: () => t });
  await live.find('mtg', { name: 'x' });
  const first = index.search('test bolt')[0];
  assert.equal(first.prices.asOf, '2026-10-15T10:00:00.000Z');
  assert.equal(first.prices.byFinish.nonfoil.market, 40);
  t = Date.parse('2026-10-16T12:00:00Z'); usd = '0.55';
  const fresh = await live.refresh(first);
  assert.equal(fresh.prices.byFinish.nonfoil.market, 55);
  assert.equal(index.get(first.id).prices.byFinish.nonfoil.market, 55);
  assert.equal(index.search('test bolt').length, 1); // replaced, not duplicated
});

test('the last lookup is recorded with service, address, count and the exact error', async () => {
  const ok = setup({ 'cards/search': read('scryfall-search.json') });
  await ok.live.find('mtg', { name: 'test bolt' });
  assert.equal(ok.live.lastLookup.service, 'Scryfall');
  assert.equal(ok.live.lastLookup.count, 2);
  assert.equal(ok.live.lastLookup.error, '');
  assert.match(ok.live.lastLookup.url, /api\.scryfall\.com/);
  const down = setup({ 'pokemontcg': new Error('Failed to fetch') });
  await down.live.find('pokemon', { name: 'charizard' });
  assert.equal(down.live.lastLookup.error, 'Failed to fetch');
  assert.equal(down.live.lastLookup.service, 'Pokémon TCG API');
  const nf = setup({}); await nf.live.find('mtg', { name: 'zzz' });
  assert.equal(nf.live.lastLookup.error, ''); // "not found" is not an error
});

test('after asking several services, the last lookup is the one that failed or found cards', async () => {
  const s = setup({ 'scryfall': read('scryfall-search.json') });
  await s.live.findAny('', { name: 'test bolt' });
  assert.equal(s.live.lastLookup.service, 'Scryfall');
  assert.equal(s.live.lastLookup.count, 2);
});

test('One Piece lookup is OFF by default: no request, no cards, even when asked for directly', async () => {
  const s = setup({ 'optcgapi': read('onepiece-optcgapi-ASSUMED.json') });
  assert.deepEqual(liveUrls('onepiece', { setCode: 'OP01', number: '016' }), []); // the real flag stays false
  assert.equal((await s.live.findAny('onepiece', { setCode: 'OP01', number: '016' })).printings.length, 0);
  assert.equal((await s.live.findAny('', { name: 'nami' })).printings.length, 0);
  assert.equal(s.calls.some((u) => u.includes('optcgapi')), false);
});

test('One Piece lookup, flag ON (test only), against the clearly ASSUMED fixture', async () => {
  const flags = { onePieceLive: true };
  assert.deepEqual(liveUrls('onepiece', { setCode: 'op01', number: '16' }, flags), ['https://optcgapi.com/api/sets/card/OP01-016/']);
  assert.deepEqual(liveUrls('onepiece', { name: 'nami' }, flags), []); // no name search is known
  const calls = []; const index = createIndex([]);
  const live = createLiveLookup({ flags, fetchJson: async (u) => { calls.push(u); return read('onepiece-optcgapi-ASSUMED.json'); }, index, store: createMemoryStore(), sleep: noSleep, minGapMs: 0 });
  const r = await live.findAny('onepiece', { setCode: 'OP01', number: '016' });
  assert.equal(r.printings.length, 2);
  assert.equal(r.printings.every((p) => p.game === 'onepiece' && !('tcgplayerProductId' in p)), true);
  assert.equal(live.lastLookup.service, 'optcgapi.com');
  assert.deepEqual(calls, ['https://optcgapi.com/api/sets/card/OP01-016/']);
  const fixture = read('onepiece-optcgapi-ASSUMED.json');
  assert.ok(fixture.every((row) => /NOT A REAL RESPONSE/.test(row._ASSUMED))); // the fixture says what it is
});
