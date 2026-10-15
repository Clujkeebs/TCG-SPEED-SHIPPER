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
