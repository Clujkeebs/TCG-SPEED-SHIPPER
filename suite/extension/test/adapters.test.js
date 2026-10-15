import { test } from 'node:test';
import assert from 'node:assert/strict';
import { guardedAdapter, buyerKeyFor } from '../src/adapters/index.js';
import { PAGES } from '../src/adapters/selectors.js';
import { memoryArea, setFlag } from '../src/flags.js';

test('no adapter is handed out while the flag is off or the TOS gate is closed', async () => {
  const area = memoryArea();
  assert.equal(await guardedAdapter('pasteTracking', {}, {}, { area }), null);
  await setFlag('pasteTracking', true, area);
  assert.equal(await guardedAdapter('pasteTracking', {}, {}, { area }), null, 'flag on but TOS_OK is false');
  const doc = { querySelector: () => null, location: { href: 'x' } };
  assert.notEqual(await guardedAdapter('pasteTracking', doc, {}, { area, tosOk: true }), null);
});

test('adapters default to dry run', async () => {
  const area = memoryArea();
  await setFlag('printShipping', true, area);
  const a = await guardedAdapter('printShipping', { querySelector: () => null }, {}, { area, tosOk: true });
  assert.equal(a.dryRun, true);
});

test('buyer key is stable, case-insensitive and hides the name', () => {
  assert.equal(buyerKeyFor('Pat Example', '90000'), buyerKeyFor('pat example', '90000'));
  assert.notEqual(buyerKeyFor('Pat Example', '90000'), buyerKeyFor('Pat Example', '90001'));
  assert.ok(!buyerKeyFor('Pat Example', '90000').toLowerCase().includes('pat'));
});

test('every page config has a detect rule and selectors', () => {
  for (const [kind, p] of Object.entries(PAGES)) {
    assert.ok(p.detect.selector, kind);
    assert.ok(Object.keys(p.selectors).length > 0, kind);
  }
});
