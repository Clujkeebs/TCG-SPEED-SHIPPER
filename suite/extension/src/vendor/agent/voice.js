// Voice profile: the seller pastes 3 to 5 of their own past replies and gets an EDITABLE style card
// (greeting, sign-off, length, formality, exclamation, emoji). Drafts follow the card.
// Privacy: only whitelisted words and settings are kept. Nothing from the samples is stored: no names, order numbers,
// tracking numbers or sentences. The card is saved in shop memory (key voice.card) where the seller can see, edit
// and delete it.
export const VOICE_KEY = 'voice.card';
export const GREETINGS = ['Hi', 'Hey', 'Hello', 'Hiya', 'Howdy', 'Dear', 'Greetings', 'Good morning', 'Good afternoon', 'Good evening'];
export const SIGN_OFFS = ['Thanks', 'Thank you', 'Cheers', 'Best', 'Best regards', 'Kind regards', 'Regards', 'Sincerely', 'Take care', 'Talk soon', 'Warmly', 'Appreciate it', 'Many thanks', 'Thanks again'];
export const LENGTHS = ['short', 'medium', 'long'];
export const FORMALITY = ['casual', 'neutral', 'formal'];
export const DEFAULT_CARD = { version: 1, greeting: 'Hi', signOff: 'Thanks,', length: 'medium', formality: 'neutral', exclamation: false, emoji: false };

const alt = (list) => list.map((x) => x.replace(/ /g, '\\s+')).sort((a, b) => b.length - a.length).join('|');
const GREET_RE = new RegExp(`^\\s*(${alt(GREETINGS)})\\b`, 'i');
const SIGN_RE = new RegExp(`^\\s*(${alt(SIGN_OFFS)})\\s*([,.!]?)\\s*$`, 'i');
const EMOJI_RE = /\p{Extended_Pictographic}/u;
const cap = (w) => w.replace(/\s+/g, ' ').toLowerCase().replace(/^./, (c) => c.toUpperCase());
const canon = (list, w) => list.find((x) => x.toLowerCase() === w.replace(/\s+/g, ' ').toLowerCase());

export function validateVoiceCard(c) {
  const e = [];
  if (!c || typeof c !== 'object') return { ok: false, errors: ['a style card is an object'] };
  if (c.greeting !== '' && !GREETINGS.includes(c.greeting)) e.push('greeting must be one of ' + GREETINGS.join(', ') + ' (or empty)');
  const m = /^(.+?)([,.!])$/.exec(String(c.signOff || ''));
  if (!m || !SIGN_OFFS.includes(m[1])) e.push('signOff must be one of ' + SIGN_OFFS.join(', ') + ' followed by , . or !');
  if (!LENGTHS.includes(c.length)) e.push('length must be one of ' + LENGTHS.join(', '));
  if (!FORMALITY.includes(c.formality)) e.push('formality must be one of ' + FORMALITY.join(', '));
  if (typeof c.exclamation !== 'boolean') e.push('exclamation must be true or false');
  if (typeof c.emoji !== 'boolean') e.push('emoji must be true or false');
  return { ok: e.length === 0, errors: e };
}

const mostCommon = (arr, fallback) => {
  const n = new Map();
  for (const x of arr) n.set(x, (n.get(x) || 0) + 1);
  return [...n.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])))[0]?.[0] ?? fallback;
};

export function deriveVoiceCard(samples) {
  if (!Array.isArray(samples) || samples.length < 3 || samples.length > 5) throw new Error('paste 3 to 5 of your own past replies');
  for (const s of samples) if (typeof s !== 'string' || s.trim().length < 20 || s.length > 4000) throw new Error('each reply needs at least 20 characters (and at most 4,000)');
  const greetings = [], signOffs = [], wordCounts = [], formalScores = [], bangShare = [];
  let emoji = false;
  for (const raw of samples) {
    const lines = raw.replace(/\r/g, '').split('\n').map((l) => l.trim()).filter(Boolean);
    const g = GREET_RE.exec(lines[0] || '');
    if (g) {
      greetings.push(canon(GREETINGS, g[1]) || cap(g[1]));
      // drop the greeting and a name that follows it ("Hey Sarah! ", "Dear Mr. Okafor,"); anything else on that line is body text
      const rest = lines[0].replace(GREET_RE, '').replace(/^[ ,]*(?:[A-Za-z][\w.'-]*(?:\s[A-Z][\w.'-]*)?)?[,!:]\s*/, '').trim();
      if (rest) lines[0] = rest; else lines.shift();
    }
    let so = null;
    for (let i = lines.length - 1; i >= Math.max(0, lines.length - 3); i -= 1) { const m = SIGN_RE.exec(lines[i]); if (m) { so = { word: canon(SIGN_OFFS, m[1]), punct: m[2] || ',' }; lines.splice(i); break; } }
    if (so && so.word) signOffs.push(so.word + so.punct);
    const body = lines.join(' ');
    wordCounts.push(body.split(/\s+/).filter(Boolean).length);
    const sentences = body.split(/(?<=[.!?])\s+/).filter(Boolean);
    bangShare.push(sentences.length ? sentences.filter((s) => s.endsWith('!')).length / sentences.length : 0);
    if (EMOJI_RE.test(raw)) emoji = true;
    const t = body.toLowerCase();
    const contractions = (t.match(/\b\w+'(t|m|re|ve|ll|d|s)\b/g) || []).length;
    const formal = (t.match(/\b(please|kindly|apologi[sz]e|regret|sincerely|assist|advise|further|regards|unfortunately)\b/g) || []).length + (/^dear\b/i.test(raw.trim()) ? 2 : 0) + (/sincerely|kind regards|best regards/i.test(raw) ? 1 : 0);
    const casual = contractions + (t.match(/\b(hey|yeah|yep|gonna|awesome|cool|thx|ya|sorry about that|no worries|totally)\b/g) || []).length + (t.match(/!/g) || []).length * 0.5 + (EMOJI_RE.test(raw) ? 2 : 0) + (/^hey\b/i.test(raw.trim()) ? 1 : 0);
    formalScores.push(formal - casual);
  }
  const avg = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  const words = avg(wordCounts);
  const score = avg(formalScores);
  const card = {
    version: 1,
    greeting: mostCommon(greetings, greetings.length === 0 ? '' : 'Hi'),
    signOff: mostCommon(signOffs, 'Thanks,'),
    length: words < 35 ? 'short' : words <= 80 ? 'medium' : 'long',
    formality: score >= 2 ? 'formal' : score <= -2 ? 'casual' : 'neutral',
    exclamation: avg(bangShare) >= 0.25,
    emoji,
  };
  const v = validateVoiceCard(card);
  if (!v.ok) throw new Error('could not read a style from those replies: ' + v.errors.join('; '));
  return card;
}

export const describeVoice = (c) => `My reply style: greet with "${c.greeting || '(just the name)'}", sign off "${c.signOff}", ${c.length} replies, ${c.formality}${c.exclamation ? ', with exclamation marks' : ''}${c.emoji ? ', with an emoji now and then' : ''}.`;

export function voiceFromMemory(memory) {
  if (!memory) return null;
  const raw = memory.get(VOICE_KEY);
  if (typeof raw !== 'string') return null;
  try { const c = JSON.parse(raw); return validateVoiceCard(c).ok ? c : null; } catch { return null; }
}

// Edits the seller makes to the card (partial). Returns the new valid card or throws.
export function editVoiceCard(card, patch) {
  const next = { ...card, ...patch, version: 1 };
  const v = validateVoiceCard(next);
  if (!v.ok) throw new Error(v.errors.join('; '));
  return next;
}
