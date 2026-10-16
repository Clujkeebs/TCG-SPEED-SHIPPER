import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { POLICIES, POLICY_IDS, getPolicy, searchPolicies, citation, sellerNotes, CHECK_WORDING, CATEGORY_POLICIES } from './policies.js';
import { draftReply, classify } from './support.js';
import { makeWorld } from './eval/harness.js';
import { makeOrders } from './fixtures/orders.js';

const repo = (p) => fileURLToPath(new URL('../../' + p, import.meta.url));
const text = (file) => readFileSync(repo(file), 'utf8').replace(/<[^>]+>/g, ' ').replace(/&#?\w+;/g, (m) => ({ '&amp;': '&', '&rsquo;': '’', '&#39;': "'", '&quot;': '"' }[m] || m)).replace(/\s+/g, ' ');

test('every entry has an id, a date, a source and a check phrase that is still in our blog post', () => {
  assert.equal(new Set(POLICY_IDS).size, POLICIES.length, 'ids are unique');
  for (const p of POLICIES) {
    assert.match(p.id, /^[A-Z]+-\d+$/);
    assert.ok(p.title && p.summary.length > 40 && p.summary.length < 700, p.id);
    assert.match(p.asOf, /^2026-\d\d(-\d\d)?$/);
    assert.ok(existsSync(repo(p.source.blog)), p.id + ' blog file exists');
    assert.ok(text(p.source.blog).includes(p.check), `${p.id}: "${p.check}" not found in ${p.source.blog}; the post changed, review this entry`);
    assert.match(p.source.blogUrl, /^https:\/\/tcgspeedshipper\.com\/blog\/[\w-]+\.html$/);
    if (p.source.official) assert.match(p.source.official, /^https:\/\/help\.tcgplayer\.com\/hc\/en-us\/articles\/\d+/);
  }
});

test('official links are ones our own posts actually link to', () => {
  for (const p of POLICIES.filter((x) => x.source.official)) assert.ok(readFileSync(repo(p.source.blog), 'utf8').includes(p.source.official), p.id);
});

test('lookup and search', () => {
  assert.equal(getPolicy('LOST-1').topic, 'lost');
  assert.equal(getPolicy('NOPE'), undefined);
  assert.equal(searchPolicies('signature $250')[0].id, 'SHIP-1');
  assert.ok(searchPolicies('damaged', { topic: 'returns' }).every((p) => p.topic === 'returns'));
  assert.match(citation(getPolicy('RET-2')), /RET-2.*our post, as of 2026-09-28.*check TCGplayer's current article.*https:\/\/help\.tcgplayer\.com/);
  assert.equal(sellerNotes([]), '');
});

test('every reply category cites real entries, and every draft says to check the current article', () => {
  const o = makeOrders().find((x) => x.shippedAt);
  const unshipped = { ...o, shippedAt: undefined, trackingNumber: undefined };
  const cases = [['where is my package', o], ['where is my package', unshipped], ['it arrived creased', o], ['you sent the wrong card', o], ['please cancel', o], ['can you change the address to a new one', o]];
  for (const [msg, order] of cases) {
    const d = draftReply(order, msg, {});
    assert.ok(d.policies.length >= 1, msg);
    for (const id of d.policies) { assert.ok(POLICY_IDS.includes(id)); assert.ok(d.draft.includes(id), `${id} is cited in the draft`); }
    assert.ok(d.draft.includes(CHECK_WORDING), 'says to check the current article');
    assert.ok(d.draft.includes('For you, not the buyer'));
    assert.ok(!d.message.includes('For you, not the buyer') && !d.message.includes(d.policies[0] + ':'), 'the buyer-facing part has no notes');
    assert.equal(d.sent, false);
  }
  assert.equal(draftReply(o, 'hello', {}).policies.length, 0, 'no entry, no citation, nothing invented');
  assert.equal(classify('wrong address on my order'), 'address');
  assert.deepEqual(Object.keys(CATEGORY_POLICIES).sort(), ['address', 'cancel', 'damaged', 'not-shipped', 'other', 'where-is-it', 'wrong-item']);
});

test('drafts still make no promises about refunds', () => {
  const o = makeOrders()[0];
  for (const msg of ['arrived damaged', 'wrong card', 'cancel and refund me', 'where is it']) {
    const d = draftReply(o, msg, {});
    assert.ok(!/we will refund|i will refund|will be refunded|i will replace|we will replace/i.test(d.message), msg);
  }
});

test('policy.lookup tool is read-only and returns citations', async () => {
  const w = makeWorld();
  assert.equal(w.registry.get('policy.lookup').tier, 'read');
  const r = await w.registry.run('policy.lookup', { id: 'LOST-1' });
  assert.equal(r.result.entries[0].id, 'LOST-1');
  assert.match(r.result.entries[0].cite, /check TCGplayer's current article/);
  const s = await w.registry.run('policy.lookup', { text: 'returns buyer remorse' });
  assert.ok(s.result.entries.length >= 1);
  assert.equal((await w.registry.run('policy.lookup', { id: 'MADE-UP' })).ok, false);
});
