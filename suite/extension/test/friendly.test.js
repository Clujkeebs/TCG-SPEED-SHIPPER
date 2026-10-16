import { test } from 'node:test';
import assert from 'node:assert/strict';
import { plainError, GENERAL } from '../src/agent/friendly.js';

test('known technical messages become plain sentences', () => {
  assert.match(plainError('the agent is already working on something'), /still working/);
  assert.match(plainError('the kill switch is on; send agent.resume first'), /Resume/);
  assert.match(plainError('no such approval waiting'), /no longer waiting/);
  assert.match(plainError('agent.ask: text is too long (limit 2000)'), /2,000/);
  assert.match(plainError('sender not trusted'), /reopen/);
});

test('code-looking or empty text never reaches the seller', () => {
  for (const bad of ['TypeError: x is not a function', '{"error":1}', 'agent.memory.forget: id is required', 'ECONNRESET', '', undefined, null, '<b>x</b>', 'a'.repeat(300)]) {
    assert.equal(plainError(bad), GENERAL, String(bad));
  }
});

test('a short human sentence is kept', () => {
  assert.equal(plainError('Okay, I did not change anything.'), 'Okay, I did not change anything.');
});
