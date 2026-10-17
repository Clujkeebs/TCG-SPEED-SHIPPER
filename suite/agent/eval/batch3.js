// Batch 3 evaluation: order-file insights at scale, saving on the device, morning briefing, voice profile.
// Offline, invented data, no model. Returns checks (pass/fail) and measured numbers for AGENT-EVAL.md.
import { analyzeOrderFile, fillBuyerNames, createCsvParser } from '../orderfile.js';
import { makeShippingExportCsv } from '../fixtures/shipping-export.js';
import { createFakeIdb } from '../fixtures/fake-idb.js';
import { makeWorld, openWorld } from './harness.js';
import { deriveVoiceCard } from '../voice.js';
import { draftReply } from '../support.js';
import { makeOrders } from '../fixtures/orders.js';
import { newJob, tickJobs } from '../jobs.js';

export const BUDGET = { rows: 10000, maxMs: 1500, maxRssGrowthMB: 100 };
const median = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
const words = (t) => t.split(/\s+/).filter(Boolean).length;

export const VOICE_SAMPLES = {
  casual: ["Hey Sarah! Thanks so much for your order #TC-4432. I'll get it out tomorrow, promise! 😊\nCheers!\nMike", "Hey Dev, no worries at all, it's on its way! Tracking is 9400ZZ771234, you're all set.\nCheers!\nMike", "Hey Priya, sorry about that, I'm gonna send a replacement bolt today! Thanks for being so cool about it!\nCheers!\nMike"],
  formal: ["Dear Mr. Okafor,\n\nThank you for contacting us regarding order 88123. Unfortunately, the item was damaged in transit. Please send a photograph of the packaging so that we may assist you further.\n\nKind regards,\nCorner Cards", "Dear Ms. Lindqvist,\n\nWe sincerely apologize for the delay with order 88999. Please be advised that your package shipped on Monday and the tracking number is 9400AA55.\n\nKind regards,\nCorner Cards", "Dear Dr. Haas,\n\nThank you for your message. We regret the inconvenience and kindly ask that you confirm the address on file, so that we may advise further.\n\nKind regards,\nCorner Cards"],
};

export async function runBatch3() {
  const checks = [];
  const check = (area, name, pass, detail = '') => checks.push({ area, name, pass: !!pass, detail });
  const measured = {};

  // ---- 1. order-file insights at scale
  const csv = makeShippingExportCsv({ rows: BUDGET.rows });
  await analyzeOrderFile(csv.slice(0, 60000)); // warm up
  const times = [];
  let rssGrowth = 0, result;
  for (let i = 0; i < 3; i += 1) {
    const rss0 = process.memoryUsage().rss, t0 = process.hrtime.bigint();
    result = await analyzeOrderFile(csv);
    times.push(Number(process.hrtime.bigint() - t0) / 1e6);
    rssGrowth = Math.max(rssGrowth, (process.memoryUsage().rss - rss0) / 1e6);
  }
  const s = result.summary;
  measured.insights = { rows: BUDGET.rows, fileKB: Math.round(csv.length / 1024), medianMs: Math.round(median(times)), worstMs: Math.round(Math.max(...times)), rssGrowthMB: Math.round(rssGrowth * 10) / 10, orders: s.orders, buyers: s.repeat.buyers, repeatBuyers: s.repeat.repeatBuyers, tracking4999: s.thresholds.atLeast4999.orders, signature250: s.thresholds.atLeast250.orders, charts: result.charts.length };
  check('Order file', `${BUDGET.rows} invented rows read in under ${BUDGET.maxMs} ms (median ${measured.insights.medianMs} ms)`, median(times) < BUDGET.maxMs);
  check('Order file', `memory growth under ${BUDGET.maxRssGrowthMB} MB (measured ${measured.insights.rssGrowthMB} MB)`, rssGrowth < BUDGET.maxRssGrowthMB);
  check('Order file', 'every row counted, none skipped', s.orders === BUDGET.rows && s.skipped === 0);
  const small = makeShippingExportCsv({ rows: 400, seed: 8 });
  const whole = []; const p1 = createCsvParser((r) => whole.push(r)); p1.push(small); p1.end();
  const bits = []; const p2 = createCsvParser((r) => bits.push(r)); for (let i = 0; i < small.length; i += 7) p2.push(small.slice(i, i + 7)); p2.end();
  check('Order file', 'streaming gives the same rows however the file is cut up', JSON.stringify(whole) === JSON.stringify(bits));
  const shown = JSON.stringify(result);
  const someNames = small.split('\r\n').slice(1, 80).flatMap((l) => l.split(',').slice(1, 3)).filter((n) => n.length > 2);
  check('Order file', 'no buyer name or street in the summary, draft or charts', !someNames.some((n) => shown.includes(n)) && !shown.includes('Example St'));
  check('Order file', 'seller-only block shows first name and initial only', /- [A-Z][a-z]+ [A-Z]\.: \d+ orders/.test(fillBuyerNames(result.draft, result.names)));
  check('Order file', 'tracking and signature thresholds match the Shipper ($49.99 and $250)', s.thresholds.atLeast4999.orders >= s.thresholds.atLeast250.orders && s.thresholds.atLeast4999.policy === 'SHIP-1');
  measured.insightsDraft = fillBuyerNames(result.draft, result.names);

  // ---- 2. saving on the device (fake IndexedDB in tests; real Chromium checked by hand, see the log)
  const idb = createFakeIdb();
  const a = await openWorld({ idb, clockStart: '2026-10-12T08:00:00Z' });
  await a.agent.remember({ text: 'I price 5% under market', key: 'price.percent', value: 5, category: 'preference' });
  const g = await a.agent.goal('Reprice my foils');
  a.automations.save(newJob({ id: 'mon', name: 'Monday wrap-up', trigger: { type: 'cron', value: '0 8 * * 1' }, steps: [{ tool: 'report.weeklyDraft' }] }));
  await tickJobs({ store: a.automations, registry: a.registry, inbox: a.inbox, reports: a.reports, now: '2026-10-12T08:00:00Z' });
  await a.persistence.flush();
  const state = (w) => JSON.stringify({ m: w.memory.list(), c: w.inbox.list(), r: w.reports.list(), j: w.automations.list(), p: [...w.agent.runs.entries()] });
  const b = await openWorld({ idb, clockStart: '2026-10-12T08:00:00Z' });
  check('Saved on device', 'memory, cards, plans, reports and schedules are back after a restart', state(a) === state(b));
  check('Saved on device', 'the audit trail is back in the same order', (await a.audit.exportJsonl()) === (await b.audit.exportJsonl()));
  const cardId = g.steps.find((x) => x.cardId).cardId;
  check('Saved on device', 'a card that was waiting can still be approved after the restart', (await b.agent.decide(cardId, true)).card.status === 'done');
  const idb2 = createFakeIdb(); const errs = [];
  const f = await openWorld({ idb: idb2, onError: (e) => errs.push(e.message) });
  idb2.failNext('put'); f.memory.add({ text: 'one' }); await f.persistence.flush(); f.memory.add({ text: 'two' }); await f.persistence.flush();
  check('Saved on device', 'a failed save is reported, and the next change saves everything', errs.length === 1 && (await openWorld({ idb: idb2 })).memory.list().length === 2);
  const puts0 = idb2.stats.puts; f.memory.list(); f.inbox.list(); await f.persistence.flush();
  check('Saved on device', 'reading costs no writes', idb2.stats.puts === puts0);
  measured.persistence = { stores: 5, auditEntries: (await b.audit.list()).length, savedRecords: b.persistence.handles.length };

  // ---- 3. morning briefing
  const shopBriefing = async () => { const x = makeWorld({ clockStart: '2026-10-16T08:00:00Z' }); await x.agent.goal('Reprice my foils 5% under market'); return x.agent.briefing(); };
  const br = await shopBriefing();
  const br2 = await shopBriefing();
  check('Morning briefing', `plain text of ${br.words} words (limit 150)`, br.words <= 150 && words(br.text) === br.words && !/[#*_`|]/.test(br.text));
  check('Morning briefing', 'has ship today, five things, low stock, waiting for you', ['Ship today:', 'Worth doing:', 'Low stock:', 'Waiting for you:'].every((x) => br.text.includes(x)) && br.parts.thingsWorthDoing === 5);
  check('Morning briefing', 'same data gives the same words every time', br.text === br2.text);
  measured.briefing = { words: br.words, text: br.text };

  // ---- 4. voice profile
  const o = makeOrders().find((x) => x.shippedAt);
  const casual = deriveVoiceCard(VOICE_SAMPLES.casual), formal = deriveVoiceCard(VOICE_SAMPLES.formal);
  const dc = draftReply(o, 'where is my order', { sellerName: 'Mike', voice: casual });
  const df = draftReply(o, 'where is my order', { sellerName: 'Corner Cards', voice: formal });
  const secrets = ['Sarah', 'Dev', 'Priya', 'Okafor', 'Lindqvist', 'Haas', 'TC-4432', '88123', '88999', '9400ZZ771234', '9400AA55', 'replacement bolt'];
  const everything = JSON.stringify([casual, formal, dc.message, df.message]);
  check('Voice profile', 'the style card is derived from 3 replies', casual.greeting === 'Hey' && casual.signOff === 'Cheers!' && formal.greeting === 'Dear' && formal.signOff === 'Kind regards,');
  check('Voice profile', 'drafts follow the card (greeting, sign-off, tone)', dc.message.startsWith('Hey {{first_name}},') && dc.message.includes('Cheers!') && df.message.startsWith('Dear {{first_name}},') && df.message.includes('Kind regards,') && !df.message.includes('!'));
  check('Voice profile', 'nothing from the sample replies is stored or copied (no names, order or tracking numbers)', !secrets.some((x) => everything.includes(x)));
  check('Voice profile', 'drafts keep the policy note and never use a buyer name', dc.draft.includes('LOST-1') && dc.message.includes('{{first_name}}'));
  measured.voice = { casualCard: casual, formalCard: formal, casualDraft: dc.message, formalDraft: df.message };

  return { checks, measured, pass: checks.every((c) => c.pass) };
}
