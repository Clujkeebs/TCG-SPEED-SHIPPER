import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPracticeHost } from '../src/agent-host/host.js';
import { makeShop } from '../src/agent-host/shop.js';
import { validateEvent } from '../src/agent/protocol.js';

const ID = 'ext-test-id';
const sender = { id: ID, url: `chrome-extension://${ID}/src/ui/sidepanel.html` };
let n = 0;
const req = (type, payload) => ({ source: 'tcgss-panel', v: 1, id: 'q' + ++n, type, ...(payload ? { payload } : {}) });

function rig() {
  const host = createPracticeHost({ extensionId: ID });
  const events = [];
  const emit = (e) => events.push(e);
  const waitFor = async (event) => { for (let i = 0; i < 200; i++) { const e = events.find((x) => x.event === event && !x.seen); if (e) { e.seen = true; return e; } await new Promise((r) => setTimeout(r, 5)); } throw new Error('timed out waiting for ' + event); };
  return { host, events, emit, waitFor, send: (t, p, s = sender) => host.handle(req(t, p), s, emit) };
}

test('the made-up shop is valid and has no real data', () => {
  const shop = makeShop();
  assert.ok(shop.orders.length >= 50 && shop.printings.length === 8);
  assert.ok(shop.orders.every((o) => o.id.startsWith('PRC-')));
});

test('hello lists the real tools and the practice extras', async () => {
  const { send } = rig();
  const r = await send('agent.hello');
  assert.equal(r.ok, true);
  assert.ok(r.result.types.includes('agent.ask') && r.result.types.includes('agent.memory.list'));
  assert.ok(r.result.tools.some((t) => t.name === 'orders.stats' && t.tier === 'read'));
  assert.ok(r.result.tools.some((t) => t.name === 'listing.setPrice' && t.tier === 'act'));
});

test('a question runs the real engine: tool call, plan, answer, audit entry', async () => {
  const { send, waitFor, events, host } = rig();
  assert.equal((await send('agent.ask', { text: 'who are my repeat buyers?' })).ok, true);
  const answer = await waitFor('agent.answer');
  assert.match(answer.text, /repeat buyers/);
  assert.ok(events.some((e) => e.event === 'agent.progress' && e.tool === 'report.repeatCustomers'));
  const plans = events.filter((e) => e.event === 'agent.plan');
  assert.ok(plans.length >= 2 && plans.at(-1).steps.every((s) => s.state === 'done'));
  const audit = await host.registry.audit.list();
  assert.equal(audit.length, 1);
  assert.equal(audit[0].tool, 'report.repeatCustomers');
  assert.ok(events.every((e) => validateEvent(e).ok), 'the panel accepts every event the host sends');
});

test('a price change waits for approval; approving changes the practice shop and is audited as user-approved', async () => {
  const { send, waitFor, host } = rig();
  const before = host.shop.inventory.find((i) => i.printingId === 'mtg:practice:p2').priceCents;
  await send('agent.ask', { text: 'lower the price' });
  const card = await waitFor('agent.approval-needed');
  assert.equal(card.tool, 'listing.setPrice');
  assert.equal(host.shop.inventory.find((i) => i.printingId === 'mtg:practice:p2').priceCents, before, 'nothing changed before the click');
  assert.equal((await send('agent.approve', { approvalId: card.approvalId, approved: true })).ok, true);
  const answer = await waitFor('agent.answer');
  assert.match(answer.text, /^Done, in practice data only/);
  assert.equal(host.shop.inventory.find((i) => i.printingId === 'mtg:practice:p2').priceCents, 70);
  const entry = (await host.registry.audit.list()).find((e) => e.tool === 'listing.setPrice');
  assert.deepEqual([entry.tier, entry.outcome, entry.approvedBy], ['act', 'ok', 'user']);
  assert.equal((await send('agent.approve', { approvalId: card.approvalId, approved: true })).ok, false, 'an approval works once');
});

test('denying changes nothing, and the plan shows the last step skipped', async () => {
  const { send, waitFor, host, events } = rig();
  const before = host.shop.inventory.find((i) => i.printingId === 'mtg:practice:p2').priceCents;
  await send('agent.ask', { text: 'reprice my cards' });
  const card = await waitFor('agent.approval-needed');
  await send('agent.approve', { approvalId: card.approvalId, approved: false });
  const answer = await waitFor('agent.answer');
  assert.match(answer.text, /did not change anything/);
  assert.equal(host.shop.inventory.find((i) => i.printingId === 'mtg:practice:p2').priceCents, before);
  assert.equal(events.filter((e) => e.event === 'agent.plan').at(-1).steps.at(-1).state, 'skipped');
  assert.equal((await host.registry.audit.list()).find((e) => e.tool === 'listing.setPrice').outcome, 'denied');
});

test('Stop turns the kill switch on and denies the waiting approval; Resume lets work continue', async () => {
  const { send, waitFor, host } = rig();
  await send('agent.ask', { text: 'lower the price' });
  await waitFor('agent.approval-needed');
  assert.equal((await send('agent.stop')).result.killed, true);
  await waitFor('agent.stopped');
  assert.equal(host.shop.inventory.find((i) => i.printingId === 'mtg:practice:p2').priceCents > 70, true);
  assert.equal((await send('agent.ask', { text: 'hello' })).ok, false);
  await waitFor('agent.answer'); // the interrupted run winds down
  await send('agent.resume');
  assert.equal((await send('agent.ask', { text: 'how many orders?' })).ok, true);
});

test('memory: remember, list, forget; and only the extension itself may use it', async () => {
  const { send, waitFor, events } = rig();
  await send('agent.ask', { text: 'remember that I close the shop on Sundays' });
  const mem = await waitFor('agent.memory');
  assert.ok(mem.items.some((m) => /Sundays/.test(m.text)));
  const added = mem.items.find((m) => /Sundays/.test(m.text));
  await send('agent.memory.forget', { id: added.id });
  const after = await waitFor('agent.memory');
  assert.ok(!after.items.some((m) => m.id === added.id));
  assert.ok(events.every((e) => validateEvent(e).ok));
  const stranger = { id: 'other', url: 'https://tcgspeedshipper.com/' };
  assert.equal((await send('agent.memory.list', undefined, stranger)).ok, false);
  assert.equal((await send('agent.ask', { text: 'x' }, stranger)).ok, false);
  assert.equal((await send('agent.memory.forget', { id: '' })).ok, false);
});
