// Shared contracts for the TCG Speed Suite (Scan, Extension, Agent).
// Dependency-free ES module: runs in a browser, in the extension and in Node.
// Owner: the Builder session. Changing a shape here needs a note in docs/suite/LOG.md first.
// What each field means: docs/suite/DATA-MODEL.md

export const SCHEMA_VERSION = 1;

export const GAMES = ['mtg', 'pokemon', 'yugioh', 'onepiece', 'lorcana', 'fab', 'other'];
export const CONDITIONS = ['NM', 'LP', 'MP', 'HP', 'DMG'];
export const FINISHES = ['nonfoil', 'foil', 'etched', 'holo', 'reverse-holo', 'first-edition', 'unlimited'];
export const SCAN_METHODS = ['ocr', 'embedding', 'llm', 'barcode', 'manual'];
export const LISTING_SOURCES = ['scan', 'manual', 'import'];
export const PRICE_BASES = ['market', 'low', 'mid', 'fixed'];
export const ROUNDINGS = ['cent', 'nickel', 'dime', 'ends-99', 'ends-95', 'dollar'];
export const ORDER_SOURCES = ['tcgplayer', 'ebay', 'whatnot', 'manapool', 'cardmarket', 'other'];
export const TOOL_TIERS = ['read', 'draft', 'act', 'autopilot'];
export const APPROVAL_MODES = ['always', 'first-run', 'never'];
export const ACTORS = ['user', 'agent', 'automation'];
export const OUTCOMES = ['ok', 'error', 'denied'];

const isStr = (v) => typeof v === 'string' && v.trim().length > 0;
const isCents = (v) => Number.isInteger(v) && v >= 0;
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const oneOf = (list, v) => list.includes(v);
const isIso = (v) =>
  typeof v === 'string' &&
  /^\d{4}-\d{2}-\d{2}(T[\d:.]+(Z|[+-]\d{2}:?\d{2})?)?$/.test(v) &&
  !Number.isNaN(Date.parse(v));

function check(errors, condition, message) {
  if (!condition) errors.push(message);
}
function done(errors) {
  return { ok: errors.length === 0, errors };
}

// Money is always whole cents (integers). Never store dollars as floats.
export function dollarsToCents(dollars) {
  const n = typeof dollars === 'string' ? Number(dollars.replace(/[$,\s]/g, '')) : Number(dollars);
  if (!Number.isFinite(n)) return NaN;
  return Math.round((n + Number.EPSILON) * 100);
}
export function centsToDollars(cents) {
  return cents / 100;
}
export function formatUsd(cents) {
  return '$' + (cents / 100).toFixed(2);
}

// Stable card id: game:provider:providerId, e.g. mtg:scryfall:0c1f.... Lower-cased provider.
export function makePrintingId(game, provider, providerId) {
  if (!oneOf(GAMES, game)) throw new Error('unknown game: ' + game);
  if (!isStr(provider)) throw new Error('provider is required');
  if (providerId === undefined || providerId === null || String(providerId).trim() === '') {
    throw new Error('providerId is required');
  }
  return game + ':' + provider.toLowerCase() + ':' + String(providerId).trim();
}

function validatePrices(errors, prices) {
  if (!isObj(prices)) return errors.push('prices must be an object');
  check(errors, isIso(prices.asOf), 'prices.asOf must be an ISO date');
  check(errors, isStr(prices.source), 'prices.source is required (where the number came from)');
  if (!isObj(prices.byFinish)) return errors.push('prices.byFinish must be an object keyed by finish');
  for (const [finish, row] of Object.entries(prices.byFinish)) {
    check(errors, oneOf(FINISHES, finish), 'prices.byFinish has an unknown finish: ' + finish);
    if (!isObj(row)) {
      errors.push('prices.byFinish.' + finish + ' must be an object');
      continue;
    }
    for (const key of ['market', 'low', 'mid']) {
      check(errors, row[key] === undefined || isCents(row[key]), 'prices.byFinish.' + finish + '.' + key + ' must be whole cents');
    }
  }
}

// A card printing from a card database. Never invent tcgplayerProductId: leave it out when unknown.
export function validatePrinting(p) {
  const e = [];
  if (!isObj(p)) return done(['printing must be an object']);
  check(e, isStr(p.id) && p.id.split(':').length >= 3, 'id must look like game:provider:providerId');
  check(e, oneOf(GAMES, p.game), 'game must be one of ' + GAMES.join(', '));
  check(e, isStr(p.name), 'name is required');
  check(e, isStr(p.setCode), 'setCode is required');
  check(e, p.setName === undefined || isStr(p.setName), 'setName must be a non-empty string when present');
  check(e, isStr(p.number), 'number (collector number as printed on the card) is required');
  check(e, Array.isArray(p.finishes) && p.finishes.length > 0 && p.finishes.every((f) => oneOf(FINISHES, f)), 'finishes must be a non-empty list of known finishes');
  check(e, isStr(p.language), 'language is required (for example en)');
  check(
    e,
    p.tcgplayerProductId === undefined || p.tcgplayerProductId === null || (Number.isInteger(p.tcgplayerProductId) && p.tcgplayerProductId > 0),
    'tcgplayerProductId must be a positive integer or absent (never guessed)'
  );
  if (p.prices !== undefined) validatePrices(e, p.prices);
  return done(e);
}

// How a price is worked out from a printing's prices.
export function validatePriceRule(r) {
  const e = [];
  if (!isObj(r)) return done(['price rule must be an object']);
  check(e, isStr(r.id), 'id is required');
  check(e, isStr(r.name), 'name is required');
  check(e, oneOf(PRICE_BASES, r.basis), 'basis must be one of ' + PRICE_BASES.join(', '));
  check(e, typeof r.percent === 'number' && r.percent >= -100 && r.percent <= 500, 'percent must be a number from -100 to 500 (-5 means 5% below)');
  if (r.basis === 'fixed') check(e, isCents(r.fixedCents), 'fixedCents is required when basis is fixed');
  for (const key of ['floorCents', 'ceilingCents', 'minListCents']) {
    check(e, r[key] === undefined || isCents(r[key]), key + ' must be whole cents when present');
  }
  check(e, oneOf(ROUNDINGS, r.rounding), 'rounding must be one of ' + ROUNDINGS.join(', '));
  if (r.conditionMultipliers !== undefined) {
    const m = r.conditionMultipliers;
    check(e, isObj(m) && Object.entries(m).every(([k, v]) => oneOf(CONDITIONS, k) && typeof v === 'number' && v > 0 && v <= 1.5), 'conditionMultipliers must map known conditions to numbers above 0 and at most 1.5');
  }
  return done(e);
}

// One row the seller is about to list.
export function validateListingDraft(d) {
  const e = [];
  if (!isObj(d)) return done(['listing draft must be an object']);
  check(e, isStr(d.id), 'id is required');
  check(e, isStr(d.printingId), 'printingId is required');
  check(e, oneOf(CONDITIONS, d.condition), 'condition must be one of ' + CONDITIONS.join(', '));
  check(e, oneOf(FINISHES, d.finish), 'finish must be one of ' + FINISHES.join(', '));
  check(e, isStr(d.language), 'language is required');
  check(e, Number.isInteger(d.quantity) && d.quantity >= 1, 'quantity must be a whole number of 1 or more');
  check(e, isCents(d.priceCents), 'priceCents must be whole cents');
  check(e, d.priceRuleId === undefined || isStr(d.priceRuleId), 'priceRuleId must be a string when present');
  check(e, oneOf(LISTING_SOURCES, d.source), 'source must be one of ' + LISTING_SOURCES.join(', '));
  check(e, isIso(d.createdAt), 'createdAt must be an ISO date');
  return done(e);
}

// One card recognized by the camera (or typed in).
export function validateScanRecord(s) {
  const e = [];
  if (!isObj(s)) return done(['scan record must be an object']);
  check(e, isStr(s.id), 'id is required');
  check(e, isStr(s.sessionId), 'sessionId is required');
  check(e, isIso(s.at), 'at must be an ISO date');
  check(e, s.printingId === null || isStr(s.printingId), 'printingId must be a string, or null when unresolved');
  check(e, typeof s.confidence === 'number' && s.confidence >= 0 && s.confidence <= 1, 'confidence must be from 0 to 1');
  check(e, oneOf(SCAN_METHODS, s.method), 'method must be one of ' + SCAN_METHODS.join(', '));
  check(
    e,
    Array.isArray(s.candidates) && s.candidates.every((c) => isObj(c) && isStr(c.printingId) && typeof c.score === 'number' && c.score >= 0 && c.score <= 1),
    'candidates must be a list of { printingId, score 0..1 }'
  );
  check(e, typeof s.accepted === 'boolean', 'accepted must be true or false');
  return done(e);
}

// What the seller owns (from Scan sessions or a marketplace export).
export function validateInventoryItem(i) {
  const e = [];
  if (!isObj(i)) return done(['inventory item must be an object']);
  check(e, isStr(i.printingId), 'printingId is required');
  check(e, oneOf(CONDITIONS, i.condition), 'condition must be one of ' + CONDITIONS.join(', '));
  check(e, oneOf(FINISHES, i.finish), 'finish must be one of ' + FINISHES.join(', '));
  check(e, isStr(i.language), 'language is required');
  check(e, Number.isInteger(i.quantity) && i.quantity >= 0, 'quantity must be a whole number, 0 or more');
  check(e, i.priceCents === undefined || isCents(i.priceCents), 'priceCents must be whole cents when present');
  check(e, i.location === undefined || isStr(i.location), 'location must be a string when present');
  check(e, oneOf(LISTING_SOURCES, i.source), 'source must be one of ' + LISTING_SOURCES.join(', '));
  return done(e);
}

// A marketplace order. Contains buyer details: keep it on the seller's device, never in logs or fixtures
// (use made-up names and addresses in tests).
export function validateOrder(o) {
  const e = [];
  if (!isObj(o)) return done(['order must be an object']);
  check(e, isStr(o.id), 'id is required');
  check(e, oneOf(ORDER_SOURCES, o.source), 'source must be one of ' + ORDER_SOURCES.join(', '));
  check(e, isIso(o.orderedAt), 'orderedAt must be an ISO date');
  check(e, isStr(o.status), 'status is required');
  check(e, isStr(o.buyerKey), 'buyerKey is required (a local pseudonymous key used to spot repeat buyers)');
  if (!isObj(o.shipTo)) e.push('shipTo must be an object');
  else {
    for (const key of ['address1', 'city', 'state', 'postalCode', 'country']) check(e, isStr(o.shipTo[key]), 'shipTo.' + key + ' is required');
  }
  check(
    e,
    Array.isArray(o.items) && o.items.length > 0 && o.items.every((it) => isObj(it) && isStr(it.name) && Number.isInteger(it.quantity) && it.quantity >= 1 && isCents(it.priceCents)),
    'items must be a non-empty list of { name, quantity >= 1, priceCents }'
  );
  check(e, isCents(o.itemsTotalCents), 'itemsTotalCents must be whole cents');
  check(e, isCents(o.shippingPaidCents), 'shippingPaidCents must be whole cents');
  check(e, o.trackingNumber === undefined || isStr(o.trackingNumber), 'trackingNumber must be a string when present');
  check(e, o.shippedAt === undefined || isIso(o.shippedAt), 'shippedAt must be an ISO date when present');
  return done(e);
}

// A saved automation for the Agent. Anything that acts needs approval unless the owner set it to never.
export function validateAutomation(a) {
  const e = [];
  if (!isObj(a)) return done(['automation must be an object']);
  check(e, isStr(a.id), 'id is required');
  check(e, isStr(a.name), 'name is required');
  check(e, isObj(a.trigger) && oneOf(['cron', 'event'], a.trigger.type) && isStr(a.trigger.value), 'trigger must be { type: cron|event, value }');
  check(e, Array.isArray(a.steps) && a.steps.length > 0 && a.steps.every((s) => isObj(s) && isStr(s.tool) && (s.args === undefined || isObj(s.args))), 'steps must be a non-empty list of { tool, args? }');
  check(e, oneOf(APPROVAL_MODES, a.approvalMode), 'approvalMode must be one of ' + APPROVAL_MODES.join(', '));
  check(e, typeof a.enabled === 'boolean', 'enabled must be true or false');
  check(e, a.lastRunAt === undefined || isIso(a.lastRunAt), 'lastRunAt must be an ISO date when present');
  return done(e);
}

// One line of the Agent's audit log: what ran, who approved it.
export function validateAuditEntry(a) {
  const e = [];
  if (!isObj(a)) return done(['audit entry must be an object']);
  check(e, isIso(a.at), 'at must be an ISO date');
  check(e, oneOf(ACTORS, a.actor), 'actor must be one of ' + ACTORS.join(', '));
  check(e, isStr(a.tool), 'tool is required');
  check(e, oneOf(TOOL_TIERS, a.tier), 'tier must be one of ' + TOOL_TIERS.join(', '));
  check(e, isStr(a.argsHash), 'argsHash is required (a hash, never the raw arguments)');
  check(e, oneOf(OUTCOMES, a.outcome), 'outcome must be one of ' + OUTCOMES.join(', '));
  check(e, a.approvedBy === undefined || isStr(a.approvedBy), 'approvedBy must be a string when present');
  return done(e);
}
