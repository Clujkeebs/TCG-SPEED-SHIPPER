import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GAMES, CONDITIONS, FINISHES,
  dollarsToCents, centsToDollars, formatUsd, makePrintingId,
  validatePrinting, validatePriceRule, validateListingDraft, validateScanRecord,
  validateInventoryItem, validateOrder, validateAutomation, validateAuditEntry,
} from './models.js';

const printing = () => ({
  id: 'mtg:scryfall:abc-123',
  game: 'mtg',
  name: 'Lightning Bolt',
  setCode: 'm10',
  setName: 'Magic 2010',
  number: '146',
  finishes: ['nonfoil', 'foil'],
  language: 'en',
  tcgplayerProductId: 12345,
  prices: { asOf: '2026-10-15', source: 'fixture', byFinish: { nonfoil: { market: 150, low: 120 }, foil: { market: 900 } } },
});
const rule = () => ({ id: 'r1', name: '5% under market', basis: 'market', percent: -5, rounding: 'ends-99', floorCents: 25 });
const draft = () => ({ id: 'd1', printingId: 'mtg:scryfall:abc-123', condition: 'NM', finish: 'nonfoil', language: 'en', quantity: 1, priceCents: 143, source: 'scan', createdAt: '2026-10-15T12:00:00Z' });

test('money helpers use whole cents', () => {
  assert.equal(dollarsToCents('1.15'), 115);
  assert.equal(dollarsToCents(19.99), 1999);
  assert.equal(dollarsToCents('$1,234.50'), 123450);
  assert.ok(Number.isNaN(dollarsToCents('abc')));
  assert.equal(centsToDollars(250), 2.5);
  assert.equal(formatUsd(5), '$0.05');
});

test('makePrintingId builds game:provider:id and rejects bad input', () => {
  assert.equal(makePrintingId('pokemon', 'PokemonTCG', 'sv1-25'), 'pokemon:pokemontcg:sv1-25');
  assert.throws(() => makePrintingId('chess', 'x', '1'));
  assert.throws(() => makePrintingId('mtg', '', '1'));
  assert.throws(() => makePrintingId('mtg', 'x', ''));
});

test('constants cover the games the owner named', () => {
  for (const g of ['mtg', 'pokemon', 'yugioh', 'onepiece']) assert.ok(GAMES.includes(g));
  assert.deepEqual(CONDITIONS, ['NM', 'LP', 'MP', 'HP', 'DMG']);
  assert.ok(FINISHES.includes('foil'));
});

test('validatePrinting accepts a good printing and flags bad ones', () => {
  assert.deepEqual(validatePrinting(printing()), { ok: true, errors: [] });
  const noId = printing(); delete noId.tcgplayerProductId;
  assert.equal(validatePrinting(noId).ok, true, 'a missing TCGplayer id is allowed (never guessed)');
  const bad = Object.assign(printing(), { game: 'chess', finishes: [], tcgplayerProductId: -4 });
  const r = validatePrinting(bad);
  assert.equal(r.ok, false);
  assert.ok(r.errors.length >= 3);
  assert.equal(validatePrinting(null).ok, false);
  const badPrice = printing(); badPrice.prices.byFinish.foil.market = 9.5;
  assert.equal(validatePrinting(badPrice).ok, false, 'prices must be whole cents');
});

test('validatePriceRule', () => {
  assert.equal(validatePriceRule(rule()).ok, true);
  assert.equal(validatePriceRule(Object.assign(rule(), { basis: 'fixed' })).ok, false, 'fixed needs fixedCents');
  assert.equal(validatePriceRule(Object.assign(rule(), { basis: 'fixed', fixedCents: 99 })).ok, true);
  assert.equal(validatePriceRule(Object.assign(rule(), { percent: -150 })).ok, false);
  assert.equal(validatePriceRule(Object.assign(rule(), { rounding: 'banana' })).ok, false);
  assert.equal(validatePriceRule(Object.assign(rule(), { conditionMultipliers: { NM: 1, LP: 0.9, MP: 0.8 } })).ok, true);
  assert.equal(validatePriceRule(Object.assign(rule(), { conditionMultipliers: { NM: 1, XX: 1 } })).ok, false);
});

test('validateListingDraft', () => {
  assert.equal(validateListingDraft(draft()).ok, true);
  assert.equal(validateListingDraft(Object.assign(draft(), { quantity: 0 })).ok, false);
  assert.equal(validateListingDraft(Object.assign(draft(), { priceCents: 1.43 })).ok, false);
  assert.equal(validateListingDraft(Object.assign(draft(), { condition: 'Near Mint' })).ok, false);
  assert.equal(validateListingDraft(Object.assign(draft(), { createdAt: 'yesterday' })).ok, false);
});

test('validateScanRecord', () => {
  const s = { id: 's1', sessionId: 'sess1', at: '2026-10-15T12:00:01Z', printingId: 'mtg:scryfall:abc-123', confidence: 0.97, method: 'ocr', candidates: [{ printingId: 'mtg:scryfall:abc-123', score: 0.97 }], accepted: true };
  assert.equal(validateScanRecord(s).ok, true);
  assert.equal(validateScanRecord(Object.assign({}, s, { printingId: null, accepted: false })).ok, true, 'unresolved scans are allowed');
  assert.equal(validateScanRecord(Object.assign({}, s, { confidence: 1.2 })).ok, false);
  assert.equal(validateScanRecord(Object.assign({}, s, { method: 'psychic' })).ok, false);
});

test('validateInventoryItem', () => {
  const i = { printingId: 'mtg:scryfall:abc-123', condition: 'LP', finish: 'foil', language: 'en', quantity: 3, source: 'import' };
  assert.equal(validateInventoryItem(i).ok, true);
  assert.equal(validateInventoryItem(Object.assign({}, i, { quantity: -1 })).ok, false);
});

test('validateOrder (fake buyer data only)', () => {
  const o = {
    id: 'ORD-1', source: 'tcgplayer', orderedAt: '2026-10-14', status: 'Ready to Ship', buyerKey: 'k1',
    shipTo: { name: 'Pat Example', address1: '1 Test St', city: 'Springfield', state: 'IL', postalCode: '62701', country: 'US' },
    items: [{ name: 'Lightning Bolt', quantity: 2, priceCents: 150 }], itemsTotalCents: 300, shippingPaidCents: 100,
  };
  assert.equal(validateOrder(o).ok, true);
  assert.equal(validateOrder(Object.assign({}, o, { items: [] })).ok, false);
  assert.equal(validateOrder(Object.assign({}, o, { shipTo: { city: 'x' } })).ok, false);
  assert.equal(validateOrder(Object.assign({}, o, { source: 'amazon' })).ok, false);
});

test('validateAutomation and validateAuditEntry', () => {
  const a = { id: 'a1', name: 'Weekly repeat-buyer report', trigger: { type: 'cron', value: '0 8 * * 1' }, steps: [{ tool: 'orders.stats', args: { days: 30 } }], approvalMode: 'always', enabled: true };
  assert.equal(validateAutomation(a).ok, true);
  assert.equal(validateAutomation(Object.assign({}, a, { steps: [] })).ok, false);
  assert.equal(validateAutomation(Object.assign({}, a, { approvalMode: 'whenever' })).ok, false);
  const log = { at: '2026-10-15T12:00:00Z', actor: 'agent', tool: 'support.draft_reply', tier: 'draft', argsHash: 'sha256:abc', outcome: 'ok' };
  assert.equal(validateAuditEntry(log).ok, true);
  assert.equal(validateAuditEntry(Object.assign({}, log, { tier: 'god-mode' })).ok, false);
});
