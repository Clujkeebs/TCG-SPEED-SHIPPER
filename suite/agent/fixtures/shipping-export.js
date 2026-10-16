// An invented TCGplayer-style shipping export, same columns the Shipper reads. Fake people, fake streets.
// Seeded, so the same every time. `withTime` adds a time of day to "Order Date" (the real export may not).
import { seededRandom } from './orders.js';

const FIRST = ['Ada', 'Bram', 'Cleo', 'Dax', 'Edda', 'Finn', 'Gwen', 'Hugo', 'Iris', 'Jory', 'Kira', 'Lars', 'Mina', 'Nico', 'Odie', 'Pru', 'Quin', 'Rhea', 'Sol', 'Tess', 'Uma', 'Vik', 'Wren', 'Xan', 'Yara', 'Zeke', 'Abel', 'Bea', 'Cass', 'Dov', 'Esme', 'Flo', 'Gus', 'Hal', 'Ines', 'Jax', 'Kit', 'Lou', 'Moe', 'Nell'];
const LAST = ['Alder', 'Birch', 'Cobb', 'Dunmore', 'Ellery', 'Fenwick', 'Garrow', 'Hale', 'Ivers', 'Juniper', 'Kettle', 'Lowry', 'Marlow', 'Nettle', 'Orchard', 'Pike', 'Quill', 'Rowan', 'Sedge', 'Thorn', 'Umber', 'Vale', 'Wick', 'Yarrow', 'Ziller', 'Ash', 'Bell', 'Crane', 'Dale', 'Elm', 'Finch', 'Grove', 'Heath', 'Isle', 'Jett', 'Knoll', 'Lark', 'Moss', 'Nash', 'Oak'];
const PLACES = [['Springfield', 'IL', '62701'], ['Portland', 'OR', '97201'], ['Austin', 'TX', '78701'], ['Columbus', 'OH', '43004'], ['Denver', 'CO', '80201'], ['Tampa', 'FL', '33601'], ['Boston', 'MA', '02108'], ['Phoenix', 'AZ', '85001'], ['Seattle', 'WA', '98101'], ['Raleigh', 'NC', '27601'], ['Madison', 'WI', '53701'], ['Newark', 'NJ', '07101'], ['Houston', 'TX', '77001'], ['Dallas', 'TX', '75201'], ['Los Angeles', 'CA', '90012'], ['San Jose', 'CA', '95101'], ['Miami', 'FL', '33101'], ['Atlanta', 'GA', '30301']];
const METHODS = ['Standard (7-10 days)', 'Standard (7-10 days)', 'Standard (7-10 days)', 'Expedited'];

export const SHIPPING_HEADER = 'Order #,FirstName,LastName,Address1,Address2,City,State,PostalCode,Country,Order Date,Product Weight,Shipping Method,Item Count,Value Of Products,Shipping Fee Paid,Tracking #,Carrier';

export function makeShippingExportCsv({ rows = 10000, seed = 21, buyers = 1800, endDate = '2026-10-15', days = 84, withTime = false, eol = '\r\n' } = {}) {
  const rand = seededRandom(seed);
  const pool = [];
  for (let i = 0; i < buyers; i += 1) {
    const place = PLACES[Math.floor(rand() ** 1.6 * PLACES.length)];
    const zip = place[2].slice(0, 3) + String(10 + Math.floor(rand() * 89));
    pool.push({ first: FIRST[i % FIRST.length], last: LAST[Math.floor(i / FIRST.length) % LAST.length] + (i >= 1600 ? 'son' : ''), addr: String(100 + i) + ' Example St', city: place[0], state: place[1], zip, weight: i < 120 ? 8 : i < 400 ? 3 : 1 });
  }
  const bag = pool.flatMap((b) => Array(b.weight).fill(b));
  const end = Date.parse(endDate + 'T00:00:00Z');
  const lines = [SHIPPING_HEADER];
  for (let n = 0; n < rows; n += 1) {
    const b = bag[Math.floor(rand() * bag.length)];
    const day = new Date(end - Math.floor(rand() * days) * 86400000);
    const dow = day.getUTCDay();
    const when = (dow === 0 || dow === 6 || rand() < 0.6) ? day : new Date(day.getTime() - 86400000);
    const date = `${when.getUTCMonth() + 1}/${when.getUTCDate()}/${when.getUTCFullYear()}`;
    const hour = Math.min(23, Math.floor(8 + rand() * rand() * 15));
    const stamp = withTime ? `${date} ${hour}:${String(Math.floor(rand() * 60)).padStart(2, '0')}` : date;
    const r = rand();
    const value = r < 0.62 ? 1 + rand() * 18.9 : r < 0.86 ? 20.01 + rand() * 29.9 : r < 0.985 ? 49.99 + rand() * 199 : 250 + rand() * 300;
    const tracked = value >= 49.99 && rand() < 0.8;
    const lastName = b.last.includes(',') || b.last.includes('"') ? '"' + b.last.replace(/"/g, '""') + '"' : b.last;
    lines.push([`T${100000 + n}-${1 + (n % 3)}`, b.first, lastName, b.addr, '', b.city, b.state, b.zip, 'US', stamp, (0.1 + rand() * 0.6).toFixed(2), METHODS[Math.floor(rand() * METHODS.length)], 1 + Math.floor(rand() * 8), value.toFixed(2), value < 5 ? '1.49' : '0.99', tracked ? '9400' + String(100000 + n) : '', tracked ? 'USPS' : ''].join(','));
  }
  return lines.join(eol) + eol;
}
