// An invented Seller Portal inventory export, built from the fixture stock. Made-up rows, no real shop.
// Planted on purpose: cards listed far over and far under market, a duplicate row, a row that is not a known
// card, a blank price, and a column we do not use. Header names are the guessed TCGplayer style (unverified).
import { toCsv } from '../sync/csv.js';

const COND = { NM: 'Near Mint', LP: 'Lightly Played', MP: 'Moderately Played', HP: 'Heavily Played', DMG: 'Damaged' };

export function makeSellerExport({ printings, inventory }) {
  const byId = new Map(printings.map((p) => [p.id, p]));
  const rows = [['TCGplayer Id', 'Product Name', 'Set Name', 'Condition', 'Printing', 'Total Quantity', 'TCG Market Price', 'TCG Marketplace Price', 'Photo URL']];
  let n = 0;
  for (const i of inventory) {
    const p = byId.get(i.printingId);
    const market = p && p.prices && p.prices.byFinish[i.finish] && p.prices.byFinish[i.finish].market;
    if (!p || !market || i.quantity <= 0) continue;
    n += 1;
    let price = market; // listed at market
    if (n % 7 === 0) price = Math.round(market * 1.6); // way over
    if (n % 11 === 0) price = Math.round(market * 0.6); // way under
    rows.push([String(900000 + n), p.name, p.setName || p.setCode, COND[i.condition], i.finish === 'nonfoil' ? 'Normal' : i.finish === 'foil' ? 'Foil' : i.finish, String(i.quantity), (market / 100).toFixed(2), (price / 100).toFixed(2), 'https://photos.example.invalid/' + n]);
    if (n === 3) rows.push(rows.at(-1).slice()); // duplicate row
  }
  rows.push(['900999', 'Made Up Card', 'Nowhere Set', 'Near Mint', 'Normal', '1', '1.00', '1.00', '']); // not a known card
  const firstReal = rows[1];
  rows.push([...firstReal.slice(0, 7), '0.00', '']); // blank price on a duplicate-free copy is skipped as duplicate; add a distinct one below
  return toCsv(rows);
}
