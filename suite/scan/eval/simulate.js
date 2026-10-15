// SIMULATED reading errors. Builds the text a perfect reader would see on a card, then damages it at a given
// rate. This measures how forgiving the lookup is. It says NOTHING about real OCR accuracy on photos.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const CONFUSE = { 0: 'O', 1: 'I', 5: 'S', O: '0', I: '1', S: '5', l: '1' };

function damage(s, rate, rand, { keepDigits = false } = {}) {
  let out = '';
  for (const ch of s) {
    if (rand() >= rate || ch === ' ' || ch === '\n') { out += ch; continue; }
    const r = rand();
    if (/\d/.test(ch) && keepDigits) out += ch;
    else if (CONFUSE[ch] && r < 0.5) out += CONFUSE[ch];
    else if (r < 0.75) out += ''; // dropped
    else out += String.fromCharCode(97 + Math.floor(rand() * 26));
  }
  return out;
}

// What a perfect reader would see, per game. Pokémon prints a set code that does not match the provider's,
// so it is left out (the lookup must rely on number + name there).
export function printedText(p) {
  const number = String(p.number);
  switch (p.game) {
    case 'mtg': return p.name + '\n' + number.padStart(3, '0') + '/274 R\n' + p.setCode + ' • EN';
    case 'pokemon': return p.name + '\n' + number.padStart(3, '0') + '/102';
    case 'yugioh': return p.name + '\n' + p.setCode + '-' + number;
    case 'onepiece': return p.name + '\n' + p.setCode + '-' + number;
    default: return p.name;
  }
}

export function simulateCases(printings, { seed = 1, rate = 0.03 } = {}) {
  const rand = mulberry32(seed);
  return printings.map((p, i) => ({
    id: 'sim-' + i, game: p.game, expected: p.id,
    text: rate === 0 ? printedText(p) : damage(printedText(p), rate, rand),
  }));
}
