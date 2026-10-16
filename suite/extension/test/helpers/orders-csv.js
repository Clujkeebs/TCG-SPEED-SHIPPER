// Invented order exports for tests: made-up people, made-up streets, a seeded random source. Never real data.
const FIRST = ['Ada', 'Bram', 'Cleo', 'Dax', 'Edda', 'Finn', 'Gwen', 'Hugo', 'Iris', 'Jory', 'Kira', 'Lars', 'Mina', 'Nico', 'Odie', 'Pru', 'Quin', 'Rhea', 'Sol', 'Tess'];
const LAST = ['Alder', 'Birch', 'Cobb', 'Dunmore', 'Ellery', 'Fenwick', 'Garrow', 'Hale', 'Ivers', 'Juniper', 'Kettle', 'Lowry', 'Marlow', 'Nettle', 'Orchard'];
const PLACES = [['Springfield', 'IL', '62701'], ['Portland', 'OR', '97201'], ['Austin', 'TX', '78701'], ['Denver', 'CO', '80201'], ['Boston', 'MA', '02108'], ['Tampa', 'FL', '33601'], ['Phoenix', 'AZ', '85001'], ['Madison', 'WI', '53701']];
export const HEADER = 'Order #,FirstName,LastName,Address1,Address2,City,State,PostalCode,Country,Order Date,Product Weight,Shipping Method,Item Count,Value Of Products,Shipping Fee Paid,Tracking #,Carrier';
export const LAST_NAMES = LAST;

function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// rows: how many orders; the newest is on 2026-10-10.
export function makeOrderCsv(rows = 2000, { seed = 3, buyers = 300 } = {}) {
  const r = rng(seed);
  const people = Array.from({ length: buyers }, (_, i) => ({ first: FIRST[i % FIRST.length], last: LAST[(i * 7 + 3) % LAST.length] + (i >= 300 ? 'x' : ''), place: PLACES[Math.floor(r() ** 1.4 * PLACES.length)], n: i }));
  const out = [HEADER];
  const end = Date.UTC(2026, 9, 10, 12);
  for (let i = 0; i < rows; i++) {
    const p = people[Math.floor(r() ** 1.8 * buyers)];
    const d = new Date(end - Math.floor(r() * 120 * 86400000));
    const count = 1 + Math.floor(r() * 4);
    const cents = 100 + Math.floor(r() * 4000);
    const shipped = r() < 0.6;
    out.push([`INV-${String(100000 + i)}`, p.first, p.last, `${100 + p.n} Example St`, r() < 0.1 ? 'Apt 2' : '', p.place[0], p.place[1], p.place[2], 'US', `${d.getUTCMonth() + 1}/${d.getUTCDate()}/${d.getUTCFullYear()}`, '0.12', 'Standard (7-10 days)', count, (cents / 100).toFixed(2), '0.99', shipped ? `9400${String(i).padStart(10, '0')}` : '', shipped ? 'USPS' : ''].join(','));
  }
  return out.join('\r\n') + '\r\n';
}
