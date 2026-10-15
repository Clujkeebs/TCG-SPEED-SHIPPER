import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateEvent, validateClientMessage, userMessage, approvalReply, PROTOCOL_VERSION as v } from '../src/agent/protocol.js';
import { createPanel } from '../src/agent/panel-controller.js';
import { createFixtureTransport } from '../src/agent/fixture-transport.js';

const tick = () => new Promise((r) => setTimeout(r, 0));
const approval = { v, type: 'approval_request', id: 'a1', tool: 'listing.setPrice', tier: 'act', description: 'Change a price', args: [{ label: 'Card', value: 'X' }] };

test('good events pass, malformed ones fail', () => {
  assert.ok(validateEvent({ v, type: 'text', text: 'hi' }).ok);
  assert.ok(validateEvent(approval).ok);
  assert.ok(validateEvent({ v, type: 'done' }).ok);
  for (const bad of [null, 'x', [], {}, { v: 2, type: 'done' }, { v, type: 'nope' }, { v, type: 'text', text: '' }, { v, type: 'text', text: 'x'.repeat(9000) },
    { ...approval, tier: 'read' }, { ...approval, id: '' }, { ...approval, args: 'x' }, { ...approval, args: Array(13).fill({ label: 'a', value: 'b' }) }, { ...approval, tool: 'bad name!' },
    { v, type: 'tool_call', tool: 'orders.stats', tier: 'root', summary: 's' }]) {
    assert.equal(validateEvent(bad).ok, false, JSON.stringify(bad)?.slice(0, 60));
  }
});

test('client messages are checked too', () => {
  assert.ok(validateClientMessage(userMessage('hello')).ok);
  assert.ok(validateClientMessage(approvalReply('a1', true)).ok);
  for (const bad of [null, {}, { v, type: 'user_message', text: '' }, { v, type: 'approval', id: 'a', approved: 'yes' }, { v, type: 'user_message', text: 'x', extra: 1 }, { v, type: 'run' }]) {
    assert.equal(validateClientMessage(bad).ok, false);
  }
});

test('a normal question gets an answer and finishes', async () => {
  const p = createPanel(createFixtureTransport());
  assert.equal(p.say('how many orders?'), true);
  assert.equal(p.busy, true);
  assert.equal(p.say('second at once'), false, 'one question at a time');
  await tick();
  assert.equal(p.busy, false);
  assert.deepEqual(p.items.map((i) => i.kind), ['user', 'tool', 'agent']);
});

test('an action waits for a click, can be answered once, and approval changes nothing in practice mode', async () => {
  const p = createPanel(createFixtureTransport());
  p.say('please lower the price');
  await tick();
  assert.equal(p.waitingForApproval, true);
  assert.equal(p.busy, true, 'still waiting on the owner');
  const card = p.items.find((i) => i.kind === 'approval');
  assert.equal(p.answer('wrong-id', true), false);
  assert.equal(p.answer(card.id, true), true);
  assert.equal(p.answer(card.id, false), false, 'cannot answer twice');
  await tick();
  assert.equal(card.state, 'approved');
  assert.match(p.items.at(-1).text, /nothing was changed/);
  assert.equal(p.busy, false);
});

test('denying works and is reported', async () => {
  const p = createPanel(createFixtureTransport());
  p.say('reprice it');
  await tick();
  p.answer(p.items.find((i) => i.kind === 'approval').id, false);
  await tick();
  assert.match(p.items.at(-1).text, /did not change anything/);
});

test('bad events from a transport are ignored with a notice, and never create a card', async () => {
  let push;
  const p = createPanel({ send() {}, onEvent(fn) { push = fn; } });
  push({ v, type: 'approval_request', id: 'x', tool: 'bad name', tier: 'act', description: 'd', args: [] });
  push('<img src=x onerror=alert(1)>');
  assert.deepEqual(p.items.map((i) => i.kind), ['error', 'error']);
  assert.equal(p.waitingForApproval, false);
});

test('the panel code never uses innerHTML or eval', async () => {
  const { readFileSync } = await import('node:fs');
  for (const f of ['../src/ui/sidepanel.js', '../src/agent/panel-controller.js']) {
    const text = readFileSync(new URL(f, import.meta.url), 'utf8');
    assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|eval\(|new Function/.test(text), f);
  }
});
