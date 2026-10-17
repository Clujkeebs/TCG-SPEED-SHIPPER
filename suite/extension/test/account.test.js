import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateRequest, checkAccountLink, normalizeExpiry, MESSAGE_TYPES, REQUEST_SOURCE } from '../src/bridge.js';
import { createVault, redactTokens, SESSION_KEY } from '../src/account/vault.js';
import { describeStatus, checkAccount, CODE_LINES, STATUS_PATH } from '../src/account/status.js';
import { handleRequest, handleAccountStatus, forgetStatus } from '../src/background.js';
import { openStore } from '../src/store.js';
import { memoryArea } from '../src/flags.js';
import { clearEverything } from '../src/clear.js';
import { createPracticeHost } from '../src/agent-host/host.js';
import { parseOrderExport } from '../src/orders/parser.js';
import { makeOrderCsv } from './helpers/orders-csv.js';

const SITE = 'https://tcgspeedshipper.com';
const b64 = (s) => Buffer.from(s).toString('base64url');
export const fakeJwt = (tag = 'abc') => `${b64('{"alg":"HS256"}')}.${b64(`{"sub":"user-${tag}","role":"authenticated"}`)}.${b64('signature-' + tag)}`;
const TOKEN = fakeJwt('one');
const req = (type, payload, id = 'a1') => ({ source: REQUEST_SOURCE, v: 1, id, type, ...(payload === undefined ? {} : { payload }) });
const clockAt = (ms) => { const c = { ms }; c.now = () => c.ms; return c; };
const T0 = Date.parse('2026-10-17T10:00:00Z');
const inSeconds = (c, s) => Math.floor((c.ms + s * 1000) / 1000);

// a place that remembers writes and can be searched afterwards
function spyArea() {
  const data = {};
  return { data, async get(k) { return k in data ? { [k]: structuredClone(data[k]) } : {}; }, async set(o) { Object.assign(data, structuredClone(o)); }, async remove(k) { delete data[k]; }, async clear() { for (const k of Object.keys(data)) delete data[k]; } };
}

// ---------- the bridge shape
test('a page can call exactly four things, all write-only', () => {
  assert.deepEqual([...MESSAGE_TYPES].sort(), ['account.link', 'account.unlink', 'hello', 'tracking.put']);
});

test('account.link: only the access token and its expiry, from the site origin only', () => {
  const exp = 1792230000;
  assert.equal(validateRequest(req('account.link', { accessToken: TOKEN, expiresAt: exp }), SITE).ok, true);
  assert.equal(validateRequest(req('account.link', { accessToken: TOKEN, expiresAt: exp * 1000 }), SITE).ok, true, 'milliseconds are fine');
  assert.equal(validateRequest(req('account.unlink'), SITE).ok, true);
  for (const origin of ['https://evil.example', 'https://seller.tcgplayer.com', 'http://tcgspeedshipper.com', 'https://tcgspeedshipper.com.evil.com', 'http://localhost:3000', undefined]) {
    assert.equal(validateRequest(req('account.link', { accessToken: TOKEN, expiresAt: exp }), origin).ok, false, String(origin));
  }
});

test('account.link refuses a refresh token, extra fields and anything that is not a login token', () => {
  const exp = 1792230000;
  const bad = [
    { accessToken: TOKEN, expiresAt: exp, refreshToken: 'x' }, { accessToken: TOKEN, expiresAt: exp, refresh_token: fakeJwt('r') }, { accessToken: TOKEN, expiresAt: exp, user: { email: 'a@b.c' } },
    { accessToken: TOKEN, expiresAt: exp, extra: 1 }, { access_token: TOKEN, expiresAt: exp }, { accessToken: TOKEN }, { expiresAt: exp },
    { accessToken: '', expiresAt: exp }, { accessToken: 'not-a-token', expiresAt: exp }, { accessToken: 'a.b', expiresAt: exp }, { accessToken: TOKEN + '!', expiresAt: exp },
    { accessToken: 'x'.repeat(5000), expiresAt: exp }, { accessToken: { toString: () => TOKEN }, expiresAt: exp }, { accessToken: [TOKEN], expiresAt: exp },
    { accessToken: TOKEN, expiresAt: 'tomorrow' }, { accessToken: TOKEN, expiresAt: -1 }, { accessToken: TOKEN, expiresAt: 0 }, { accessToken: TOKEN, expiresAt: NaN }, { accessToken: TOKEN, expiresAt: 5 }, { accessToken: TOKEN, expiresAt: 1e15 },
    null, 'x', [], undefined
  ];
  for (const payload of bad) assert.equal(validateRequest(req('account.link', payload), SITE).ok, false, JSON.stringify(payload)?.slice(0, 80));
  assert.equal(validateRequest(req('account.unlink', { a: 1 }), SITE).ok, false);
  assert.equal(normalizeExpiry(1792230000), 1792230000000);
  assert.equal(normalizeExpiry(1792230000000), 1792230000000);
  assert.match(checkAccountLink({ accessToken: TOKEN, expiresAt: 1792230000, refreshToken: 'x' }), /never a refresh token/);
});

// ---------- the vault
test('the vault keeps a token in memory and session storage, drops it at expiry, sign-out and on demand', async () => {
  const c = clockAt(T0); const session = spyArea(); const local = spyArea();
  const v = createVault({ area: session, now: c.now });
  assert.equal(await v.get(), null);
  assert.equal(await v.set(TOKEN, c.ms + 3600_000), true);
  assert.equal(await v.get(), TOKEN);
  assert.ok(JSON.stringify(session.data).includes(TOKEN), 'session storage is the one backup');
  assert.deepEqual(local.data, {}, 'the long-term store is never touched');
  c.ms += 3600_001;
  assert.equal(await v.get(), null, 'expired: gone');
  assert.deepEqual(session.data, {}, 'and removed from session storage too');
  await v.set(TOKEN, c.ms + 1000);
  await v.drop();
  assert.equal(await v.get(), null);
  assert.deepEqual(session.data, {});
});

test('the vault refuses a token that is already expired or lasts longer than a day', async () => {
  const c = clockAt(T0);
  const v = createVault({ area: spyArea(), now: c.now });
  assert.equal(await v.set(TOKEN, c.ms - 1), false);
  assert.equal(await v.set(TOKEN, c.ms), false);
  assert.equal(await v.set(TOKEN, c.ms + 25 * 3600_000), false);
  assert.equal(await v.set(TOKEN, NaN), false);
  assert.equal(await v.set('', c.ms + 1000), false);
  assert.equal(await v.get(), null);
});

test('a sleeping worker takes the token back from session storage, unless it expired meanwhile', async () => {
  const c = clockAt(T0); const session = spyArea();
  await createVault({ area: session, now: c.now }).set(TOKEN, c.ms + 60_000);
  assert.equal(await createVault({ area: session, now: c.now }).get(), TOKEN, 'a new worker finds it');
  c.ms += 61_000;
  assert.equal(await createVault({ area: session, now: c.now }).get(), null, 'expired while asleep');
  assert.ok(!(SESSION_KEY in session.data));
  assert.equal(await createVault({ area: { get: async () => { throw new Error('no storage'); } }, now: c.now }).get(), null, 'broken storage: just empty');
});

test('redactTokens hides login tokens in any text', () => {
  assert.equal(redactTokens(`oops ${TOKEN} and Bearer ${TOKEN}`).includes(TOKEN), false);
  assert.equal(redactTokens('plain words stay'), 'plain words stay');
});

// ---------- the status line
test('every code in the proxy table has a plain sentence with no codes or jargon in it', () => {
  for (const code of ['bad_request', 'plan', 'blocked', 'too_big', 'runs', 'calls', 'day', 'month', 'global', 'steps', 'busy', 'model_error', 'off', 'try_again']) {
    assert.ok(CODE_LINES[code], code);
    const line = CODE_LINES[code]('5:00 PM');
    assert.ok(line.length > 15 && line.length < 140 && /^[A-Z].*[.!]$/.test(line) && !/[_{}]|undefined|\b[45]\d\d\b|\bcode\b/i.test(line), code + ': ' + line);
  }
});

test('describeStatus: available, needs Premium, not switched on, not signed in, limits, and the unexpected', () => {
  assert.equal(describeStatus(200, { available: true, remaining: { runsToday: 3 } }).line, 'The online assistant is available. 3 runs left today.');
  assert.match(describeStatus(200, { available: true, remaining: { runsToday: 1 } }).line, /1 run left today/);
  assert.equal(describeStatus(200, { available: true }).line, 'The online assistant is available.');
  assert.match(describeStatus(200, { available: false, code: 'plan' }).line, /needs the Premium plan/);
  assert.equal(describeStatus(402, { error: 'whatever the server says', code: 'plan' }).kind, 'needs-plan');
  assert.equal(describeStatus(503, { code: 'off' }).line, 'The online assistant is not switched on yet.');
  assert.equal(describeStatus(503, undefined).kind, 'off');
  const out = describeStatus(401, {});
  assert.deepEqual([out.kind, out.openSite, out.line], ['signed-out', true, 'You are not signed in.']);
  assert.match(describeStatus(429, { code: 'runs', resetsAt: '2026-10-18T00:00:00Z' }).line, /today's online questions\. They come back at /);
  for (const junk of [null, 'x', [], 7, { code: { a: 1 } }, { code: 'x'.repeat(500) }, { available: 'yes' }]) {
    const r = describeStatus(200, junk);
    assert.equal(r.line, 'The online assistant is not available right now.', JSON.stringify(junk)?.slice(0, 40));
  }
  assert.ok(!describeStatus(500, { error: 'secret <b>stack trace</b>', code: 'weird' }).line.includes('stack'), 'server text is never shown');
});

test('checkAccount sends the token only in the Authorization header of one GET to the status address', async () => {
  const c = clockAt(T0); const v = createVault({ area: spyArea(), now: c.now });
  await v.set(TOKEN, c.ms + 3600_000);
  const calls = [];
  const fetchFn = async (url, init) => { calls.push({ url, init }); return { status: 200, json: async () => ({ available: true, remaining: { runsToday: 4 } }) }; };
  const r = await checkAccount({ vault: v, fetchFn, base: SITE });
  assert.equal(r.line, 'The online assistant is available. 4 runs left today.');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, SITE + STATUS_PATH);
  assert.equal(calls[0].init.method, 'GET');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer ' + TOKEN);
  assert.deepEqual([calls[0].init.credentials, calls[0].init.redirect, calls[0].init.cache], ['omit', 'error', 'no-store']);
  assert.ok(!calls[0].url.includes(TOKEN) && calls[0].init.body === undefined, 'not in the address, not in a body');
  assert.ok(!JSON.stringify(r).includes(TOKEN));
});

test('an expired token is never sent; no token means nothing is sent', async () => {
  const c = clockAt(T0); const v = createVault({ area: spyArea(), now: c.now });
  let sent = 0;
  const fetchFn = async () => { sent++; return { status: 200, json: async () => ({ available: true }) }; };
  assert.equal((await checkAccount({ vault: v, fetchFn })).kind, 'signed-out');
  await v.set(TOKEN, c.ms + 1000);
  c.ms += 1001;
  assert.equal((await checkAccount({ vault: v, fetchFn })).kind, 'signed-out');
  assert.equal(sent, 0, 'nothing went out');
});

test('a 401 makes the extension forget the token; a network failure says so kindly and leaks nothing', async () => {
  const c = clockAt(T0); const v = createVault({ area: spyArea(), now: c.now });
  await v.set(TOKEN, c.ms + 3600_000);
  const r401 = await checkAccount({ vault: v, fetchFn: async () => ({ status: 401, json: async () => ({ error: 'no' }) }) });
  assert.equal(r401.openSite, true);
  assert.equal(await v.get(), null, 'forgotten');
  await v.set(TOKEN, c.ms + 3600_000);
  const down = await checkAccount({ vault: v, fetchFn: async () => { throw new TypeError('Failed to fetch ' + TOKEN); } });
  assert.equal(down.kind, 'offline');
  assert.ok(!JSON.stringify(down).includes(TOKEN));
  assert.equal(await v.get(), TOKEN, 'still held after a network error');
  const unreadable = await checkAccount({ vault: v, fetchFn: async () => ({ status: 200, json: async () => { throw new Error('bad json'); } }) });
  assert.equal(unreadable.line, 'The online assistant is not available right now.');
});

// ---------- through the service worker
test('account.link keeps the token (answer says only linked: true); account.unlink forgets it', async () => {
  const c = clockAt(T0); const v = createVault({ area: spyArea(), now: c.now });
  const store = await openStore({ indexedDB: undefined });
  const link = await handleRequest(req('account.link', { accessToken: TOKEN, expiresAt: inSeconds(c, 3600) }), SITE, store, { vault: v });
  assert.deepEqual(link, { source: 'tcgss-extension', v: 1, id: 'a1', ok: true, result: { linked: true } });
  assert.equal(await v.get(), TOKEN);
  const gone = await handleRequest(req('account.unlink'), SITE, store, { vault: v });
  assert.equal(gone.result.linked, false);
  assert.equal(await v.get(), null);
  const stale = await handleRequest(req('account.link', { accessToken: TOKEN, expiresAt: inSeconds(c, -60) }), SITE, store, { vault: v });
  assert.equal(stale.ok, false);
  assert.match(stale.error, /expired/);
  assert.equal(await v.get(), null);
});

test('ATTACK: a page on another origin cannot supply a token', async () => {
  const c = clockAt(T0); const v = createVault({ area: spyArea(), now: c.now });
  const store = await openStore({ indexedDB: undefined });
  for (const origin of ['https://evil.example', 'https://seller.tcgplayer.com', 'http://tcgspeedshipper.com', 'https://tcgspeedshipper.com.evil.com', 'https://tcgspeedshipper.com:8443', 'http://localhost:3000', 'null', undefined]) {
    const r = await handleRequest(req('account.link', { accessToken: TOKEN, expiresAt: inSeconds(c, 3600) }), origin, store, { vault: v });
    assert.equal(r.ok, false, String(origin));
    assert.equal(await v.get(), null, 'nothing was kept for ' + origin);
  }
  // and a stranger cannot sign the real user out either
  await v.set(TOKEN, c.ms + 3600_000);
  assert.equal((await handleRequest(req('account.unlink'), 'https://evil.example', store, { vault: v })).ok, false);
  assert.equal(await v.get(), TOKEN);
});

test('ATTACK: the token never shows up in storage, messages, status answers, the audit log or saved state', async () => {
  const c = clockAt(T0);
  const session = spyArea(), local = spyArea();
  const v = createVault({ area: session, now: c.now });
  const store = await openStore({ indexedDB: undefined });
  await store.replaceAll('orders', parseOrderExport(makeOrderCsv(20)).orders);
  const seen = [];
  const answers = [];
  answers.push(await handleRequest(req('hello'), SITE, store, { vault: v }));
  answers.push(await handleRequest(req('account.link', { accessToken: TOKEN, expiresAt: inSeconds(c, 3600) }), SITE, store, { vault: v }));
  answers.push(await handleRequest(req('tracking.put', { batchId: 'b', items: [{ orderId: 'O1', trackingNumber: '123456' }] }), SITE, store, { vault: v }));
  for (const t of ['store.list', 'tracking.list', 'account.token', 'account.get', 'account.status']) answers.push(await handleRequest(req(t, { collection: 'orders' }), SITE, store, { vault: v }));
  const status = await handleAccountStatus({ type: 'ext.account.status', id: 's1' }, { id: 'EXT', url: 'chrome-extension://EXT/p.html' }, 'EXT', { vault: v, now: c.now, isOn: async () => true, fetchFn: async () => ({ status: 200, json: async () => ({ available: true, remaining: { runsToday: 2 } }) }) });
  answers.push(status);
  const host = createPracticeHost({ extensionId: 'EXT', persist: { async load() { return null; }, async save(s) { local.data.state = s; }, async clear() {} }, now: () => new Date(c.ms) });
  await host.handle({ source: 'tcgss-panel', v: 1, id: 'q', type: 'agent.ask', payload: { text: 'Who are my repeat buyers?' } }, { id: 'EXT', url: 'chrome-extension://EXT/p.html' }, (e) => answers.push(e));
  await new Promise((r) => setTimeout(r, 50));
  const dump = JSON.stringify({
    answers, local: local.data, orders: await store.list('orders'), tracking: await store.list('trackingBatches'),
    audit: await host.registry.audit.list(), state: host.snapshot()
  });
  assert.ok(!dump.includes(TOKEN), 'the token is in a message, store, log or saved state');
  assert.ok(!dump.includes(TOKEN.split('.')[1]), 'not even a part of it');
  assert.ok(JSON.stringify(session.data).includes(TOKEN), 'session storage (not readable by pages) is the one place it lives');
});

test('only our own extension pages can ask for the status line, and answers are cached for a minute', async () => {
  forgetStatus();
  const c = clockAt(T0); const v = createVault({ area: spyArea(), now: c.now });
  await v.set(TOKEN, c.ms + 3600_000);
  let calls = 0;
  const deps = { vault: v, now: c.now, isOn: async () => true, fetchFn: async () => { calls++; return { status: 200, json: async () => ({ available: true, remaining: { runsToday: calls } }) }; } };
  const mine = { id: 'EXT', url: 'chrome-extension://EXT/src/ui/sidepanel.html' };
  const ask = (sender) => handleAccountStatus({ type: 'ext.account.status', id: 's' }, sender, 'EXT', deps);
  for (const s of [{ id: 'EXT', url: 'https://tcgspeedshipper.com/' }, { id: 'OTHER', url: 'chrome-extension://EXT/x' }, { id: 'EXT' }, undefined]) assert.equal((await ask(s)).ok, false);
  assert.equal(calls, 0);
  const a = await ask(mine);
  assert.deepEqual(Object.keys(a.result).sort(), ['kind', 'line', 'openSite']);
  await ask(mine);
  assert.equal(calls, 1, 'second ask within a minute is served from memory');
  c.ms += 61_000; await ask(mine);
  assert.equal(calls, 2);
});

test('Clear everything also forgets the login token and empties session storage', async () => {
  const c = clockAt(T0); const session = spyArea();
  const v = createVault({ area: session, now: c.now });
  await v.set(TOKEN, c.ms + 3600_000);
  session.data.other = 1;
  const store = await openStore({ indexedDB: undefined });
  await clearEverything({ storage: memoryArea2(), store, vault: v, session });
  assert.equal(await v.get(), null);
  assert.deepEqual(session.data, {});
});
function memoryArea2() { return { async clear() {}, async remove() {}, async get() { return {}; }, async set() {} }; }

test('with the online assistant off (or the permission gone) the status call makes no request at all', async () => {
  forgetStatus();
  const c = clockAt(T0); const v = createVault({ area: spyArea(), now: c.now });
  await v.set(TOKEN, c.ms + 3600_000);
  let calls = 0;
  const r = await handleAccountStatus({ type: 'ext.account.status', id: 's' }, { id: 'EXT', url: 'chrome-extension://EXT/p.html' }, 'EXT', { vault: v, now: c.now, isOn: async () => false, fetchFn: async () => { calls++; return { status: 200, json: async () => ({}) }; } });
  assert.equal(r.ok, true);
  assert.equal(r.result.kind, 'assistant-off');
  assert.match(r.result.line, /off/i);
  assert.equal(calls, 0);
});
