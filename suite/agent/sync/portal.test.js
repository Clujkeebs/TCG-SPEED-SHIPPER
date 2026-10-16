import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeExport, columnMap, parseCsv } from './csv.js';
import { makeSellerExport } from '../fixtures/export.js';
import { makeInventory, loadPrintings } from '../fixtures/orders.js';
import { makeWorld } from '../eval/harness.js';

const printings = loadPrintings();
const inventory = makeInventory({ printings });
const csv = makeSellerExport({ printings, inventory });

test('column map says what matched, what is missing and what is ignored', () => {
  const cm = columnMap(parseCsv(csv)[0]);
  assert.equal(cm.ok, true);
  assert.equal(cm.map.name.header, 'Product Name');
  assert.equal(cm.map.market.header, 'TCG Market Price');
  assert.equal(cm.map.price.header, 'TCG Marketplace Price');
  assert.ok(cm.unused.includes('Photo URL'));
  assert.ok(cm.missing.includes('location'));
  assert.match(cm.notes.join(' '), /Ignored columns: .*Photo URL/);
  const bad = columnMap(['Foo', 'Bar']);
  assert.equal(bad.ok, false);
  assert.match(bad.notes.join(' '), /No card name column/);
  assert.match(columnMap(['Product Name', 'Total Quantity']).notes.join(' '), /no market price column/);
});

test('analysis finds drift, low stock, duplicates and unreadable rows, and ranks five fixes', () => {
  const a = analyzeExport(csv, printings, { threshold: 2, soldByName: new Map([[inventory[1] && printings.find((p) => p.id === inventory[1].printingId).name, 4]]) });
  assert.equal(a.ok, true);
  assert.equal(a.applied, false);
  assert.ok(a.drift.overCount > 0 && a.drift.underCount > 0);
  assert.ok(a.drift.over.every((x) => x.driftPct >= 15) && a.drift.under.every((x) => x.driftPct <= -20));
  assert.ok(a.duplicates.length >= 1);
  assert.ok(a.unmatched.some((u) => u.name === 'Made Up Card'));
  assert.ok(a.lowStock.every((x) => x.quantity <= 2));
  assert.ok(a.fixes.length <= 5 && a.fixes.length >= 3);
  assert.deepEqual(a.fixes.map((f) => f.rank), a.fixes.map((_, i) => i + 1));
  assert.ok(a.fixes.every((f, i, arr) => i === 0 || arr[i - 1].score >= f.score), 'ranked by money at stake');
  const over = a.fixes.find((f) => f.id === 'overpriced');
  assert.ok(over.action && over.action.tool === 'inventory.setPrices');
  assert.ok(over.action.args.changes.every((c) => Number.isInteger(c.priceCents) && c.priceCents > 0));
  assert.match(over.why, /over market/);
});

test('new prices follow the rule and bring drifted cards back toward market', () => {
  const a = analyzeExport(csv, printings, {});
  for (const x of a.drift.over) assert.ok(x.newPriceCents < x.priceCents && x.newPriceCents <= x.marketCents + 100);
  for (const x of a.drift.under) assert.ok(x.newPriceCents > x.priceCents);
});

test('"Near Mint Foil" style labels are read as condition plus foil', () => {
  const p = printings.find((x) => x.finishes.includes('foil') && x.prices.byFinish.foil);
  const text = `Product Name,Set Name,Condition,Total Quantity,TCG Market Price,TCG Marketplace Price\n${p.name},${p.setName || p.setCode},Near Mint Foil,1,${(p.prices.byFinish.foil.market / 100).toFixed(2)},${(p.prices.byFinish.foil.market * 2 / 100).toFixed(2)}\n`;
  const a = analyzeExport(text, printings, {});
  assert.equal(a.rows, 1);
  assert.equal(a.drift.over[0].finish, 'foil');
});

test('bad files are refused with plain words, not crashes', () => {
  assert.deepEqual(analyzeExport('', printings, {}).problems, ['the file is empty']);
  assert.match(analyzeExport('a,b\n1,2\n', printings, {}).problems.join(), /card name/);
  assert.match(analyzeExport('Product Name,Total Quantity\n' + 'x,1\n'.repeat(5), printings, { maxRows: 3 }).problems.join(), /too many rows/);
  const noMarket = analyzeExport('Product Name,Set Name,Total Quantity,TCG Marketplace Price\nLightning Bolt,Magic 2011,1,1.00\n', printings, {});
  assert.ok(noMarket.fixes.some((f) => f.id === 'no-market'));
});

test('through the agent: analysis is read-only, each change becomes a card, only local stock can change', async () => {
  const w = makeWorld({ clockStart: '2026-10-15T12:00:00Z' });
  const text = makeSellerExport({ printings: w.printings, inventory: w.inventory });
  const before = JSON.stringify(w.inventory);
  const out = await w.agent.syncExport(text);
  assert.equal(out.status, 'ok');
  assert.equal(JSON.stringify(w.inventory), before, 'nothing applied');
  assert.ok(out.cards.length >= 1 && out.cards.every((c) => c.tool === 'inventory.setPrices' && c.status === 'pending'));
  const withCard = out.analysis.fixes.filter((f) => f.cardId);
  assert.equal(withCard.length, out.cards.length);
  assert.match(out.cards[0].expected, /Total list value/);
  const card = await w.agent.decide(out.cards[0].id, true);
  assert.equal(card.card.status, 'done');
  assert.notEqual(JSON.stringify(w.inventory), before);
  assert.equal((await w.agent.syncExport('nonsense')).status, 'unreadable');
  const log = await w.audit.list();
  assert.ok(log.some((e) => e.tool === 'sync.analyzeExport' && e.outcome === 'ok'));
});
