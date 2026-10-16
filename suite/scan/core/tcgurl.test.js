import test from 'node:test';
import assert from 'node:assert/strict';
import { productIdFromLink } from './tcgurl.js';

test('reads the number from product links (invented examples)', () => {
  const ok = [
    ['https://www.tcgplayer.com/product/123456/magic-test-set-test-bolt', 123456],
    ['https://www.tcgplayer.com/product/42/pokemon-x?Language=English&page=2', 42],
    ['https://www.tcgplayer.com/product/987654?Language=English', 987654],
    ['http://tcgplayer.com/product/5/y#reviews', 5],
    ['www.tcgplayer.com/product/777/some-card', 777],
    ['  https://shop.tcgplayer.com/product/31337/card  ', 31337],
    ['https://www.tcgplayer.com/product/55/x/', 55],
    ['https://www.tcgplayer.com/magic/product/321/some-card', 321],
    ['24680', 24680],
  ];
  for (const [text, want] of ok) assert.equal(productIdFromLink(text), want, text);
});

test('rejects anything else, never guesses', () => {
  const bad = ['', null, undefined, 'hello', '0', '-5', '12.5',
    'https://example.com/product/123456/x', 'https://tcgplayer.com.evil.example/product/123/x',
    'https://www.tcgplayer.com/search/all/product?q=bolt', 'https://www.tcgplayer.com/product/abc/x',
    'https://www.tcgplayer.com/product/1234567890123/x', 'https://www.tcgplayer.com/product/'];
  for (const text of bad) assert.equal(productIdFromLink(text), null, String(text));
});
