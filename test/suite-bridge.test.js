/* The web app's side of the Suite bridge (public/js/suite-bridge.js): hands the signed-in ACCESS token to the Chrome extension, and
   only if the extension is there. Pins: nothing about the login is posted unless the extension answered "hello"; only the access
   token and its expiry are ever sent (never the refresh token or the user); a new token is passed on, the same one is not sent
   twice; sign-out takes it back (also when sign-out happens while the link is still in flight); a refusal is not retried for the
   same token; answers from other windows, origins or ids are ignored; nothing here can throw into the page. The messages are
   checked against the extension's OWN validator, so a change to either side that breaks the contract fails here. No browser. */
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const Bridge = require('../public/js/suite-bridge.js');

let pass = 0, fail = 0;
function check(name, cond, detail) { if (cond) { pass++; console.log('  PASS  ' + name); } else { fail++; console.log('  FAIL  ' + name + (detail ? '  — ' + detail : '')); } }

const ORIGIN = 'https://tcgspeedshipper.com';
const jwt = (n) => 'aaaa' + n + '.bbbb' + n + '.cccc' + n; // three base64url parts: what the extension's validator calls a login token
const session = (n, extra) => Object.assign({ access_token: jwt(n), expires_at: 1790000000 + n, refresh_token: 'REFRESH-SECRET-' + n, user: { email: 'seller' + n + '@example.com' } }, extra || {});
const answer = (msg, ok, result) => ({ source: 'tcgss-extension', v: 1, id: msg.id, ok, result });

function rig(initial) {
  let behaviour = initial;
  const listeners = [], posted = [], timers = new Map();
  let t = 1000, tid = 0;
  const deliver = (data, over) => listeners.forEach((fn) => fn(Object.assign({ data, source: win, origin: win.location.origin }, over || {})));
  const win = {
    location: { origin: ORIGIN },
    addEventListener: (type, fn) => { if (type === 'message') listeners.push(fn); },
    postMessage: (msg, target) => {
      posted.push({ msg: JSON.parse(JSON.stringify(msg)), target });
      const reply = behaviour(msg);
      if (reply) setImmediate(() => deliver(reply));
    },
  };
  const bridge = Bridge.create(win, {
    now: () => t, waitMs: 2500, retryMs: 30000,
    setTimeout: (fn, ms) => { const id = ++tid; timers.set(id, { fn, at: t + ms }); return id; },
    clearTimeout: (id) => timers.delete(id),
  });
  return {
    win, bridge, posted, deliver,
    set: (b) => { behaviour = b; },
    advance: (ms) => { t += ms; for (const [id, x] of [...timers]) if (x.at <= t) { timers.delete(id); x.fn(); } },
    tick: async () => { for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r)); },
    types: () => posted.map((p) => p.msg.type),
  };
}

// An installed extension: says hello, takes the link, lets go on unlink.
const installed = (msg) => answer(msg, true, msg.type === 'hello' ? { name: 'TCG Speed Suite', version: '0.1.0' } : msg.type === 'account.link' ? { linked: true } : { linked: false });
const absent = () => null;

let finished = false;
process.on('exit', () => { if (!finished) { console.log('  FAIL  the test ended before it finished (a promise never resolved)'); process.exitCode = 1; } });

(async () => {
  try {
    const ext = await import(pathToFileURL(path.join(__dirname, '..', 'suite', 'extension', 'src', 'bridge.js')).href);

    console.log('\n-- extension installed: link, refresh, unlink --');
    let r = rig(installed);
    const S1 = session(1);
    await r.bridge.sync(S1);
    check('says hello first, then links (nothing else)', r.types().join() === 'hello,account.link', r.types().join());
    const link = r.posted[1].msg;
    check('the link carries the access token and its expiry, and nothing else', JSON.stringify(Object.keys(link.payload).sort()) === '["accessToken","expiresAt"]' && link.payload.accessToken === S1.access_token && link.payload.expiresAt === S1.expires_at);
    const all = JSON.stringify(r.posted);
    check('the refresh token and the user are never posted', !/REFRESH-SECRET|seller1@example\.com|refresh_token|"user"/.test(all));
    check('every message goes to this page\'s own origin only, never "*"', r.posted.every((p) => p.target === ORIGIN));
    check('every message has source, version and a unique id of 1 to 80 characters', r.posted.every((p) => p.msg.source === 'tcgss-app' && p.msg.v === 1 && typeof p.msg.id === 'string' && p.msg.id.length >= 1 && p.msg.id.length <= 80) && new Set(r.posted.map((p) => p.msg.id)).size === r.posted.length);
    const verdicts = r.posted.map((p) => ext.validateRequest(p.msg, ORIGIN));
    check("the extension's own validator accepts every message (hello and account.link)", verdicts.every((v) => v.ok), JSON.stringify(verdicts));
    await r.bridge.sync(S1);
    await r.bridge.sync(Object.assign({}, S1));
    check('the same login again sends nothing', r.posted.length === 2, r.types().join());
    const S2 = session(2);
    await r.bridge.sync(S2);
    check('a renewed login (new token) is linked again, without another hello', r.types().join() === 'hello,account.link,account.link' && r.posted[2].msg.payload.accessToken === S2.access_token, r.types().join());
    check('the renewed link also passes the extension\'s validator', ext.validateRequest(r.posted[2].msg, ORIGIN).ok);
    await r.bridge.sync(null);
    check('sign-out takes it back with account.unlink (no payload)', r.types().slice(-1)[0] === 'account.unlink' && r.posted[3].msg.payload === undefined && ext.validateRequest(r.posted[3].msg, ORIGIN).ok, r.types().join());
    await r.bridge.sync(null);
    await r.bridge.sync(undefined);
    check('signed out again: nothing more is sent', r.posted.length === 4, r.types().join());
    await r.bridge.sync(S2);
    check('signing back in links the login again', r.types().slice(-1)[0] === 'account.link' && r.posted.length === 5, r.types().join());

    console.log('\n-- no extension: nothing about the login leaves the page --');
    r = rig(absent);
    let p = r.bridge.sync(S1);
    await r.tick();
    check('only a hello is posted, and no token is in it', r.types().join() === 'hello' && !/aaaa1|bbbb1|cccc1/.test(JSON.stringify(r.posted)), r.types().join());
    r.advance(2500);
    await p;
    check('the unanswered hello gives up after 2.5 s; still no link', r.types().join() === 'hello');
    await r.bridge.sync(S1);
    await r.tick();
    check('a second look within 30 s does not ask again', r.types().join() === 'hello', r.types().join());
    r.advance(31000);
    p = r.bridge.sync(S1);
    await r.tick();
    check('after 30 s it asks again (the extension may have been installed meanwhile)', r.types().join() === 'hello,hello', r.types().join());
    r.set(installed);
    r.advance(2500);
    await p;
    r.advance(31000);
    await r.bridge.sync(S1);
    check('and once the extension answers, the login is linked', r.types().join() === 'hello,hello,hello,account.link', r.types().join());

    console.log('\n-- the extension says no, or is slow --');
    r = rig((m) => (m.type === 'account.link' ? answer(m, false, undefined) : installed(m)));
    await r.bridge.sync(S1);
    await r.bridge.sync(S1);
    await r.tick();
    check('a refusal is not retried for the same token (no loop)', r.types().filter((x) => x === 'account.link').length === 1, r.types().join());
    await r.bridge.sync(session(3));
    await r.tick();
    check('but a new token is offered again', r.types().filter((x) => x === 'account.link').length === 2, r.types().join());

    r = rig((m) => (m.type === 'hello' ? installed(m) : null)); // takes hello, never answers the link
    p = r.bridge.sync(S1);
    await r.tick();
    r.advance(2500);
    await p;
    check('an unanswered link is not looped on', r.types().filter((x) => x === 'account.link').length === 1, r.types().join());
    p = r.bridge.sync(S1);
    await r.tick();
    r.advance(2500);
    await p;
    check('but it is tried again at the next look, not forgotten', r.types().filter((x) => x === 'account.link').length === 2, r.types().join());

    console.log('\n-- sign-out while the link is still in flight --');
    r = rig((m) => (m.type === 'account.link' ? null : installed(m)));
    p = r.bridge.sync(S1);
    await r.tick();
    const linkMsg = r.posted.find((x) => x.msg.type === 'account.link').msg;
    const out = r.bridge.sync(null);
    await r.tick();
    check('the unlink waits for the link to finish', r.types().join() === 'hello,account.link', r.types().join());
    r.deliver(answer(linkMsg, true, { linked: true }));
    await p; await out; await r.tick();
    check('then the token is taken back (hello, link, unlink)', r.types().join() === 'hello,account.link,account.unlink', r.types().join());

    console.log('\n-- only real answers count --');
    r = rig(absent);
    p = r.bridge.sync(S1);
    await r.tick();
    const helloMsg = r.posted[0].msg;
    r.deliver(answer(helloMsg, true, {}), { source: { other: 'window' } });
    r.deliver(answer(helloMsg, true, {}), { origin: 'https://evil.example' });
    r.deliver(Object.assign(answer(helloMsg, true, {}), { source: 'someone-else' }));
    r.deliver(Object.assign(answer(helloMsg, true, {}), { v: 2 }));
    r.deliver(answer({ id: 'not-asked' }, true, {}));
    r.deliver(null); r.deliver('hello'); r.deliver({});
    await r.tick();
    r.advance(2500);
    await p;
    check('answers from another window, another origin, another source or version, or to a question never asked, are ignored', r.types().join() === 'hello', r.types().join());

    console.log('\n-- odd sessions and a hostile window --');
    r = rig(installed);
    await r.bridge.sync({ access_token: jwt(9) }); // no expiry
    await r.bridge.sync({ expires_at: 1790000000 }); // no token
    await r.bridge.sync({ access_token: 123, expires_at: 1790000000 });
    await r.bridge.sync({ access_token: '', expires_at: 1790000000 });
    await r.bridge.sync({ access_token: jwt(9), expires_at: 'soon' });
    check('a session without a usable token and expiry counts as signed out: nothing is posted', r.posted.length === 0, r.types().join());
    const throwing = rig(installed);
    throwing.win.postMessage = () => { throw new Error('boom'); };
    let threw = false;
    try { await throwing.bridge.sync(S1); } catch (e) { threw = true; }
    check('a window that throws on postMessage never throws into the page', !threw);

    console.log('\n-- wired into the page --');
    const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
    check('index.html loads /js/suite-bridge.js after the core script', html.indexOf('<script src="/js/suite-bridge.js"></script>') > html.indexOf('<script src="/js/shipper-core.js"></script>') && html.includes('/js/suite-bridge.js'));
    const uiAt = html.indexOf('function updateAccountUI()');
    const fnBody = html.slice(uiAt, uiAt + 400);
    check('updateAccountUI() hands every login change to the bridge (inside a try, so it can never break the page)', /try \{ if \(suiteBridge\) suiteBridge\.sync\(session\); \} catch \(e\) \{\}/.test(fnBody), fnBody.slice(0, 200));
    check('the bridge is built once from the page window, and only if the script loaded', /suiteBridge = window\.TCGSSBridge \? window\.TCGSSBridge\.create\(window\) : null/.test(html) && (html.match(/TCGSSBridge\.create\(/g) || []).length === 1);
    const sw = fs.readFileSync(path.join(__dirname, '..', 'public', 'sw.js'), 'utf8');
    check('the service worker keeps a copy for offline use', sw.includes("'/js/suite-bridge.js'"));
  } catch (e) { fail++; console.log('  FAIL  threw: ' + e.stack); }
  finished = true;
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
