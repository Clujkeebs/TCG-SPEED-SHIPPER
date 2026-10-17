import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveVoiceCard, validateVoiceCard, editVoiceCard, describeVoice, voiceFromMemory, DEFAULT_CARD, VOICE_KEY } from './voice.js';
import { draftReply, fillPlaceholders } from './support.js';
import { makeWorld } from './eval/harness.js';
import { makeOrders } from './fixtures/orders.js';

// Made-up past replies. The names, order numbers and tracking numbers in them must never come out the other end.
const CASUAL = [
  "Hey Sarah! Thanks so much for your order #TC-4432. I'll get it out tomorrow, promise! 😊\nCheers!\nMike",
  "Hey Dev, no worries at all, it's on its way! Tracking is 9400ZZ771234, you're all set.\nCheers!\nMike",
  "Hey Priya, sorry about that, I'm gonna send a replacement bolt today! Thanks for being so cool about it!\nCheers!\nMike",
];
const FORMAL = [
  "Dear Mr. Okafor,\n\nThank you for contacting us regarding order 88123. Unfortunately, the item was damaged in transit. Please send a photograph of the packaging so that we may assist you further.\n\nKind regards,\nCorner Cards",
  "Dear Ms. Lindqvist,\n\nWe sincerely apologize for the delay with order 88999. Please be advised that your package shipped on Monday and the tracking number is 9400AA55.\n\nKind regards,\nCorner Cards",
  "Dear Dr. Haas,\n\nThank you for your message. We regret the inconvenience and kindly ask that you confirm the address on file, so that we may advise further.\n\nKind regards,\nCorner Cards",
];
const SHORT = [
  'Hi Tom,\nShipped today, tracking 9400QQ1.\nThanks,\nBea',
  'Hi Una,\nGot it, will pack it tonight.\nThanks,\nBea',
  'Hi Vic,\nSure, send a photo and I will sort it.\nThanks,\nBea',
];

test('derives greeting, sign-off, length and formality; only generic words are kept', () => {
  const casual = deriveVoiceCard(CASUAL);
  assert.deepEqual(casual, { version: 1, greeting: 'Hey', signOff: 'Cheers!', length: 'short', formality: 'casual', exclamation: true, emoji: true });
  const formal = deriveVoiceCard(FORMAL);
  assert.equal(formal.greeting, 'Dear'); assert.equal(formal.signOff, 'Kind regards,'); assert.equal(formal.formality, 'formal'); assert.equal(formal.exclamation, false); assert.equal(formal.emoji, false);
  assert.ok(['short', 'medium'].includes(formal.length));
  const short = deriveVoiceCard(SHORT);
  assert.equal(short.length, 'short'); assert.equal(short.greeting, 'Hi'); assert.equal(short.signOff, 'Thanks,');
  assert.ok([casual, formal, short].every((c) => validateVoiceCard(c).ok));
});

test('the card never holds anything from the samples: no names, order numbers, tracking, sentences', () => {
  const secrets = ['Sarah', 'Dev', 'Priya', 'Okafor', 'Lindqvist', 'Haas', 'Mike', 'Corner Cards', 'TC-4432', '88123', '88999', '9400ZZ771234', '9400AA55', 'Tom', 'Una', 'Vic', 'Bea', 'replacement bolt', 'photograph'];
  for (const set of [CASUAL, FORMAL, SHORT]) {
    const card = JSON.stringify(deriveVoiceCard(set)) + describeVoice(deriveVoiceCard(set));
    for (const s of secrets) assert.ok(!card.includes(s), 'leaked ' + s);
  }
});

test('bad input is refused in plain words', () => {
  assert.throws(() => deriveVoiceCard(CASUAL.slice(0, 2)), /3 to 5/);
  assert.throws(() => deriveVoiceCard([...CASUAL, ...SHORT]), /3 to 5/);
  assert.throws(() => deriveVoiceCard(['short', 'tiny', 'nope']), /at least 20/);
  assert.throws(() => deriveVoiceCard([1, 2, 3]));
  assert.equal(deriveVoiceCard(['no greeting here just the point of the message\nthanks', 'another plain reply with nothing else in it\nthanks', 'one more plain reply with a few words\nthanks']).greeting, '');
});

test('the card is editable and checked', () => {
  const c = editVoiceCard(DEFAULT_CARD, { greeting: 'Hello', signOff: 'Best regards,', length: 'long' });
  assert.equal(c.greeting, 'Hello');
  assert.throws(() => editVoiceCard(c, { greeting: 'Yo' }), /greeting/);
  assert.throws(() => editVoiceCard(c, { signOff: 'Love you,' }), /signOff/);
  assert.throws(() => editVoiceCard(c, { formality: 'rude' }), /formality/);
});

test('drafts follow the card, still use the name placeholder, and copy nothing from the samples', () => {
  const o = makeOrders().find((x) => x.shippedAt);
  const casual = draftReply(o, 'where is my order', { sellerName: 'Mike', voice: deriveVoiceCard(CASUAL) });
  assert.ok(casual.message.startsWith('Hey {{first_name}},'));
  assert.ok(casual.message.includes('\n\nCheers!\nMike'));
  assert.ok(casual.message.endsWith('📦\n\nCheers!\nMike') || casual.message.includes('📦'));
  assert.ok(/!\s*📦/.test(casual.message), 'exclamation marks follow the card on a calm message');
  assert.equal(casual.tone, 'voice');
  const formal = draftReply(o, 'where is my order', { sellerName: 'Corner Cards', voice: deriveVoiceCard(FORMAL) });
  assert.ok(formal.message.startsWith('Dear {{first_name}},') && formal.message.includes('Kind regards,\nCorner Cards') && !formal.message.includes('!'));
  const short = draftReply(o, 'where is my order', { voice: deriveVoiceCard(SHORT) });
  assert.ok(short.message.length < formal.message.length, 'a short card gives a shorter reply than a formal one');
  const long = draftReply(o, 'where is my order', { voice: { ...DEFAULT_CARD, length: 'long' } });
  assert.match(long.message, /anything else I can help with/);
  assert.ok(long.message.length > short.message.length);
  const longFormal = draftReply(o, 'where is my order', { voice: { ...DEFAULT_CARD, length: 'long', formality: 'formal' } });
  assert.match(longFormal.message, /do not hesitate to contact me/);
  const all = JSON.stringify([casual, formal, short]);
  for (const s of ['Sarah', 'Okafor', 'TC-4432', '88123', '9400ZZ771234', 'Mike\n', 'Tom']) if (s !== 'Mike\n') assert.ok(!all.includes(s), s);
  assert.equal(fillPlaceholders(casual.message, { firstName: 'Ana' }).startsWith('Hey Ana,'), true);
});

test('cheer is never added to a problem report, and policy notes still follow the draft', () => {
  const o = makeOrders().find((x) => x.shippedAt);
  const d = draftReply(o, 'the card arrived creased and bent', { voice: deriveVoiceCard(CASUAL) });
  assert.ok(!/!\s*$/m.test(d.message.split('\n\n')[1]), 'no exclamation in the damaged-card body');
  assert.ok(!d.message.includes('📦'));
  assert.ok(d.draft.includes('RET-3') && d.draft.includes("check TCGplayer's current article"));
  assert.equal(d.needsHuman, true);
});

test('stored in memory, shown, edited and deleted by the seller; the draft tool uses it automatically', async () => {
  const w = makeWorld({ clockStart: '2026-10-16T08:00:00Z' });
  const o = w.orders.find((x) => x.shippedAt);
  const plain = (await w.registry.run('support.draftReply', { orderId: o.id, buyerMessage: 'where is my order' })).result;
  assert.ok(plain.message.startsWith('Hi {{first_name}},'));
  const learned = await w.agent.learnVoice(CASUAL);
  assert.equal(learned.card.greeting, 'Hey');
  const fact = w.memory.list().find((f) => f.key === VOICE_KEY);
  assert.equal(fact.source, 'user'); assert.match(fact.text, /My reply style/);
  assert.deepEqual(voiceFromMemory(w.memory), learned.card);
  const styled = (await w.registry.run('support.draftReply', { orderId: o.id, buyerMessage: 'where is my order', sellerName: 'Mike' })).result;
  assert.ok(styled.message.startsWith('Hey {{first_name}},'));
  const forced = (await w.registry.run('support.draftReply', { orderId: o.id, buyerMessage: 'where is my order', tone: 'formal' })).result;
  assert.ok(forced.message.startsWith('Dear {{first_name}},'), 'an explicit tone wins');
  const edited = await w.agent.setVoice({ greeting: 'Hello', exclamation: false });
  assert.equal(edited.card.greeting, 'Hello');
  assert.equal(w.memory.list().filter((f) => f.key === VOICE_KEY).length, 1, 'edited in place, not duplicated');
  await assert.rejects(w.agent.setVoice({ length: 'huge' }), /length/);
  await w.agent.learnVoice(FORMAL);
  assert.equal(voiceFromMemory(w.memory).greeting, 'Dear');
  await w.agent.forgetMemory(w.memory.list().find((f) => f.key === VOICE_KEY).id);
  assert.equal(voiceFromMemory(w.memory), null);
  const back = (await w.registry.run('support.draftReply', { orderId: o.id, buyerMessage: 'where is my order' })).result;
  assert.ok(back.message.startsWith('Hi {{first_name}},'));
  const log = (await w.audit.list()).filter((e) => e.actor === 'user').map((e) => e.tool);
  assert.ok(log.includes('memory.add') && log.includes('memory.edit') && log.includes('memory.delete'));
  // a card that was hand-edited into something invalid in memory is ignored, not trusted
  w.memory.add({ text: 'broken style', key: VOICE_KEY, value: '{"greeting":"Yo"}' });
  assert.equal(voiceFromMemory(w.memory), null);
});
