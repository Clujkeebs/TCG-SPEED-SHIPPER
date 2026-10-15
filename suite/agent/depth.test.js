import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeWorld } from './eval/harness.js';
import { makeOrders, FIXTURE_NOW } from './fixtures/orders.js';
import { chartSeries, CHART_KINDS, weeklyText, weekly } from './analytics.js';
import { draftReply, TONES } from './support.js';
import { findDeals } from './deals.js';
import { DEAL_FEED, ALLOWED_SOURCES } from './fixtures/deals.js';

const orders = makeOrders();
const call = async (name, args = {}) => { const o = await makeWorld().registry.run(name, args); assert.equal(o.ok, true, o.error); return o.result; };

test('chart data lines up: every series matches its labels', () => {
  for (const kind of CHART_KINDS) {
    const c = chartSeries(orders, kind, { now: FIXTURE_NOW, weeks: 8 });
    assert.ok(c.x.length > 0 && c.title);
    for (const s of c.series) assert.equal(s.values.length, c.x.length, kind);
  }
});

test('orders-per-week adds up and is oldest first', () => {
  const c = chartSeries(orders, 'orders-per-week', { now: FIXTURE_NOW, weeks: 26 });
  assert.equal(c.x.length, 26);
  assert.deepEqual([...c.x].sort(), c.x);
  const inWindow = orders.filter((o) => Date.parse(o.orderedAt) >= Date.parse(FIXTURE_NOW) - 26 * 7 * 86400000 && Date.parse(o.orderedAt) < Date.parse(FIXTURE_NOW)).length;
  assert.equal(c.series[0].values.reduce((a, b) => a + b, 0), inWindow);
  assert.throws(() => chartSeries(orders, 'pie', { now: FIXTURE_NOW }));
});

test('buyer mix and destinations match the orders', () => {
  const mix = chartSeries(orders, 'buyer-mix', {});
  assert.equal(mix.series[0].values.reduce((a, b) => a + b, 0), new Set(orders.map((o) => o.buyerKey)).size);
  const dest = chartSeries(orders, 'destinations', {});
  assert.ok(dest.series[0].values.every((v, i, a) => i === 0 || a[i - 1] >= v));
});

test('report.chart tool and weekly draft', async () => {
  const c = await call('report.chart', { kind: 'weekday' });
  assert.equal(c.x.length, 7);
  const d = await call('report.weeklyDraft');
  assert.equal(d.sent, false);
  assert.match(d.text, /^Week ending 2026-10-15/);
  assert.match(d.text, /orders, \$/);
  const w = weekly(orders, { weekEnding: FIXTURE_NOW });
  assert.ok(weeklyText(w).includes(String(w.orders) + ' orders'));
});

test('three tones give three different drafts, same facts, none promise anything', () => {
  const o = orders.find((x) => x.shippedAt);
  const drafts = TONES.map((tone) => draftReply(o, 'where is it', { tone, sellerName: 'Corner Cards' }));
  assert.equal(new Set(drafts.map((d) => d.draft)).size, 3);
  for (const d of drafts) { assert.ok(d.draft.includes(o.trackingNumber)); assert.equal(d.sent, false); assert.ok(d.draft.includes('{{first_name}}')); assert.ok(!d.draft.includes(o.shipTo.name.split(' ')[0])); }
  assert.ok(drafts[1].draft.startsWith('Dear '));
  assert.ok(drafts[2].draft.length < drafts[0].draft.length);
  for (const tone of TONES) for (const msg of ['arrived damaged', 'wrong card', 'cancel please', 'hello']) {
    const d = draftReply(o, msg, { tone });
    assert.equal(d.needsHuman, true);
    assert.ok(!/refund(ed)? (is|has|will)|will (be )?replace|we will replace/i.test(d.draft));
  }
  assert.throws(() => draftReply(o, 'hi', { tone: 'rude' }));
});

test('tone works through the tool and is checked', async () => {
  const w = makeWorld();
  const o = await w.registry.run('support.draftReply', { orderId: orders[0].id, buyerMessage: 'where is it', tone: 'formal' });
  assert.equal(o.result.tone, 'formal');
  assert.equal((await w.registry.run('support.draftReply', { orderId: orders[0].id, buyerMessage: 'x', tone: 'rude' })).ok, false);
});

test('batch pricing suggests, never applies, never guesses', async () => {
  const r = await call('pricing.suggestBatch', { limit: 100 });
  assert.equal(r.applied, false);
  assert.ok(r.rows.length > 0);
  assert.ok(r.rows.every((x) => Number.isInteger(x.suggestedCents) && x.quantity > 0));
  const only = await call('pricing.suggestBatch', { onlyChanged: true, limit: 100 });
  assert.ok(only.rows.every((x) => x.changeCents !== 0));
  const custom = await call('pricing.suggestBatch', { rule: { id: 'fixed-dollar', name: 'x', basis: 'market', percent: 0, rounding: 'dollar' }, limit: 5 });
  assert.equal(custom.ruleId, 'fixed-dollar');
  assert.ok(custom.rows.every((x) => x.suggestedCents % 100 === 0));
  const bad = await makeWorld().registry.run('pricing.suggestBatch', { rule: { id: 'x' } });
  assert.equal(bad.ok, false);
  assert.equal((await call('pricing.rules')).rules[0].id, 'default');
});

test('deal finder: allow-list only, ranked, per-unit price, no network', () => {
  const r = findDeals(DEAL_FEED, { limit: 50 });
  assert.ok(r.deals.every((d) => ALLOWED_SOURCES.some((s) => s.id === d.source)));
  assert.deepEqual(r.ignoredSources, ['unknown-marketplace']);
  assert.ok(!r.deals.some((d) => d.id === 'd8'));
  assert.ok(r.deals.every((d, i, a) => i === 0 || a[i - 1].discountPct >= d.discountPct));
  const sleeves = findDeals(DEAL_FEED, { category: 'sleeves' });
  assert.equal(sleeves.total, 2);
  assert.equal(sleeves.deals[0].perUnitCents, 1.4);
  assert.equal(findDeals(DEAL_FEED, { maxPriceCents: 1000 }).deals.every((d) => d.priceCents <= 1000), true);
  assert.equal(findDeals(DEAL_FEED, { minDiscountPct: 40 }).deals.every((d) => d.discountPct >= 40), true);
  assert.equal(findDeals([{ id: 'z', source: 'fixture-sleeves-co', title: 'bad', category: 'sleeves', priceCents: 'x', listPriceCents: 0 }], {}).total, 0);
});

test('deals.find tool is read-only and names its sources', async () => {
  const r = await call('deals.find', { category: 'monitors' });
  assert.equal(r.total, 1);
  assert.ok(r.allowedSources.length === 3);
  const w = makeWorld();
  assert.equal(w.registry.get('deals.find').tier, 'read');
});
