// A tiny made-up shop for practice mode: invented cards, invented buyers, a seeded random source so
// it is the same every time. No real people, no real data. (The Agent's own bigger fixture reads files
// with node:fs and cannot run inside an extension, so this one is separate.)
import { validatePrinting, validateOrder } from '../vendor/shared/models.js';

export const SHOP_NOW = '2026-10-15T12:00:00Z';

const NAMES = ['Ember Drake', 'Quiet Grove', 'Tide Warden', 'Iron Sparrow', 'Moss Golem', 'Dusk Herald', 'Glass Fox', 'Stone Pilgrim'];
const BUYERS = ['Ada Alder', 'Bram Birch', 'Cleo Cobb', 'Dax Dunmore', 'Edda Ellery', 'Finn Fenwick', 'Gwen Garrow', 'Hugo Hale', 'Iris Ivers', 'Jory Juniper'];
const PLACES = [['Springfield', 'IL', '62701'], ['Portland', 'OR', '97201'], ['Austin', 'TX', '78701'], ['Denver', 'CO', '80201'], ['Boston', 'MA', '02108']];

function seeded(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function makePrintings() {
  return NAMES.map((name, i) => ({
    id: 'mtg:practice:p' + (i + 1), game: 'mtg', name, setCode: 'PRC', setName: 'Practice Set', number: String(i + 1),
    finishes: ['nonfoil', 'foil'], language: 'en',
    prices: { asOf: '2026-10-14', source: 'practice data', byFinish: { nonfoil: { market: 50 + i * 35, low: 40 + i * 30, mid: 55 + i * 36 }, foil: { market: 120 + i * 60 } } }
  }));
}

export function makeOrders(printings, count = 60) {
  const rand = seeded(7);
  const end = Date.parse(SHOP_NOW);
  const orders = [];
  for (let n = 0; n < count; n++) {
    const b = Math.floor(rand() ** 1.6 * BUYERS.length);
    const [city, state, postalCode] = PLACES[b % PLACES.length];
    const when = new Date(end - rand() * 60 * 86400000);
    const p = printings[Math.floor(rand() * printings.length)];
    const quantity = 1 + Math.floor(rand() * 3);
    const priceCents = p.prices.byFinish.nonfoil.market;
    const itemsTotalCents = quantity * priceCents;
    const shipped = (end - when.getTime()) / 86400000 > 1.5;
    const order = {
      id: 'PRC-' + (1000 + n), source: 'tcgplayer', orderedAt: when.toISOString().replace(/\.\d+Z$/, 'Z'), status: shipped ? 'shipped' : 'paid',
      buyerKey: 'buyer-' + String(b + 1).padStart(3, '0'),
      shipTo: { name: BUYERS[b], address1: String(100 + b * 7) + ' Example St', city, state, postalCode, country: 'US' },
      items: [{ name: p.name, quantity, priceCents, setName: p.setName, number: p.number, condition: 'NM', finish: 'nonfoil' }],
      itemsTotalCents, shippingPaidCents: 99
    };
    if (shipped) {
      order.shippedAt = new Date(when.getTime() + 86400000).toISOString().replace(/\.\d+Z$/, 'Z');
      order.trackingNumber = 'PRCTRK' + (900000 + n);
      order.carrier = 'USPS';
    }
    orders.push(order);
  }
  return orders.sort((a, b) => a.orderedAt.localeCompare(b.orderedAt));
}

export function makeInventory(printings) {
  return printings.map((p, i) => ({
    printingId: p.id, condition: 'NM', finish: 'nonfoil', language: 'en', quantity: i % 3 === 0 ? 0 : i % 3 === 1 ? 2 : 9,
    priceCents: p.prices.byFinish.nonfoil.market, location: 'Box ' + (1 + (i % 3)), source: 'import'
  }));
}

export function makeMessages(orders) {
  const o = (i) => orders[Math.min(i, orders.length - 1)].id;
  return [
    { id: 'msg-1', orderId: o(2), receivedAt: '2026-10-10T09:00:00Z', text: 'Hi, where is my order? It has been a week.', answered: false },
    { id: 'msg-2', orderId: o(5), receivedAt: '2026-10-11T15:30:00Z', text: 'The card arrived creased.', answered: true },
    { id: 'msg-3', orderId: o(9), receivedAt: '2026-10-14T20:00:00Z', text: 'When will my order arrive?', answered: false }
  ];
}

export function makeShop() {
  const printings = makePrintings();
  const orders = makeOrders(printings);
  const inventory = makeInventory(printings);
  for (const p of printings) if (!validatePrinting(p).ok) throw new Error('bad practice printing ' + p.id);
  for (const o of orders) if (!validateOrder(o).ok) throw new Error('bad practice order ' + o.id);
  return { printings, orders, inventory, messages: makeMessages(orders), now: SHOP_NOW };
}
