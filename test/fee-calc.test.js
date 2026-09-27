/* Fee calculator checked against TCGplayer's own worked examples
   (help.tcgplayer.com "Fee Calculation Examples", 7% sales tax). */
const calc = require('../public/js/fee-calc.js');

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? '  ' + extra : '')); }
}
const near = (a, b) => Math.abs(a - b) < 0.0001;

console.log('-- Level 1-4, $65.31 item + $0.99 shipping --');
let r = calc.compute({ sellerType: 'level', price: 65.31, qty: 1, shipping: 0.99, taxRate: 7 });
check('order total $70.94', near(r.orderTotal, 70.94), r.orderTotal);
check('commission on item $7.02', near(r.lines.commissionItems, 7.02), r.lines.commissionItems);
check('commission on shipping $0.11', near(r.lines.commissionShipping, 0.11), r.lines.commissionShipping);
check('transaction fee $2.07', near(r.lines.transaction, 2.07), r.lines.transaction);
check('total fees $9.20', near(r.totalFees, 9.20), r.totalFees);
check('payout $57.10', near(r.payout, 57.10), r.payout);

console.log('-- Level 1-4, $260 item + $8.82 shipping --');
r = calc.compute({ sellerType: 'level', price: 260, qty: 1, shipping: 8.82, taxRate: 7 });
check('order total $287.64', near(r.orderTotal, 287.64), r.orderTotal);
check('total fees $36.39', near(r.totalFees, 36.39), r.totalFees);

console.log('-- Pro (non-Direct), $65.31 item + $0.99 shipping --');
r = calc.compute({ sellerType: 'pro', price: 65.31, qty: 1, shipping: 0.99, taxRate: 7 });
check('commission $6.04 + $0.09', near(r.lines.commissionItems, 6.04) && near(r.lines.commissionShipping, 0.09));
check('pro fee $1.63 + $0.02', near(r.lines.proItems, 1.63) && near(r.lines.proShipping, 0.02));
check('total fees $9.85', near(r.totalFees, 9.85), r.totalFees);

console.log('-- Caps, quantity, international, profit --');
r = calc.compute({ sellerType: 'level', price: 1000, qty: 2, shipping: 0, taxRate: 0 });
check('commission capped at $75 per product sold', near(r.lines.commissionItems, 150), r.lines.commissionItems);
r = calc.compute({ sellerType: 'level', price: 1, qty: 1, shipping: 0, taxRate: 0, international: true });
check('international transaction fee is 3.5% + $0.30', near(r.lines.transaction, 0.34), r.lines.transaction);
r = calc.compute({ sellerType: 'level', price: 65.31, qty: 1, shipping: 0.99, taxRate: 7, postage: 5.2, cost: 30 });
check('profit subtracts postage and card cost', near(r.profit, 57.10 - 5.2 - 30), r.profit);
check('banker\'s rounding sends a half cent to the even cent', calc.roundHalfEven(0.125) === 0.12 && calc.roundHalfEven(0.135) === 0.14);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
