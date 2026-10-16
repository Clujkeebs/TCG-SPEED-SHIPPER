import test from 'node:test';
import assert from 'node:assert/strict';
import { buildReport, describeLast } from './report.js';

const last = { game: 'pokemon', kind: 'search', query: 'charizard ex 125', service: 'Pokémon TCG API', url: 'https://api.pokemontcg.io/v2/cards?q=name:charizard*', count: 0, error: 'Failed to fetch' };

test('report has the facts and nothing else', () => {
  const t = buildReport({ last, version: 'v1', userAgent: 'Mozilla/5.0 (iPad)', now: () => '2026-10-16T05:00:00Z', online: true });
  for (const part of ['time: 2026-10-16T05:00:00Z', 'app: v1', 'online: yes', 'browser: Mozilla/5.0 (iPad)', 'game: pokemon', 'typed or read: charizard ex 125', 'service: Pokémon TCG API', 'error text: Failed to fetch', 'cards found: 0']) assert.ok(t.includes(part), part);
  assert.doesNotMatch(t, /photo|image data|data:image/i);
});

test('no lookup yet, missing fields, long text is cut', () => {
  assert.match(buildReport({ version: 'v' }), /last lookup: none yet/);
  const t = buildReport({ last: { query: 'x'.repeat(2000), error: 'e'.repeat(2000) }, now: () => 't' });
  assert.ok(t.length < 1500);
  assert.match(t, /service: none/);
});

test('describeLast', () => {
  assert.match(describeLast(null), /none yet/);
  assert.match(describeLast(last), /failed: Failed to fetch/);
  assert.match(describeLast({ query: 'bolt', service: 'Scryfall', count: 3 }), /3 found/);
});
