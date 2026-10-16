// Turns technical messages into plain sentences a shop owner can act on. Unknown text is never
// shown as-is if it looks technical; it gets a safe general sentence instead.
const KNOWN = [
  [/already working/i, 'I am still working on your last request. Wait for it to finish, or press Stop.'],
  [/kill switch/i, 'I am stopped. Press Resume to let me work again.'],
  [/no such approval|not waiting/i, 'That question is no longer waiting for an answer.'],
  [/did not approve|not approve/i, 'Okay, I did not change anything.'],
  [/switched off/i, 'The Agent panel is switched off. Turn it on in Settings.'],
  [/text is too long/i, 'That is too long. Please keep it under 2,000 characters.'],
  [/text is required/i, 'Type what you want done first.'],
  [/memory is full/i, 'My memory is full. Forget something first, then try again.'],
  [/not allowed|sender not trusted|wrong source|unsupported version|unknown type/i, 'Something blocked that request. Close and reopen this panel and try again.'],
  [/limit|spend|cap/i, 'I have reached my limit for today. Try again tomorrow.']
];
export const GENERAL = 'Something went wrong on my side. Nothing was changed. Try again, or close and reopen this panel.';

export function plainError(text) {
  const t = String(text ?? '');
  for (const [re, say] of KNOWN) if (re.test(t)) return say;
  // Short, sentence-like messages with no code-ish characters are fine to show.
  if (t.length > 0 && t.length <= 140 && /^[A-Z][^{}<>_\[\]|\\]*[.!?]$/.test(t)) return t;
  return GENERAL;
}

// Makes the Agent's report readable for a shop owner: drops the "Goal / Plan" preface, turns
// "1. done: ..." lines into plain bullets, and swaps buyer keys for "Ada A." when we know the name.
// `labelFor(key)` returns a label or undefined. Everything stays text.
export function plainAnswer(text, labelFor = () => undefined) {
  let t = String(text ?? '');
  const at = t.indexOf('What happened:');
  if (at !== -1) t = t.slice(at + 'What happened:'.length);
  const lines = t.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
    const m = /^\d+\.\s*(done|waiting-approval|skipped|failed|unexpected|denied):?\s*(.*)$/i.exec(l);
    if (!m) return l;
    const [, status, note] = m;
    if (/^done$/i.test(status)) return '✓ ' + (note || 'Done');
    if (/waiting-approval/i.test(status)) return '⏳ Waiting for your OK (see the card below)';
    if (/unexpected/i.test(status)) return note || 'Nothing to report.'; // a check the plan made, already in plain words
    return (/skipped/i.test(status) ? 'Skipped: ' : 'Did not work: ') + (note || 'no reason given');
  });
  const out = lines.join('\n').replace(/\bb-[a-z0-9]{3,12}\b/g, (k) => labelFor(k) ?? 'a buyer').replace(/\bbuyer-\d{3}\b/g, (k) => labelFor(k) ?? 'a buyer');
  return out || 'Done.';
}
