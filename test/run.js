/* Each suite stubs Stripe/Supabase differently and loads server.js fresh, so
   they run as separate processes rather than in one. */
const { spawnSync } = require('child_process');
const path = require('path');

const suites = ['signup.test.js', 'checkout.test.js', 'webhook-signature.test.js', 'referral.test.js'];
let failed = 0;

for (const suite of suites) {
  console.log('\n========== ' + suite + ' ==========');
  const r = spawnSync(process.execPath, [path.join(__dirname, suite)], { stdio: 'inherit' });
  if (r.status !== 0) failed++;
}

console.log('\n' + (failed ? failed + ' of ' + suites.length + ' suites FAILED' : 'All ' + suites.length + ' suites passed'));
process.exit(failed ? 1 : 0);
