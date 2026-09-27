/* TCGplayer marketplace fee calculator (blog/tcgplayer-fees-explained.html).
   Rates from https://help.tcgplayer.com/hc/en-us/articles/201357836 and the
   worked examples in 360047732673. Each fee line is rounded to the cent with
   banker's rounding, as TCGplayer does. */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.TCGFeeCalc = api;
})(this, function () {
  var SELLER_TYPES = {
    level: { commission: 0.1075, pro: 0 },
    pro: { commission: 0.0925, pro: 0.025 }
  };
  var PER_PRODUCT_CAP = 75;

  function toCents(x) { return Math.round(x * 100); }

  function roundHalfEven(dollars) {
    var c = dollars * 100;
    var f = Math.floor(c);
    var diff = c - f;
    var cents;
    if (Math.abs(diff - 0.5) < 1e-7) cents = f % 2 === 0 ? f : f + 1;
    else cents = Math.round(c);
    return cents / 100;
  }

  function cappedPerProduct(price, qty, rate) {
    return roundHalfEven(Math.min(price * rate, PER_PRODUCT_CAP) * qty);
  }

  function compute(input) {
    var t = SELLER_TYPES[input.sellerType] || SELLER_TYPES.level;
    var price = Math.max(0, +input.price || 0);
    var qty = Math.max(1, Math.floor(+input.qty || 1));
    var shipping = Math.max(0, +input.shipping || 0);
    var taxRate = Math.max(0, +input.taxRate || 0) / 100;
    var intl = !!input.international;
    var postage = Math.max(0, +input.postage || 0);
    var cost = Math.max(0, +input.cost || 0);

    var items = toCents(price * qty) / 100;
    var subtotal = toCents(items + shipping) / 100;
    var tax = roundHalfEven(subtotal * taxRate);
    var orderTotal = toCents(subtotal + tax) / 100;

    var lines = {
      commissionItems: cappedPerProduct(price, qty, t.commission),
      commissionShipping: roundHalfEven(shipping * t.commission),
      proItems: t.pro ? cappedPerProduct(price, qty, t.pro) : 0,
      proShipping: t.pro ? roundHalfEven(shipping * t.pro) : 0,
      transaction: roundHalfEven(orderTotal * (intl ? 0.035 : 0.025) + 0.30)
    };
    var totalFees = toCents(lines.commissionItems + lines.commissionShipping +
      lines.proItems + lines.proShipping + lines.transaction) / 100;
    var payout = toCents(subtotal - totalFees) / 100;
    var profit = toCents(payout - postage - cost) / 100;
    return {
      items: items, subtotal: subtotal, tax: tax, orderTotal: orderTotal,
      lines: lines, totalFees: totalFees,
      feePercent: subtotal > 0 ? totalFees / subtotal * 100 : 0,
      payout: payout, profit: profit
    };
  }

  function money(n) { return (n < 0 ? '−$' : '$') + Math.abs(n).toFixed(2); }

  function bind(form) {
    var out = function (name) { return form.querySelector('[data-out="' + name + '"]'); };
    function update() {
      var v = function (n) { return form.elements[n].value; };
      var r = compute({
        sellerType: v('sellerType'), price: v('price'), qty: v('qty'),
        shipping: v('shipping'), taxRate: v('taxRate'),
        international: form.elements.international.checked,
        postage: v('postage'), cost: v('cost')
      });
      out('subtotal').textContent = money(r.subtotal);
      out('orderTotal').textContent = money(r.orderTotal);
      out('commission').textContent = money(r.lines.commissionItems + r.lines.commissionShipping);
      out('pro').textContent = money(r.lines.proItems + r.lines.proShipping);
      out('proRow').hidden = v('sellerType') !== 'pro';
      out('transaction').textContent = money(r.lines.transaction);
      var feesCell = out('totalFees');
      feesCell.textContent = money(r.totalFees);
      var pct = document.createElement('small');
      pct.className = 'fc-pct';
      pct.textContent = r.feePercent.toFixed(1) + '% of subtotal';
      feesCell.appendChild(pct);
      out('payout').textContent = money(r.payout);
      out('profit').textContent = money(r.profit);
    }
    form.addEventListener('input', update);
    form.addEventListener('change', update);
    form.addEventListener('submit', function (e) { e.preventDefault(); });
    update();
  }

  if (typeof document !== 'undefined') {
    var init = function () {
      var f = document.getElementById('fee-calc');
      if (f) bind(f);
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
  }

  return { compute: compute, roundHalfEven: roundHalfEven };
});
