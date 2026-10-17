import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseStockExport, readCondition, mapStockColumns } from '../src/stock/parser.js';
import { openStore } from '../src/store.js';
import { createPracticeHost } from '../src/agent-host/host.js';
import { createMemoryStore } from '../src/vendor/agent/audit.js';
import { memoryStatePersist } from '../src/agent-host/persist.js';
import { buildCsv } from '../src/vendor/scan/core/csv.js';
import { makeStockCsv, STOCK_HEADER } from './helpers/stock-csv.js';

const ID = 'ext-test-id';
const sender = { id: ID, url: `chrome-extension://${ID}/src/ui/sidepanel.html` };
let n = 0;
const req = (type, payload) => ({ source: 'tcgss-panel', v: 1, id: 'q' + ++n, type, ...(payload ? { payload } : {}) });

test('conditions: TCGplayer labels become our conditions and finishes; sealed product is not a card', () => {
  assert.deepEqual(readCondition('Near Mint'), { condition: 'NM', finish: 'nonfoil' });
  assert.deepEqual(readCondition('Lightly Played Foil'), { condition: 'LP', finish: 'foil' });
  assert.deepEqual(readCondition('damaged'), { condition: 'DMG', finish: 'nonfoil' });
  assert.deepEqual(readCondition(''), { condition: 'NM', finish: 'nonfoil' });
  for (const bad of ['Unopened', 'Mint', 'Sealed Box']) assert.equal(readCondition(bad), null, bad);
});

test('a TCGplayer-style export: "Total Quantity" is the stock, prices come from the file, nothing is invented', () => {
  const csv = [STOCK_HEADER,
    '111,Magic,"Practice Set","Ember Drake",,12,Rare,Near Mint,5.00,,,4.50,3,,4.75',
    '111,Magic,"Practice Set","Ember Drake",,12,Rare,Near Mint Foil,12.00,,,11.00,0,,11.99',
    '222,Pokemon,"Other Set","Quiet Grove",,7,Common,Lightly Played,0.40,,,0.30,10,,'].join('\n');
  const r = parseStockExport(csv);
  assert.equal(r.ok, true);
  assert.equal(r.format, 'tcgplayer');
  assert.equal(r.items.length, 3);
  assert.equal(r.printings.length, 2);
  const drake = r.printings.find((p) => p.tcgplayerProductId === 111);
  assert.deepEqual([drake.id, drake.name, drake.setName, drake.number, drake.game], ['mtg:tcgplayer:111', 'Ember Drake', 'Practice Set', '12', 'mtg']);
  assert.deepEqual(drake.finishes.sort(), ['foil', 'nonfoil']);
  assert.equal(drake.prices.byFinish.foil.market, 1200);
  const foil = r.items.find((i) => i.finish === 'foil');
  assert.deepEqual([foil.quantity, foil.priceCents], [0, 1199], 'a sold-out card is kept at 0');
  const grove = r.items.find((i) => i.printingId === 'pokemon:tcgplayer:222');
  assert.equal(grove.priceCents, undefined, 'no price in the file means no price, never a guess');
  assert.deepEqual(grove, { printingId: 'pokemon:tcgplayer:222', condition: 'LP', finish: 'nonfoil', language: 'en', quantity: 10, source: 'import' });
});

test("Speed Scan's own CSV is read too (product id, condition, quantity, price only)", () => {
  const out = buildCsv([{ id: 'a', printingId: 'p1', condition: 'NM', finish: 'nonfoil', language: 'en', quantity: 2, priceCents: 99, source: 'scan', createdAt: '2026-10-15T12:00:00Z' }, { id: 'b', printingId: 'p1', condition: 'LP', finish: 'foil', language: 'en', quantity: 1, priceCents: 250, source: 'scan', createdAt: '2026-10-15T12:00:00Z' }], () => ({ name: 'X', setCode: 'S', number: '1', tcgplayerProductId: 4242 }));
  const r = parseStockExport(out.csv);
  assert.equal(r.ok, true);
  assert.equal(r.format, 'scan');
  assert.deepEqual(r.items.map((i) => [i.condition, i.finish, i.quantity, i.priceCents]), [['NM', 'nonfoil', 2, 99], ['LP', 'foil', 1, 250]]);
  assert.match(r.printings[0].name, /TCGplayer product 4242/, 'no name in the file: say what we know, not a made-up name');
});

test('a wrong file is explained in plain words, and nothing is half-read', () => {
  const orders = parseStockExport('Order #,FirstName,LastName,Address1\nA1,Ada,Alder,1 St\n');
  assert.equal(orders.ok, false);
  assert.match(orders.error, /product id and quantity columns/);
  assert.match(orders.error, /not the order export/);
  for (const bad of ['', '   ', 'only,a,header', undefined, 42]) assert.equal(parseStockExport(bad).ok, false);
  assert.equal(parseStockExport(STOCK_HEADER + '\nabc,Magic,S,N,,1,R,Near Mint,1,,,1,1,,1\n').ok, false, 'no readable rows');
});

test('bad rows are skipped and counted with a reason; duplicates and sealed product too', () => {
  const csv = [STOCK_HEADER,
    '1,Magic,S,A,,1,R,Near Mint,1.00,,,1,2,,1.00',
    'x,Magic,S,B,,1,R,Near Mint,1.00,,,1,2,,1.00',
    '3,Magic,S,C,,1,R,Near Mint,1.00,,,1,lots,,1.00',
    '4,Magic,S,D,,1,R,Unopened,1.00,,,1,2,,1.00',
    '1,Magic,S,A,,1,R,Near Mint,1.00,,,1,5,,1.00',
    '6,Magic,S,F,,1,R,Near Mint,1.00,,,1,2,,free'].join('\n');
  const r = parseStockExport(csv);
  assert.equal(r.ok, true);
  assert.equal(r.items.length, 1);
  assert.deepEqual(r.skipped.map((s) => [s.row, s.reason]), [[3, 'no product id'], [4, 'unreadable quantity'], [5, 'condition not understood (sealed product?)'], [6, 'listed twice'], [7, 'unreadable price']]);
});

test('hostile text in a cell stays plain data', () => {
  const r = parseStockExport([STOCK_HEADER, '9,Magic,"<img src=x onerror=alert(1)>","=cmd|calc",,1,R,Near Mint,1.00,,,1,2,,1.00'].join('\n'));
  assert.equal(r.ok, true);
  assert.equal(r.printings[0].name, '=cmd|calc');
  assert.equal(r.printings[0].setName, '<img src=x onerror=alert(1)>');
});

test('300 products (about 800 stock rows): read fast, all valid, saved together or not at all', async () => {
  const csv = makeStockCsv(300);
  const t0 = performance.now();
  const r = parseStockExport(csv);
  assert.equal(r.ok, true);
  assert.ok(r.items.length > 600 && r.printings.length === 300);
  assert.equal(r.skipped.length, 0);
  const store = await openStore({ indexedDB: undefined });
  await store.replaceCollections({ printings: r.printings, inventory: r.items });
  assert.ok(performance.now() - t0 < 1500);
  assert.equal((await store.list('inventory')).length, r.items.length);
  assert.equal((await store.list('printings')).length, 300);
  // one bad record anywhere and neither collection changes
  await assert.rejects(store.replaceCollections({ printings: [{ id: 'bad' }], inventory: [] }));
  assert.equal((await store.list('inventory')).length, r.items.length, 'unchanged');
  assert.equal((await store.list('printings')).length, 300, 'unchanged');
});

// ---- the Agent uses the real stock
function stockWorld() {
  const stock = parseStockExport(makeStockCsv(120));
  const persist = memoryStatePersist(); const auditStore = createMemoryStore();
  const boot = () => {
    const host = createPracticeHost({ extensionId: ID, persist, auditStore, loadStock: async () => ({ items: stock.items, printings: stock.printings }) });
    const events = [];
    const wait = async (event) => { for (let i = 0; i < 300; i++) { const e = events.find((x) => x.event === event); if (e) return e; await new Promise((r) => setTimeout(r, 5)); } throw new Error('timed out waiting for ' + event); };
    return { host, events, wait, send: (t, p, s = sender) => host.handle(req(t, p), s, (e) => events.push(e)) };
  };
  return { boot, stock };
}

test('restock and repricing use the real stock after the switch', async () => {
  const { boot, stock } = stockWorld();
  const a = boot();
  assert.deepEqual((await a.send('ext.stock.status')).result, { mode: 'practice', items: 8, cards: 8 });
  assert.equal((await a.send('ext.stock.use', { mode: 'imported' })).ok, true);
  assert.deepEqual((await a.send('ext.stock.status')).result, { mode: 'imported', items: stock.items.length, cards: 120 });
  assert.equal((await a.send('ext.stock.use', { mode: 'both' })).ok, false);
  assert.equal((await a.send('ext.stock.use', { mode: 'imported' }, { id: 'x', url: 'https://tcgspeedshipper.com/' })).ok, false);

  await a.send('agent.ask', { text: 'Reprice my cards 5% under market' });
  const card = await a.wait('agent.approval-needed');
  assert.match(card.description, /Change the saved price of \d+ cards/);
  const planned = Number(/(\d+) cards/.exec(card.description)[1]);
  assert.ok(planned > 8, `the plan covers the real stock (${planned} cards), not the 8 practice ones`);
  assert.ok(card.args.changes.every((c) => c.printingId.startsWith('mtg:tcgplayer:')), 'only real products');
  const before = JSON.stringify(a.host.shop.inventory);
  assert.equal((await a.send('agent.approve', { approvalId: card.approvalId, approved: true })).result.status, 'done');
  assert.notEqual(JSON.stringify(a.host.shop.inventory), before, 'the real stock rows got their new prices');
});

test('switching waits for waiting cards; the stock and its price changes survive a restart; Clear puts the practice stock back', async () => {
  const { boot } = stockWorld();
  const a = boot();
  await a.send('ext.stock.use', { mode: 'imported' });
  await a.send('agent.ask', { text: 'Reprice my cards 5% under market' });
  const card = await a.wait('agent.approval-needed');
  const blocked = await a.send('ext.stock.use', { mode: 'practice' });
  assert.equal(blocked.ok, false);
  assert.match(blocked.error, /waiting approval cards/);
  await a.send('agent.approve', { approvalId: card.approvalId, approved: true });
  const prices = JSON.stringify(a.host.shop.inventory.map((i) => i.priceCents));

  const b = boot(); // the worker slept
  assert.equal((await b.send('ext.stock.status')).result.mode, 'imported');
  assert.equal(JSON.stringify(b.host.shop.inventory.map((i) => i.priceCents)), prices, 'the price changes came back on top of the stock file');
  assert.ok(JSON.stringify(b.host.snapshot().prices).length < 20000, 'only changed prices are saved, not the whole stock');

  await b.host.clearAll();
  assert.deepEqual((await b.send('ext.stock.status')).result, { mode: 'practice', items: 8, cards: 8 });
});

test('nothing to use: an empty stock cannot be switched on', async () => {
  const host = createPracticeHost({ extensionId: ID, loadStock: async () => ({ items: [], printings: [] }) });
  const r = await host.handle(req('ext.stock.use', { mode: 'imported' }), sender, () => {});
  assert.equal(r.ok, false);
});

test('column map finds the usual names', () => {
  const cols = mapStockColumns(STOCK_HEADER.split(','));
  assert.deepEqual([cols.productId, cols.name, cols.condition, cols.quantity, cols.price, cols.market], [0, 3, 7, 12, 14, 8]);
});
