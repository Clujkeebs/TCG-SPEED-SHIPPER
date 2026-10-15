// Made-up orders for tests and demos: fake people, fake streets, a seeded random source so the data is
// the same on every run. Never real buyers. About 6 months of orders ending on `end`.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const FIXTURE_NOW = '2026-10-15T12:00:00Z';

const FIRST = ['Ada', 'Bram', 'Cleo', 'Dax', 'Edda', 'Finn', 'Gwen', 'Hugo', 'Iris', 'Jory', 'Kira', 'Lars', 'Mina', 'Nico', 'Odie', 'Pru', 'Quin', 'Rhea', 'Sol', 'Tess'];
const LAST = ['Alder', 'Birch', 'Cobb', 'Dunmore', 'Ellery', 'Fenwick', 'Garrow', 'Hale', 'Ivers', 'Juniper', 'Kettle', 'Lowry', 'Marlow', 'Nettle', 'Orchard'];
const PLACES = [
  ['Springfield', 'IL', '62701'], ['Portland', 'OR', '97201'], ['Austin', 'TX', '78701'], ['Columbus', 'OH', '43004'],
  ['Denver', 'CO', '80201'], ['Tampa', 'FL', '33601'], ['Boston', 'MA', '02108'], ['Phoenix', 'AZ', '85001'],
  ['Seattle', 'WA', '98101'], ['Raleigh', 'NC', '27601'], ['Madison', 'WI', '53701'], ['Newark', 'NJ', '07101'],
];

export function seededRandom(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function loadPrintings() {
  const path = fileURLToPath(new URL('../../scan/data/sample/printings.json', import.meta.url));
  return JSON.parse(readFileSync(path, 'utf8'));
}

export function makeBuyers(rand, count = 70) {
  const buyers = [];
  for (let i = 0; i < count; i++) {
    const [city, state, postalCode] = PLACES[Math.floor(rand() ** 1.5 * PLACES.length)];
    buyers.push({
      buyerKey: 'buyer-' + String(i + 1).padStart(3, '0'),
      name: FIRST[i % FIRST.length] + ' ' + LAST[(i * 7 + 3) % LAST.length],
      shipTo: { address1: String(100 + i * 3) + ' Example St', city, state, postalCode, country: 'US' },
      // a few buyers order a lot; most order once or twice
      weight: i < 8 ? 6 : i < 20 ? 2 : 1,
    });
  }
  return buyers;
}

export function makeOrders({ seed = 7, count = 320, end = FIXTURE_NOW, days = 183, printings = loadPrintings() } = {}) {
  const rand = seededRandom(seed);
  const buyers = makeBuyers(rand);
  const pool = buyers.flatMap((b) => Array(b.weight).fill(b));
  const endMs = Date.parse(end);
  const orders = [];
  for (let n = 0; n < count; n++) {
    const buyer = pool[Math.floor(rand() * pool.length)];
    // more orders on weekends: retry the day once if it lands on a weekday
    let ageDays = rand() * days;
    let when = new Date(endMs - ageDays * 86400000);
    if (![0, 6].includes(when.getUTCDay()) && rand() < 0.35) when = new Date(endMs - rand() * days * 86400000);
    const lines = 1 + Math.floor(rand() * 3);
    const items = [];
    for (let l = 0; l < lines; l++) {
      const p = printings[Math.floor(rand() ** 1.4 * printings.length)];
      const finish = p.finishes[0];
      const unit = ((p.prices && p.prices.byFinish[finish] && p.prices.byFinish[finish].market) || 100);
      items.push({ name: p.name, quantity: 1 + Math.floor(rand() * rand() * 4), priceCents: unit, setName: p.setName, number: p.number, condition: 'NM', finish });
    }
    const itemsTotalCents = items.reduce((s, it) => s + it.quantity * it.priceCents, 0);
    const ageNow = (endMs - when.getTime()) / 86400000;
    const status = (ageNow < 1.2 && rand() < 0.5) || ageNow < 0.5 || (ageNow > 2.5 && ageNow < 8 && rand() < 0.08) ? 'paid' : 'shipped';
    const order = {
      id: 'ORD-' + String(1000 + n),
      source: 'tcgplayer',
      orderedAt: when.toISOString().replace(/\.\d+Z$/, 'Z'),
      status,
      buyerKey: buyer.buyerKey,
      shipTo: { name: buyer.name, ...buyer.shipTo },
      items,
      itemsTotalCents,
      shippingPaidCents: itemsTotalCents >= 5000 ? 0 : 99,
    };
    if (status === 'shipped') {
      const lag = Math.floor(rand() * 4) + (rand() < 0.1 ? 3 : 0);
      order.shippedAt = new Date(when.getTime() + lag * 86400000).toISOString().replace(/\.\d+Z$/, 'Z');
      order.trackingNumber = 'TRK' + String(900000 + n);
      order.carrier = 'USPS';
    }
    orders.push(order);
  }
  return orders.sort((a, b) => a.orderedAt.localeCompare(b.orderedAt));
}

// Stock levels for the sample printings: some plentiful, some low, some sold out.
export function makeInventory({ seed = 11, printings = loadPrintings() } = {}) {
  const rand = seededRandom(seed);
  const rows = printings.map((p, i) => ({
    printingId: p.id,
    condition: 'NM',
    finish: p.finishes[0],
    language: p.language,
    quantity: i % 5 === 0 ? 0 : Math.floor(rand() * rand() * 12),
    priceCents: (p.prices && p.prices.byFinish[p.finishes[0]] && p.prices.byFinish[p.finishes[0]].market) || undefined,
    location: 'Box ' + (1 + (i % 6)),
    source: 'import',
  }));
  // some foil copies too, listed a little high so a reprice has something to do
  printings.forEach((p, i) => {
    const foil = p.prices && p.prices.byFinish.foil && p.prices.byFinish.foil.market;
    if (!p.finishes.includes('foil') || !foil || i % 3 !== 0) return;
    rows.push({ printingId: p.id, condition: 'NM', finish: 'foil', language: p.language, quantity: 1 + Math.floor(rand() * 5), priceCents: Math.round(foil * 1.12), location: 'Box ' + (1 + (i % 6)), source: 'import' });
  });
  return rows;
}
