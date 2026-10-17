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
const PDF = Buffer.from('%PDF-1.4 test label');
// What fetch gives back for a label file: bytes, no JSON.
const fileResp = (status, bytes = PDF, headers = {}) => ({ ok: status < 300, status, headers: { get: (k) => headers[String(k).toLowerCase()] ?? null }, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length) });
const LABEL_LINK = 'https://prv-labels-cls.gcs.pitneycloud.com/usps/910187923/outbound/label/5ecfa0ecc6454caeb90c55d35229de90.pdf';

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
      : isRates(u) ? resp(200, { rates: [{ rate: { baseCharge: 0.78, carrier: 'USPS' } }] }) // the live sandbox's shape (Oct 17 boot self-check)
      : isShip(u) ? resp(200, { shipmentId: 'S1' })
      : u.endsWith('/shipping/api/v1/carrierAccounts') ? resp(200, { data: { carrierAccounts: [{ carrierAccountId: 'acct_usps', carrierName: 'USPS' }] } })
      : u.endsWith('/shipping/api/v2/shipments/cancel') ? resp(200, { status: 'INITIATED' })
      : u.includes('/shippingpaymentmgmt/api/v1/payments/accounts/balance') ? resp(200, { walletAccount: { currency: 'USD', balanceAvailable: 12.5, pendingBalance: 0 } })
      : u.includes('/shippingpaymentmgmt/api/v1/payments/methods') ? resp(200, { paymentMethods: [{ paymentMethodCode: 'CC_Visa', paymentMethodStatus: 'ACTIVE', accountNumber: '1111' }] })
      : u.endsWith('/shippingpaymentmgmt/api/v1/payments/wallet/refill') ? resp(200, { requestedAmount: 50, balanceAvailable: 62.5, totalAmount: 51.75, status: 'SUCCESS' })
      : resp(200, { currentStatus: { status: 'In Transit' } }));
    const gw = makePbClient({ key: 'k', secret: 's', env: 'sandbox', fetchImpl: async (u, init) => { gwCalls.push({ url: u, init }); return gateway(u, init); }, sleep: async () => {} });
    const gwCalls = [];
    out = await gw.rate(SHIP);
    check('a price quote gets through a gateway that refuses "Accept-Language: *"', out && out.rates[0].rate.baseCharge === 0.78);
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

    console.log('\n-- the boot self-check: a read-only look at Pitney Bowes --');
    const { pbSelfCheck } = require('../postage');
    const SELF_ENV = { PB_API_KEY: 'KEY-DO-NOT-LEAK', PB_API_SECRET: 'SECRET-DO-NOT-LEAK', PB_RETRY_BASE_MS: '1' };
    const selfCalls = [];
    const tokenFirst = (u, init) => (isToken(u) ? resp(200, { access_token: 'TOKEN-DO-NOT-LEAK', expires_in: 14400 }) : gateway(u, init));
    let line = await pbSelfCheck(SELF_ENV, async (u, init) => { selfCalls.push({ url: u, init }); return tokenFirst(u, init); });
    check('all good: login, the USPS account and a price for each service', line === 'pb_mode=sandbox pb_account=OK(USPS) pb_wallet=OK($12.50) pb_pay_methods=1(CC_Visa:ACTIVE) pb_rate_letter=OK($0.78) pb_rate_ground=OK($0.78)', line);
    check('it buys and refunds nothing (only the login, the account list and price quotes)', selfCalls.length >= 3 && !selfCalls.some((c) => /shipments/.test(c.url)), JSON.stringify(selfCalls.map((c) => c.url.split('.com')[1])));
    check('the quote bodies are made-up public addresses, not a seller\'s', selfCalls.filter((c) => isRates(c.url)).every((c) => /Amphitheatre/.test(c.init.body) && /Fifth Avenue/.test(c.init.body)));
    check('the answer never contains the key, the secret or the token', !/KEY-DO-NOT-LEAK|SECRET-DO-NOT-LEAK|TOKEN-DO-NOT-LEAK/.test(line));
    check('it reads the postage wallet and the payment-method codes, and never a card number', /pb_wallet=OK\(\$12\.50\)/.test(line) && /pb_pay_methods=1\(CC_Visa:ACTIVE\)/.test(line) && !/1111/.test(line));
    check('the wallet and payment-method lookups are plain reads (GET), and no refill happens by default', selfCalls.filter((c) => /shippingpaymentmgmt/.test(c.url)).every((c) => c.init.method === 'GET') && !selfCalls.some((c) => /wallet\/refill/.test(c.url)));
    line = await pbSelfCheck(SELF_ENV, async (u, init) => (/shippingpaymentmgmt/.test(u) ? resp(403, { errors: [{ message: 'Not allowed for this account.' }] }) : tokenFirst(u, init)));
    check('a payments refusal is shown, and the quotes after it still run', /pb_wallet=FAILED\(403 Not allowed for this account\./.test(line) && /pb_pay_methods=FAILED\(403/.test(line) && /pb_rate_letter=OK/.test(line), line);
    line = await pbSelfCheck(SELF_ENV, async (u, init) => tokenFirst(u, { headers: {} })); // what the old client sent
    check('a gateway refusal is shown with its reason (the Oct 16 Accept-Language error would have been seen at deploy time)', /pb_account=FAILED\(400 Invalid value for Accept-Language/.test(line) && /pb_rate_letter=FAILED\(400 Invalid value for Accept-Language/.test(line) && /pb_rate_ground=FAILED\(400/.test(line), line);
    line = await pbSelfCheck(SELF_ENV, async (u) => (isToken(u) ? resp(401, { error: 'invalid_client' }) : resp(200, {})));
    check('wrong keys: says FAILED with the status', /pb_account=FAILED\(401/.test(line) && !/KEY-DO-NOT-LEAK|SECRET-DO-NOT-LEAK/.test(line), line);
    line = await pbSelfCheck(SELF_ENV, async (u, init) => (u.endsWith('/shipping/api/v1/carrierAccounts') ? resp(200, { data: { carrierAccounts: [{ carrierAccountId: 'u1', carrierName: 'UPS' }] } }) : isRates(u) ? resp(200, {}) : tokenFirst(u, init)));
    check('no USPS account and no price are said plainly', /pb_account=NO_USPS\(1 accounts\)/.test(line) && /pb_rate_letter=NO_PRICE/.test(line), line);
    check('keys not set: "pb=NOT_SET", and nothing is called', (await pbSelfCheck({}, async () => { throw new Error('must not be called'); })) === 'pb=NOT_SET');
    check('production mode is named when it is really on', /^pb_mode=production /.test(await pbSelfCheck(Object.assign({ PB_ENV: 'production', PB_LIVE_OK: 'yes' }, SELF_ENV), async (u, init) => tokenFirst(u, init))));

    console.log('\n-- reading a price out of every shape Pitney Bowes uses --');
    const { rateOf, readLabel } = require('../postage');
    check('the live sandbox shape: { rates: [ { rate: {...} } ] }', rateOf({ rates: [{ rate: { baseCharge: 0.78 } }] }).baseCharge === 0.78);
    check('the docs shape: { rate: [ {...} ] }', rateOf({ rate: [{ totalCarrierCharge: 1.5 }] }).totalCarrierCharge === 1.5);
    check('a purchase answer: { rate: {...} }', rateOf({ rate: { totalCarrierCharge: 4.5 } }).totalCarrierCharge === 4.5);
    check('a rates list of bare rates: { rates: [ {...} ] }', rateOf({ rates: [{ baseCharge: 2 }] }).baseCharge === 2);
    check('nothing usable gives null, never a crash', rateOf({}) === null && rateOf({ rates: [] }) === null && rateOf(null) === null && rateOf('x') === null && rateOf({ rate: [] }) === null);
    const { money } = require('../postage');
    check('a missing price is null, never $0.00 (Number(null) is 0)', money(null) === null && money(undefined) === null && money({}) === null && money({ baseCharge: null }) === null && money({ totalCarrierCharge: null, baseCharge: null }) === null && money({ baseCharge: '' }) === null);
    check('zero, negative and junk are "no price" too; real prices are rounded to cents', money({ totalCarrierCharge: 0 }) === null && money({ baseCharge: -1 }) === null && money({ baseCharge: 'abc' }) === null && money({ baseCharge: '0.784' }) === 0.78 && money({ totalCarrierCharge: 6.24, baseCharge: 5 }) === 6.24);
    check('a purchase answer in the live shape still yields its price', readLabel({ shipmentId: 'S', parcelTrackingNumber: 'T', rates: [{ rate: { totalCarrierCharge: 6.24 } }] }).rate.totalCarrierCharge === 6.24);

    console.log('\n-- the sandbox buy and refund rehearsal (only when asked, only in the sandbox) --');
    // Like the real gateway (Oct 17 sandbox rehearsal): the purchase answer holds a LINK to the PDF, and asking for BASE64 with a PDF is refused.
    const buyBodies = [];
    const answer = (id, size) => resp(200, { shipmentId: id, parcelTrackingNumber: '9400111899223197428490', rate: { totalCarrierCharge: 0.78 }, labelLayout: [{ contentType: 'URL', contents: LABEL_LINK, fileFormat: 'PDF', size, type: 'SHIPPING_LABEL' }] });
    let fileMode = 'plain'; // what the label link does: 'plain' (a file), 'login' (wants the token), 'gone' (404)
    const fileCalls = [];
    const fullBuy = (u, init) => {
      if (u === LABEL_LINK) {
        fileCalls.push({ auth: Boolean(init.headers && init.headers.Authorization) });
        return fileMode === 'gone' ? fileResp(404, Buffer.alloc(0)) : fileMode === 'login' && !(init.headers && init.headers.Authorization) ? fileResp(403, Buffer.alloc(0)) : fileResp(200);
      }
      if (isToken(u)) return resp(200, { access_token: 'TOKEN-DO-NOT-LEAK', expires_in: 14400 });
      if (isShip(u) && init.method === 'POST') {
        const b = JSON.parse(init.body);
        buyBodies.push(b);
        if (b.contentType === 'BASE64' && b.labelFormat === 'PDF') return resp(400, { errors: [{ errorCode: '1002', message: 'Invalid label file output format.' }] });
        return answer('SB1', b.labelSize);
      }
      if (u.endsWith('/shipments/cancel')) return resp(200, { status: 'INITIATED', totalCarrierCharge: 0.78 });
      return gateway(u, init);
    };
    const buyCalls = [];
    const buyFetch = async (u, init) => { buyCalls.push({ url: u, method: init.method }); return fullBuy(u, init); };
    line = await pbSelfCheck(Object.assign({ PB_SELFTEST_BUY: 'on' }, SELF_ENV), buyFetch);
    check('on: it buys a letter and a package label and checks the answer holds an id, a tracking number, a PDF it could fetch, and a price', /pb_buy_letter\[DOC_6X4\]=OK\(id=yes tracking=yes pdf=yes\(fetched with no login, 19 bytes\) price=0\.78/.test(line) && /pb_buy_ground=OK\(id=yes tracking=yes pdf=yes\(fetched with no login, 19 bytes\) price=0\.78/.test(line), line);
    check('it never asks for BASE64 with a PDF (the live gateway refuses it: "Invalid label file output format")', buyBodies.length >= 2 && buyBodies.every((x) => x.contentType !== 'BASE64' && x.labelFormat === 'PDF'));
    check('it refunds the package label (letters cannot be refunded) and reports the answer', /pb_cancel_ground=OK\(\{"status":"INITIATED"/.test(line) && buyCalls.filter((c) => /cancel/.test(c.url)).length === 1);
    check('the log line holds where labels live (host, signed or not) but never the link, the file or the token', /"host":"prv-labels-cls\.gcs\.pitneycloud\.com","query":false/.test(line) && !/outbound\/label|5ecfa0ec|JVBERi0|%PDF/.test(line) && !/TOKEN-DO-NOT-LEAK/.test(line), line);
    fileMode = 'login'; fileCalls.length = 0;
    line = await pbSelfCheck(Object.assign({ PB_SELFTEST_BUY: 'on' }, SELF_ENV), buyFetch);
    check('a label link that wants a login is fetched again with the token, and the line says so', /pb_buy_letter\[DOC_6X4\]=OK\(id=yes tracking=yes pdf=yes\(fetched after login, 19 bytes\)/.test(line) && fileCalls.length === 4 && fileCalls[0].auth === false && fileCalls[1].auth === true, line + JSON.stringify(fileCalls));
    fileMode = 'gone';
    line = await pbSelfCheck(Object.assign({ PB_SELFTEST_BUY: 'on', PB_RETRY_BASE_MS: '1' }, SELF_ENV), buyFetch);
    check('a label link that gives 404 is reported as INCOMPLETE ... pdf=LINK_ONLY(HTTP 404), not as a pass', /pb_buy_letter\[DOC_6X4\]=INCOMPLETE\(id=yes tracking=yes pdf=LINK_ONLY\(HTTP 404\)/.test(line), line);
    fileMode = 'plain';
    const inlineFile = async (u, init) => (isShip(u) && init.method === 'POST' ? resp(200, { shipmentId: 'IN1', parcelTrackingNumber: '9400111899223197428490', rate: { totalCarrierCharge: 0.78 }, labelLayout: [{ contentType: 'BASE64', contents: 'JVBERi0xLjQ=', fileFormat: 'PDF', size: 'DOC_6X4', type: 'SHIPPING_LABEL' }] }) : fullBuy(u, init));
    line = await pbSelfCheck(Object.assign({ PB_SELFTEST_BUY: 'on' }, SELF_ENV), inlineFile);
    check('a file that comes inline still counts (pdf=yes(inline))', /pb_buy_letter\[DOC_6X4\]=OK\(id=yes tracking=yes pdf=yes\(inline\) price=0\.78/.test(line) && !/JVBERi0/.test(line), line);
    buyCalls.length = 0;
    line = await pbSelfCheck(SELF_ENV, buyFetch);
    check('off (the default): nothing is bought', !/pb_buy/.test(line) && !buyCalls.some((c) => /shipments/.test(c.url)));
    buyCalls.length = 0;
    line = await pbSelfCheck(Object.assign({ PB_SELFTEST_BUY: 'on', PB_ENV: 'production', PB_LIVE_OK: 'yes' }, SELF_ENV), buyFetch);
    check('in production mode it NEVER buys, even if asked', !/pb_buy/.test(line) && !buyCalls.some((c) => /shipments/.test(c.url)), line);

    console.log('\n-- the sandbox refill and the letter label-size probe --');
    buyCalls.length = 0;
    const refillBodies = [];
    const refillFetch = async (u, init) => { buyCalls.push({ url: u, method: init.method }); if (/wallet\/refill/.test(u)) refillBodies.push(JSON.parse(init.body)); return fullBuy(u, init); };
    line = await pbSelfCheck(Object.assign({ PB_SELFTEST_BUY: 'on', PB_SELFTEST_REFILL: '50' }, SELF_ENV), refillFetch);
    check('with PB_SELFTEST_REFILL=50 (sandbox, test on) it tops up the wallet by 50 dollars and says so', /pb_refill=OK\(status=SUCCESS balance=62\.5\)/.test(line) && refillBodies.length === 1 && refillBodies[0].amount === 50 && refillBodies[0].carrierAccountId === 'acct_usps', line + JSON.stringify(refillBodies));
    check('the refill comes before the purchases', line.indexOf('pb_refill') < line.indexOf('pb_buy_letter'));
    buyCalls.length = 0; refillBodies.length = 0;
    await pbSelfCheck(Object.assign({ PB_SELFTEST_BUY: 'on', PB_SELFTEST_REFILL: '5000' }, SELF_ENV), refillFetch);
    await pbSelfCheck(Object.assign({ PB_SELFTEST_BUY: 'on', PB_SELFTEST_REFILL: 'abc' }, SELF_ENV), refillFetch);
    await pbSelfCheck(Object.assign({ PB_SELFTEST_REFILL: '50' }, SELF_ENV), refillFetch); // refill asked, but the rehearsal switch is off
    await pbSelfCheck(Object.assign({ PB_SELFTEST_BUY: 'on', PB_SELFTEST_REFILL: '50', PB_ENV: 'production', PB_LIVE_OK: 'yes' }, SELF_ENV), refillFetch);
    check('never refills: over 500 dollars, not a number, rehearsal off, or production', refillBodies.length === 0);
    const sizeFetch = async (u, init) => {
      if (isShip(u) && init.method === 'POST') {
        const size = JSON.parse(init.body).labelSize;
        if (size !== 'DOC_9X4') return resp(400, { errors: [{ errorCode: '1', message: 'Invalid label paper size.' }] });
        return answer('LB1', 'DOC_9X4');
      }
      return fullBuy(u, init);
    };
    line = await pbSelfCheck(Object.assign({ PB_SELFTEST_BUY: 'on' }, SELF_ENV), sizeFetch);
    check('the letter label size is probed in order, each refusal shown in PB\'s words, and it stops at the first size PB accepts', /pb_buy_letter\[DOC_6X4\]=FAILED\(400 Invalid label paper size\.\)/.test(line) && /pb_buy_letter\[DOC_9X4\]=OK\(id=yes/.test(line), line);
    line = await pbSelfCheck(Object.assign({ PB_SELFTEST_BUY: 'on', PB_SELFTEST_LETTER_SIZES: 'DOC_4X6, 9X4' }, SELF_ENV), sizeFetch);
    check('the sizes to try can be chosen (PB_SELFTEST_LETTER_SIZES)', /pb_buy_letter\[DOC_4X6\]=FAILED/.test(line) && /pb_buy_letter\[9X4\]=FAILED/.test(line) && !/DOC_6X4/.test(line.split('pb_buy_ground')[0]), line);

    console.log('\n-- the sample orders\' made-up street addresses (PB_SELFTEST_TO=sample) --');
    line = await pbSelfCheck(Object.assign({ PB_SELFTEST_BUY: 'on' }, SELF_ENV), buyFetch);
    check('off by default: no sample-address purchases', !/pb_buy_sample/.test(line));
    const sampleShips = [];
    const sampleFetch = (strict) => async (u, init) => {
      if (isShip(u) && init.method === 'POST') {
        const b = JSON.parse(init.body);
        sampleShips.push(b);
        if (strict && /Sample|Example/.test(b.toAddress.addressLine1) && !(b.shipmentOptions && b.shipmentOptions.minimalAddressValidation)) return resp(400, { errors: [{ errorCode: '2001', message: 'Invalid address: address not found.' }] });
      }
      return fullBuy(u, init);
    };
    line = await pbSelfCheck(Object.assign({ PB_SELFTEST_BUY: 'on', PB_SELFTEST_TO: 'sample' }, SELF_ENV), sampleFetch(false));
    check('on: the first two sample orders (one with an apartment line) are bought as letters and reported', /pb_buy_sample1=OK\(id=yes tracking=yes pdf=yes/.test(line) && /pb_buy_sample2=OK\(/.test(line) && !/_minimal/.test(line), line);
    check('they go to the sample addresses (Portland ME, Los Angeles CA) with the apartment line kept', sampleShips.some((b) => b.toAddress.cityTown === 'Portland' && b.toAddress.stateProvince === 'ME') && sampleShips.some((b) => b.toAddress.cityTown === 'Los Angeles' && b.toAddress.addressLine2 === 'Apt 2'));
    sampleShips.length = 0;
    line = await pbSelfCheck(Object.assign({ PB_SELFTEST_BUY: 'on', PB_SELFTEST_TO: 'sample' }, SELF_ENV), sampleFetch(true));
    check('if Pitney Bowes refuses a made-up street, its words are shown and the same letter is tried once more with minimalAddressValidation', /pb_buy_sample1=FAILED\(400 Invalid address: address not found\.\)/.test(line) && /pb_buy_sample1_minimal=OK\(/.test(line) && /pb_buy_sample2_minimal=OK\(/.test(line), line);
    const strictTries = sampleShips.filter((b) => /Sample|Example/.test(b.toAddress.addressLine1));
    check('and only that retry carries the option (the first try is the strict one)', strictTries.filter((b) => b.shipmentOptions && b.shipmentOptions.minimalAddressValidation === true).length === 2 && strictTries.filter((b) => !b.shipmentOptions).length === 2);
    buyCalls.length = 0;
    line = await pbSelfCheck(Object.assign({ PB_SELFTEST_BUY: 'on', PB_SELFTEST_TO: 'sample', PB_ENV: 'production', PB_LIVE_OK: 'yes' }, SELF_ENV), buyFetch);
    check('in production mode it still never buys', !/pb_buy/.test(line) && !buyCalls.some((c) => /shipments/.test(c.url)), line);

    console.log('\n-- fetching the label file behind a link (a PDF label is always a link) --');
    const fileRig = (handler) => {
      const calls = [];
      const client = makePbClient({ key: 'k', secret: 's', env: 'sandbox', carrierAccountId: 'acct_usps', sleep: async () => {},
        fetchImpl: async (u, init) => { calls.push({ url: u, init }); return isToken(u) ? resp(200, { access_token: 'TOK', expires_in: 14400 }) : handler(u, init); } });
      return { client, calls: () => calls.filter((c) => !isToken(c.url)), tokens: () => calls.filter((c) => isToken(c.url)).length };
    };
    let f = fileRig(() => fileResp(200));
    let got = await f.client.fetchFile(LABEL_LINK);
    check('a Pitney Bowes link is fetched with no credentials first; the bytes come back', got.ok && got.via === 'link' && got.bytes.equals(PDF) && f.calls().length === 1 && !f.calls()[0].init.headers.Authorization && f.tokens() === 0, JSON.stringify(f.calls().map((c) => c.url)));
    f = fileRig((u, init) => (init.headers.Authorization ? fileResp(200) : fileResp(403, Buffer.alloc(0))));
    got = await f.client.fetchFile(LABEL_LINK);
    check('a 403 from a Pitney Bowes host is answered with one more try carrying the token', got.ok && got.via === 'token' && f.calls().length === 2 && f.calls()[1].init.headers.Authorization === 'Bearer TOK');
    f = fileRig(() => fileResp(403, Buffer.alloc(0)));
    got = await f.client.fetchFile('https://labels.example.test/x.pdf');
    check('another host never gets the token, even when it answers 403', !got.ok && got.status === 403 && got.again === false && f.calls().length === 1 && !f.calls()[0].init.headers.Authorization && f.tokens() === 0);
    f = fileRig(() => fileResp(200));
    got = await f.client.fetchFile('http://prv-labels-cls.gcs.pitneycloud.com/x.pdf');
    check('an http link is refused without any request', !got.ok && f.calls().length === 0 && /https/.test(got.reason));
    got = await f.client.fetchFile('not a link');
    check('junk is refused without any request', !got.ok && f.calls().length === 0);
    f = fileRig(() => fileResp(200, PDF, { 'content-length': String(50 * 1024 * 1024) }));
    got = await f.client.fetchFile(LABEL_LINK);
    check('a file that says it is huge is refused (3 MB cap) before its body is read', !got.ok && /too large/.test(got.reason) && got.again === false);
    f = fileRig(() => fileResp(200, Buffer.alloc(4 * 1024 * 1024, 1)));
    got = await f.client.fetchFile(LABEL_LINK);
    check('and one that turns out huge is refused too', !got.ok && /too large/.test(got.reason));
    f = fileRig(() => fileResp(404, Buffer.alloc(0)));
    got = await f.client.fetchFile(LABEL_LINK);
    check('404 is "not there yet": worth trying again, and no token is sent for it', !got.ok && got.status === 404 && got.again === true && f.calls().length === 1 && f.tokens() === 0);
    f = fileRig(() => { throw Object.assign(new Error('boom'), { name: 'TimeoutError' }); });
    got = await f.client.fetchFile(LABEL_LINK);
    check('a network error never throws: it says what happened and is worth trying again', !got.ok && got.again === true && /TimeoutError/.test(got.reason), JSON.stringify(got));

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
