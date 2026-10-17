import { test } from 'node:test';
import assert from 'node:assert/strict';
import { morningBriefing, MAX_WORDS } from './briefing.js';
import { makeWorld } from './eval/harness.js';

const words = (t) => t.split(/\s+/).filter(Boolean).length;

test('briefing: plain text, under 150 words, four parts, from real numbers', async () => {
  const w = makeWorld({ clockStart: '2026-10-16T08:00:00Z' });
  await w.agent.goal('Reprice my foils 5% under market'); // leaves one approval card waiting
  const r = (await w.registry.run('briefing.morning', {})).result;
  assert.ok(r.words <= MAX_WORDS && r.words === words(r.text), String(r.words));
  assert.match(r.text, /^Good morning\. Friday Oct 16\./);
  for (const part of ['Ship today:', 'Worth doing:', 'Low stock:', 'Waiting for you:']) assert.ok(r.text.includes(part), part);
  assert.ok(!/[#*_`|]/.test(r.text), 'plain text, no markup');
  assert.equal(r.parts.approvalsWaiting, 1);
  assert.match(r.text, /1 approval/);
  assert.equal(r.parts.thingsWorthDoing, 5);
  assert.equal((r.text.match(/^\d\. /gm) || []).length, 5);
  assert.equal(r.parts.shipOrders, w.orders.filter((o) => o.status === 'paid').length);
});

test('briefing is deterministic: the same data gives the same words', async () => {
  const a = (await makeWorld({ clockStart: '2026-10-16T08:00:00Z' }).registry.run('briefing.morning', {})).result.text;
  const b = (await makeWorld({ clockStart: '2026-10-16T08:00:00Z' }).registry.run('briefing.morning', {})).result.text;
  assert.equal(a, b);
});

test('briefing stays under the limit however long the names and titles are', () => {
  const long = 'Extraordinarily Long Card Name With Many Many Extra Words Attached';
  const run = (name) => ({
    'orders.search': { total: 12, orders: [{ orderedAt: '2026-10-10T00:00:00Z' }] },
    'suggestions.weekly': { suggestions: Array.from({ length: 5 }, (_, i) => ({ title: `Do the very important thing number ${i} with a very long title indeed ${long}` })) },
    'inventory.restock': { items: Array.from({ length: 80 }, () => ({ name: long })) },
    'messages.unanswered': { total: 40 },
  })[name];
  const r = morningBriefing({ run, now: '2026-10-16T08:00:00Z', pendingApprovals: 9 });
  assert.ok(r.words <= MAX_WORDS, String(r.words));
  assert.match(r.text, /Ship today: 12 orders, the oldest 6 days old\./);
  assert.match(r.text, /9 approvals/);
});

test('briefing with nothing to report says so plainly', () => {
  const run = (name) => ({ 'orders.search': { total: 0, orders: [] }, 'suggestions.weekly': { suggestions: [] }, 'inventory.restock': { items: [] }, 'messages.unanswered': { total: 0 } })[name];
  const r = morningBriefing({ run, now: '2026-10-17T08:00:00Z' });
  assert.match(r.text, /Ship today: nothing is waiting\./);
  assert.match(r.text, /Worth doing: nothing stands out\./);
  assert.match(r.text, /Low stock: nothing selling is running out\./);
  assert.match(r.text, /Waiting for you: nothing\./);
  assert.match(r.text, /Saturday Oct 17/);
});

test('briefing is read-only, available to jobs and to the agent', async () => {
  const w = makeWorld({ clockStart: '2026-10-16T08:00:00Z' });
  assert.equal(w.registry.get('briefing.morning').tier, 'read');
  const before = JSON.stringify([w.inventory, w.memory.list()]);
  assert.equal((await w.agent.briefing()).words <= 150, true);
  assert.equal(JSON.stringify([w.inventory, w.memory.list()]), before);
  const plan = await w.agent.goal('Write my weekly summary');
  assert.equal(plan.status, 'done');
});
