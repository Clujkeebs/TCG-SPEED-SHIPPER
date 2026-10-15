import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeWorld } from './eval/harness.js';
import { makeOrders, makeInventory, loadPrintings } from './fixtures/orders.js';
import { validateOrder, validateInventoryItem } from '../shared/models.js';
import { classify } from './support.js';
import { importInventoryCsv, diffInventory, exportInventoryCsv, parseCsv, toCsv } from './sync/csv.js';

const orders = makeOrders();
const printings = loadPrintings();
const inventory = makeInventory({ printings });
const call = async (name, args = {}) => { const w = makeWorld(); const o = await w.registry.run(name, args); assert.equal(o.ok, true, o.error); return o.result; };

test('fixtures are valid, deterministic, six months, made up', () => {
  assert.ok(orders.length >= 300);
  assert.ok(orders.every((o) => validateOrder(o).ok));
  assert.ok(inventory.every((i) => validateInventoryItem(i).ok));
  assert.deepEqual(makeOrders().map((o) => o.id), orders.map((o) => o.id));
  const span = (Date.parse(orders.at(-1).orderedAt) - Date.parse(orders[0].orderedAt)) / 86400000;
  assert.ok(span > 150 && span < 190);
  assert.ok(orders.every((o) => o.shipTo.address1.endsWith('Example St')));
});

test('orders.search filters and hides names and addresses', async () => {
  const r = await call('orders.search', { buyerKey: 'buyer-001' });
  assert.ok(r.total > 0 && r.orders.every((o) => o.buyerKey === 'buyer-001'));
  assert.ok(!/Example St|shipTo|"name":"[A-Z][a-z]+ [A-Z]/.test(JSON.stringify(r).replace(/"name":"[^"]*"/g, '"name":"item"')));
  const st = await call('orders.search', { state: 'tx', limit: 5 });
  assert.ok(st.orders.every((o) => o.state === 'TX') && st.orders.length <= 5);
  const none = await call('orders.search', { buyerKey: 'nobody' });
  assert.equal(none.total, 0);
});

test('orders.stats adds up', async () => {
  const s = await call('orders.stats');
  assert.equal(s.orders, orders.length);
  assert.equal(s.revenueCents, orders.reduce((a, o) => a + o.itemsTotalCents, 0));
  assert.equal(s.destinations.reduce((a, d) => a + d.orders, 0) <= s.orders, true);
  assert.ok(s.repeat.repeatBuyers > 0 && s.repeat.top[0].orders >= s.repeat.top.at(-1).orders);
  assert.ok(s.cadence.perWeek > 5 && s.cadence.avgDaysToShip >= 0);
  const some = await call('orders.stats', { since: '2026-10-01T00:00:00Z' });
  assert.ok(some.orders < s.orders);
});

test('weekly report compares weeks and flags orders waiting', async () => {
  const w = await call('report.weekly');
  assert.ok(w.orders > 0 && w.revenueCents > 0);
  assert.equal(w.newBuyers + w.returningBuyers, new Set(orders.filter((o) => Date.parse(o.orderedAt) >= Date.parse('2026-10-08T12:00:00Z') && Date.parse(o.orderedAt) < Date.parse('2026-10-15T12:00:00Z')).map((o) => o.buyerKey)).size);
  assert.ok(w.topItems.length > 0);
});

test('inventory.search and restock', async () => {
  const low = await call('inventory.search', { maxQuantity: 0, limit: 100 });
  assert.ok(low.items.every((i) => i.quantity === 0));
  const bolt = await call('inventory.search', { text: 'lightning bolt' });
  assert.ok(bolt.total >= 1);
  const rs = await call('inventory.restock', {});
  assert.ok(rs.items.length > 0);
  assert.ok(rs.items.every((i) => i.inStock <= 2 && i.soldInWindow > 0 && i.suggestedBuyQty >= 1));
  const sorted = [...rs.items].sort((a, b) => b.soldPer30Days - a.soldPer30Days);
  assert.deepEqual(rs.items.map((i) => i.name), sorted.map((i) => i.name).slice(0, rs.items.length).length ? rs.items.map((i) => i.name) : []);
  assert.ok(rs.items.every((it, i, a) => i === 0 || a[i - 1].soldPer30Days >= it.soldPer30Days));
});

test('pricing.suggest uses the rule engine and never guesses', async () => {
  const bolt = printings.filter((p) => p.prices && p.prices.byFinish[p.finishes[0]] && p.prices.byFinish[p.finishes[0]].market > 2000)[0];
  const nm = await call('pricing.suggest', { printingId: bolt.id });
  assert.equal(nm.status, 'priced');
  assert.equal(nm.priceCents % 100, 99);
  const lp = await call('pricing.suggest', { printingId: bolt.id, condition: 'LP' });
  assert.ok(lp.priceCents < nm.priceCents);
  const w = makeWorld();
  assert.equal((await w.registry.run('pricing.suggest', { printingId: 'nope' })).ok, false);
  assert.equal((await w.registry.run('pricing.suggest', { printingId: bolt.id, finish: 'etched' })).result.status, 'missing');
});

test('support drafts: classified, never sent, no promises', async () => {
  assert.equal(classify('where is my order'), 'where-is-it');
  assert.equal(classify('card arrived bent'), 'damaged');
  assert.equal(classify('you sent the wrong card'), 'wrong-item');
  assert.equal(classify('please cancel'), 'cancel');
  assert.equal(classify('hello'), 'other');
  const shipped = orders.find((o) => o.shippedAt);
  const r = await call('support.draftReply', { orderId: shipped.id, buyerMessage: 'where is my package?', sellerName: 'Corner Cards' });
  assert.equal(r.sent, false);
  assert.ok(r.draft.includes(shipped.trackingNumber) && r.draft.startsWith('Hi ' + shipped.shipTo.name.split(' ')[0]));
  const d = await call('support.draftReply', { orderId: shipped.id, buyerMessage: 'it arrived damaged' });
  assert.equal(d.needsHuman, true);
  assert.ok(!/refund(ed)? (is|has|will)|we will replace|i will replace/i.test(d.draft));
  const w = makeWorld();
  assert.equal((await w.registry.run('support.draftReply', { orderId: 'ORD-x', buyerMessage: 'hi' })).ok, false);
});

test('no registered tool can send, change listings or spend', () => {
  const w = makeWorld();
  for (const t of w.registry.list()) {
    assert.ok(['read', 'draft'].includes(t.tier), t.name);
    assert.ok(!/send|email|upload|publish|update|delete|buy|pay/i.test(t.name.split('.')[1].replace('draftReply', '').replace('draftExport', '')), t.name);
    assert.equal(t.costCents || 0, 0);
  }
});

test('CSV: parse, quotes, formula guard', () => {
  assert.deepEqual(parseCsv('a,b\r\n"x, y","say ""hi"""\n'), [['a', 'b'], ['x, y', 'say "hi"']]);
  assert.equal(toCsv([['=SUM(A1)', 'ok', 'a,b']]), "'=SUM(A1),ok,\"a,b\"\r\n");
});

test('CSV import matches cards, reports what it cannot read', () => {
  const csv = 'Product Name,Set Name,Condition,Printing,Total Quantity,TCG Marketplace Price\nLightning Bolt,Magic 2011,Near Mint,Normal,3,$1.49\nLightning Bolt,Magic 2011,Lightly Played,Foil,2,2.10\nNot A Card,Nowhere,Near Mint,Normal,1,1.00\nLightning Bolt,Magic 2011,Near Mint,Normal,lots,1.00\n';
  const r = importInventoryCsv(csv, printings);
  assert.equal(r.items.length, 2);
  assert.deepEqual(r.items.map((i) => [i.condition, i.finish, i.quantity, i.priceCents]), [['NM', 'nonfoil', 3, 149], ['LP', 'foil', 2, 210]]);
  assert.equal(r.unmatched.length, 2);
  assert.ok(r.items.every((i) => validateInventoryItem(i).ok));
  assert.match(importInventoryCsv('Foo,Bar\n1,2\n', printings).problems.join(), /name column/);
  assert.match(importInventoryCsv('', printings).problems[0], /empty/);
});

test('CSV diff finds the differences both ways', () => {
  const a = [{ printingId: 'p1', condition: 'NM', finish: 'nonfoil', language: 'en', quantity: 2, priceCents: 100, source: 'import' }, { printingId: 'p2', condition: 'NM', finish: 'nonfoil', language: 'en', quantity: 1, source: 'import' }];
  const b = [{ ...a[0], quantity: 3, priceCents: 120 }, { printingId: 'p3', condition: 'NM', finish: 'nonfoil', language: 'en', quantity: 1, source: 'import' }];
  const d = diffInventory(a, b);
  assert.equal(d.onlyOurs[0].printingId, 'p2');
  assert.equal(d.onlyTheirs[0].printingId, 'p3');
  assert.equal(d.quantityDiffers[0].theirs, 3);
  assert.equal(d.priceDiffers[0].theirs, 120);
  assert.equal(diffInventory(a, a).inSync, true);
});

test('draft export skips unpriced cards instead of inventing prices', () => {
  const r = exportInventoryCsv('manapool', inventory.map((i, n) => (n === 1 ? { ...i, quantity: 4, priceCents: undefined } : i)), printings);
  assert.equal(r.columnsVerified, false);
  assert.ok(r.skipped.some((s) => s.reason === 'no price set'));
  assert.ok(r.csv.startsWith('Name,Set,Number'));
  assert.throws(() => exportInventoryCsv('nowhere', [], printings));
});
