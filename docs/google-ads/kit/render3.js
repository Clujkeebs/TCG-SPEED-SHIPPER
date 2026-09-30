const { chromium } = require('playwright');
const variants = {
  'orders-to-labels': 'Orders to <em>labels</em><br>in seconds.',
  'card-lists-on-slips': 'Card lists on<br>every <em>slip</em>.',
  'ten-free-labels': '<em>10 free</em> labels<br>every month.',
  'pwe-envelopes': 'PWE envelopes,<br><em>printed</em>.',
};
const sizes = { landscape: [1200, 628], square: [1200, 1200], portrait: [960, 1200] };
(async () => {
  const b = await chromium.launch();
  for (const [name, t] of Object.entries(variants)) for (const [v, [w, h]] of Object.entries(sizes)) {
    const p = await b.newPage({ viewport: { width: w, height: h } });
    await p.goto('file:///tmp/claude-0/-home-user-TCG-SPEED-SHIPPER/dfc3e83d-b55e-5102-aedc-c02a56d9be81/scratchpad/kit/ads2.html?v=' + v + '&t=' + encodeURIComponent(t)); await p.evaluate(() => document.fonts.ready); await p.waitForTimeout(250);
    await p.screenshot({ path: '/tmp/claude-0/-home-user-TCG-SPEED-SHIPPER/dfc3e83d-b55e-5102-aedc-c02a56d9be81/scratchpad/kit/out/' + name + '_' + v + '_' + w + 'x' + h + '.png' }); await p.close();
  }
  for (const [v, [w, h]] of Object.entries(sizes)) {
    const p = await b.newPage({ viewport: { width: w, height: h } });
    await p.goto('file:///tmp/claude-0/-home-user-TCG-SPEED-SHIPPER/dfc3e83d-b55e-5102-aedc-c02a56d9be81/scratchpad/kit/ads2.html?v=' + v + '&notext=1'); await p.evaluate(() => document.fonts.ready); await p.waitForTimeout(250);
    await p.screenshot({ path: '/tmp/claude-0/-home-user-TCG-SPEED-SHIPPER/dfc3e83d-b55e-5102-aedc-c02a56d9be81/scratchpad/kit/out/product-only_' + v + '_' + w + 'x' + h + '.png' }); await p.close();
  }
  // transparent square icon
  const p = await b.newPage({ viewport: { width: 1200, height: 1200 } });
  await p.goto('file:///home/user/TCG-SPEED-SHIPPER/public/favicon.svg');
  await p.waitForTimeout(300); await p.screenshot({ path: '/tmp/claude-0/-home-user-TCG-SPEED-SHIPPER/dfc3e83d-b55e-5102-aedc-c02a56d9be81/scratchpad/kit/out/logo-icon-transparent_1200x1200.png', omitBackground: true });
  await b.close();
})();
