// Files copied from elsewhere in suite/ into src/vendor/, keeping their folder layout so their own
// relative imports keep working. An extension cannot load files outside its folder.
// To refresh after the source changes: npm run vendor   (a test fails when a copy is out of date)
// Deliberately NOT copied: agent/fixtures/orders.js (it reads files with node:fs; the extension has its own
// made-up shop in src/agent-host/shop.js).
export const VENDORED = [
  'shared/models.js',
  'scan/core/pricing.js',
  'scan/core/csv.js',
  'agent/loop.js',
  'agent/registry.js',
  'agent/audit.js',
  'agent/limits.js',
  'agent/protocol.js',
  'agent/analytics.js',
  'agent/support.js',
  'agent/deals.js',
  'agent/tools/index.js',
  'agent/sync/csv.js',
  'agent/fixtures/deals.js'
];
