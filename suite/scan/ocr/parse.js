// Turn raw OCR text from a card into search clues: set code, collector number, name.
// Handles the common OCR slips (O for 0, I or l for 1) only inside number positions.
const fixDigits = (s) => s.replace(/[Oo]/g, '0').replace(/[Il|]/g, '1').replace(/S(?=\d)/g, '5');

export function parseCardText(text, game) {
  const clues = { game, setCode: undefined, number: undefined, name: undefined };
  const lines = String(text || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const joined = lines.join(' ');

  // One Piece first (OP01-016, ST01-004, EB01-001): its codes also fit the Yu-Gi-Oh! pattern when no game is chosen.
  let m = joined.match(/\b((?:OP|ST|EB|PRB)[0-9OIl]{2})-([0-9OIl]{3})\b/);
  if (m && (game === 'onepiece' || !game)) { clues.setCode = m[1].replace(/[0-9OIl]{2}$/, fixDigits); clues.number = fixDigits(m[2]); clues.game = 'onepiece'; }
  else {
    // Yu-Gi-Oh!: LOB-EN001, MRD-138 (code, optional region, digits)
    m = joined.match(/\b([A-Z0-9]{3,4})-([A-Z]{0,2}[0-9OIl]{3})\b/);
    if (m && (game === 'yugioh' || !game)) {
      clues.setCode = m[1]; clues.number = m[2].replace(/^([A-Z]*)(.*)$/, (_, a, d) => a + fixDigits(d)); clues.game = 'yugioh';
    } else {
      // Magic / Pokémon: 149/274, 004/102 (number over set size)
      m = joined.match(/\b([0-9OIl]{1,4})\s*\/\s*([0-9OIl]{2,4})\b/);
      if (m) clues.number = fixDigits(m[1]);
      // Set code: 3-5 capitals/digits next to a language tag (M11 EN, OBF EN) or a bullet.
      const s = joined.match(/\b([A-Z][A-Z0-9]{2,4})\s*[^\w\s]{0,2}\s*(?:EN|JA|DE|FR|ES|IT|PT)\b/);
      if (s) clues.setCode = s[1];
    }
  }
  // Name: the first line that looks like words (letters, spaces, punctuation), not a code line.
  const nameLine = lines.find((l) => /^[A-Za-z][A-Za-z ,'’.:!&-]{2,}$/.test(l) && !/^(EN|JA)\b/.test(l));
  if (nameLine) clues.name = nameLine.replace(/\s+/g, ' ');
  return clues;
}
