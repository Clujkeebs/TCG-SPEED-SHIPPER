/* Pitney Bowes client: what happens when the carrier API says "Too Many Requests".
   Pins: a 429 is retried with a pause (and honors Retry-After, capped); 429s that keep coming end as a
   PbError; a 400 is never retried; 5xx is retried only for calls that change nothing; a retried purchase
   reuses its transaction id; a batch that starts several calls at once asks for ONE token and ONE carrier
   account lookup. No network: fetchImpl and sleep are injected. */
const { makePbClient, PbError } = require('../pb-client');

let pass = 0, fail = 0;
function check(name, cond, detail) { if (cond) { pass++; console.log('  PASS  ' + name); } else { fail++; console.log('  FAIL  ' + name + (detail ? '  — ' + detail : '')); } }

const resp = (status, body, headers = {}) => ({ ok: status < 300, status, headers: { get: (k) => headers[String(k).toLowerCase()] ?? null }, text: async () => JSON.stringify(body) });
const SHIP = { toAddress: { postalCode: '60601' }, byCarrier: { service: 'FCM' } };

function rig(handler) {
  const calls = [];
  const sleeps = [];
  const fetchImpl = async (url, init) => { calls.push({ url, init }); return handler(url, init, calls); };
  const client = makePbClient({ key: 'k', secret: 's', env: 'sandbox', carrierAccountId: 'acct_usps', fetchImpl, sleep: async (ms) => { sleeps.push(ms); }, maxRetries: 3, retryBaseMs: 400 });
  return { client, calls, sleeps };
}
const isToken = (u) => u.endsWith('/auth/api/v1/token');
const isRates = (u) => u.endsWith('/shipping/api/v2/rates');
const isShip = (u) => u.endsWith('/shipping/api/v2/shipments');

(async () => {
  try {
    console.log('\n-- retries --');
    let n = 0;
    let t = rig((u) => (isToken(u) ? resp(200, { access_token: 't', expires_in: 14400 }) : isRates(u) ? (++n <= 2 ? resp(429, { message: 'Too Many Requests' }) : resp(200, { rate: [{ totalCarrierCharge: 0.78 }] })) : resp(404, {})));
    let out = await t.client.rate(SHIP);
    check('two 429s then success: the answer comes back, after two pauses', out && out.rate[0].totalCarrierCharge === 0.78 && t.sleeps.length === 2, JSON.stringify(t.sleeps));
    check('the pauses grow (0.4 s, then 0.8 s, plus a little jitter)', t.sleeps[0] >= 400 && t.sleeps[0] < 560 && t.sleeps[1] >= 800 && t.sleeps[1] < 960, JSON.stringify(t.sleeps));

    t = rig((u) => (isToken(u) ? resp(200, { access_token: 't' }) : resp(429, { message: 'Too Many Requests' }, { 'retry-after': '2' })));
    let err = null; try { await t.client.rate(SHIP); } catch (e) { err = e; }
    check('429 forever: gives up with a PbError 429 after 4 tries (1 + 3 retries)', err instanceof PbError && err.status === 429 && t.calls.filter((c) => isRates(c.url)).length === 4, err && String(err.message));
    check('Retry-After: 2 is honored (about 2 s each time)', t.sleeps.length === 3 && t.sleeps.every((ms) => ms >= 2000 && ms < 2160), JSON.stringify(t.sleeps));

    t = rig((u) => (isToken(u) ? resp(200, { access_token: 't' }) : resp(429, {}, { 'retry-after': '120' })));
    err = null; try { await t.client.rate(SHIP); } catch (e) { err = e; }
    check('a huge Retry-After is capped at 4 s so a request never hangs', t.sleeps.every((ms) => ms <= 4150), JSON.stringify(t.sleeps));

    t = rig((u) => (isToken(u) ? resp(200, { access_token: 't' }) : resp(400, { errors: [{ message: 'Invalid address' }] })));
    err = null; try { await t.client.rate(SHIP); } catch (e) { err = e; }
    check('a 400 is never retried and keeps its message', err instanceof PbError && err.status === 400 && /Invalid address/.test(err.message) && t.sleeps.length === 0 && t.calls.filter((c) => isRates(c.url)).length === 1);

    console.log('\n-- 5xx only where nothing is bought --');
    n = 0;
    t = rig((u) => (isToken(u) ? resp(200, { access_token: 't' }) : isRates(u) ? (++n === 1 ? resp(503, { message: 'Service Unavailable' }) : resp(200, { rate: [{ totalCarrierCharge: 1 }] })) : resp(404, {})));
    out = await t.client.rate(SHIP);
    check('a 503 on a price quote is retried', out && out.rate[0].totalCarrierCharge === 1 && t.sleeps.length === 1);

    t = rig((u) => (isToken(u) ? resp(200, { access_token: 't' }) : resp(503, { message: 'Service Unavailable' })));
    err = null; try { await t.client.createShipment(SHIP); } catch (e) { err = e; }
    check('a 503 while BUYING a label is not retried (it may have gone through)', err instanceof PbError && err.status === 503 && t.calls.filter((c) => isShip(c.url)).length === 1 && t.sleeps.length === 0);

    console.log('\n-- a retried purchase is the same purchase --');
    n = 0;
    t = rig((u) => (isToken(u) ? resp(200, { access_token: 't' }) : isShip(u) ? (++n === 1 ? resp(429, { message: 'Too Many Requests' }) : resp(200, { shipmentId: 'S1' })) : resp(404, {})));
    out = await t.client.createShipment(SHIP);
    const ids = t.calls.filter((c) => isShip(c.url)).map((c) => c.init.headers['X-PB-TransactionId']);
    check('429 on buying is retried with the SAME X-PB-TransactionId (no double purchase)', out && out.shipmentId === 'S1' && ids.length === 2 && ids[0] && ids[0] === ids[1], JSON.stringify(ids));

    console.log('\n-- headers the gateway insists on --');
    // Node's fetch sends "Accept-Language: *" unless the caller sets one. The real gateway answers that with a 400
    // (the owner's Oct 16 sample-order test: "Invalid value for Accept-Language in http header, ex: en-US").
    const validLang = (init) => /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(String((init.headers && init.headers['Accept-Language']) || '*'));
    const gateway = (u, init) => (isToken(u) ? resp(200, { access_token: 't', expires_in: 14400 })
      : !validLang(init) ? resp(400, { errors: [{ errorCode: '1000', message: 'Invalid value for Accept-Language in http header, ex: en-US.' }] })
      : isRates(u) ? resp(200, { rate: [{ totalCarrierCharge: 0.78 }] })
      : isShip(u) ? resp(200, { shipmentId: 'S1' })
      : u.endsWith('/shipping/api/v1/carrierAccounts') ? resp(200, { data: { carrierAccounts: [{ carrierAccountId: 'acct_usps', carrierName: 'USPS' }] } })
      : u.endsWith('/shipping/api/v2/shipments/cancel') ? resp(200, { status: 'INITIATED' })
      : resp(200, { currentStatus: { status: 'In Transit' } }));
    const gw = makePbClient({ key: 'k', secret: 's', env: 'sandbox', fetchImpl: async (u, init) => { gwCalls.push({ url: u, init }); return gateway(u, init); }, sleep: async () => {} });
    const gwCalls = [];
    out = await gw.rate(SHIP);
    check('a price quote gets through a gateway that refuses "Accept-Language: *"', out && out.rate[0].totalCarrierCharge === 0.78);
    out = await gw.createShipment(SHIP);
    check('so does buying a label', out && out.shipmentId === 'S1');
    out = await gw.cancelShipment('S1');
    check('so does refunding one', out && out.status === 'INITIATED');
    out = await gw.tracking('9400111899223197428490');
    check('and tracking', out && out.currentStatus.status === 'In Transit');
    check('every call, the token request included, says Accept-Language en-US and Accept JSON', gwCalls.length >= 6 && gwCalls.every((c) => c.init.headers['Accept-Language'] === 'en-US' && c.init.headers.Accept === 'application/json'), JSON.stringify(gwCalls.map((c) => c.init.headers['Accept-Language'])));
    check('and identifies itself with its own User-Agent, not "node"', gwCalls.every((c) => /^TCGSpeedShipper\//.test(c.init.headers['User-Agent'])));
    check('the headers it already sent are still there (Bearer token, JSON body type, transaction id on a purchase)', gwCalls.filter((c) => isShip(c.url) && c.init.method === 'POST').every((c) => c.init.headers.Authorization === 'Bearer t' && c.init.headers['Content-Type'] === 'application/json' && c.init.headers['X-PB-TransactionId']));
    const bare = makePbClient({ key: 'k', secret: 's', env: 'sandbox', fetchImpl: async (u, init) => gateway(u, { headers: {} }), sleep: async () => {} });
    err = null; try { await bare.rate(SHIP); } catch (e) { err = e; }
    check('(the stand-in gateway does refuse a call that sets no Accept-Language, so this test would have caught the bug)', err instanceof PbError && err.status === 400 && /Accept-Language/.test(err.message), err && err.message);

    console.log('\n-- a batch does not stampede --');
    const tokenCalls = []; const acctCalls = [];
    const slow = (ms) => new Promise((r) => setTimeout(r, ms));
    const calls2 = [];
    const client2 = makePbClient({ key: 'k', secret: 's', env: 'sandbox', fetchImpl: async (url, init) => {
      calls2.push(url);
      await slow(15);
      if (isToken(url)) { tokenCalls.push(url); return resp(200, { access_token: 't', expires_in: 14400 }); }
      if (url.endsWith('/shipping/api/v1/carrierAccounts')) { acctCalls.push(url); return resp(200, { data: { carrierAccounts: [{ carrierAccountId: 'acct_usps', carrierName: 'USPS' }] } }); }
      return resp(200, { rate: [{ totalCarrierCharge: 0.78 }] });
    }, sleep: async () => {} });
    const all = await Promise.all([1, 2, 3, 4, 5, 6].map(() => client2.rate(SHIP)));
    check('six quotes started at once: one token request and one carrier-account lookup', all.length === 6 && tokenCalls.length === 1 && acctCalls.length === 1, 'tokens ' + tokenCalls.length + ', accounts ' + acctCalls.length);
    check('and all six got their price', all.every((x) => x && x.rate[0].totalCarrierCharge === 0.78));
  } catch (e) { fail++; console.log('  FAIL  threw: ' + e.stack); }
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
