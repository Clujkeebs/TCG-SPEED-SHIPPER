import { test } from 'node:test';
import assert from 'node:assert/strict';
import { statusLines, FLAG_TEXT, LOCK_NOTE } from '../src/flags-text.js';
import { FLAG_DEFS, DEFAULT_FLAGS } from '../src/flags.js';

test('every flag has plain-words text', () => {
  for (const name of Object.keys(FLAG_DEFS)) assert.ok(FLAG_TEXT[name]?.title && FLAG_TEXT[name]?.what, name);
  assert.match(LOCK_NOTE, /locked/);
});

test('status says Locked for TCGplayer helpers while the gate is closed, even if switched on', () => {
  const on = Object.fromEntries(Object.keys(DEFAULT_FLAGS).map((k) => [k, true]));
  const lines = Object.fromEntries(statusLines(on, false).map((l) => [l.label, l.state]));
  assert.match(lines['Paste tracking'], /^Locked/);
  assert.equal(lines['Agent side panel'], 'On');
  assert.equal(statusLines(DEFAULT_FLAGS, false).find((l) => l.label === 'Agent side panel').state, 'Off');
  assert.equal(statusLines(on, true).find((l) => l.label === 'Paste tracking').state, 'On');
});
