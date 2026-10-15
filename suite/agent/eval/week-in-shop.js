// "A week in a shop": one scripted week on made-up data, offline, from goals to approved actions, driven through the
// same checked messages the side panel uses. No model is called. It ends by checking the audit trail.
// Days run Monday Oct 12 to Sunday Oct 18, 2026 (the clock is set by the script).
import { makeWorld } from './harness.js';
import { createAgentService, PANEL_SOURCE, summarizeCall } from '../protocol.js';
import { scriptedModel } from '../loop.js';
import { createEventDetector } from '../events.js';
import { newJob, tickJobs, fireEvents } from '../jobs.js';
import { fillPlaceholders, firstNameOf } from '../support.js';

const EXT = 'abcdefghijklmnopabcdefghijklmnop';
const sender = { id: EXT, url: `chrome-extension://${EXT}/panel.html` };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function runWeekInShop() {
  const w = makeWorld({ clockStart: '2026-10-12T08:00:00Z' });
  const pristine = JSON.stringify(w.inventory);
  const model = scriptedModel([
    [{ type: 'tool_use', id: 'a1', name: 'automation.save', input: { automation: newJob({ id: 'low-stock-report', name: 'Low stock report', trigger: { type: 'event', value: 'low-stock' }, steps: [{ tool: 'inventory.restock', args: { windowDays: 60 } }] }) } }],
    [{ type: 'text', text: 'I asked to save the "Low stock report" job; it leaves a report whenever something runs low.' }],
    [{ type: 'text', text: "I can't do that one, and I won't guess. I can reprice cards, restock, report on buyers and shipping, find supply deals and draft replies." }],
  ]);
  const svc = createAgentService({ registry: w.registry, extensionId: EXT, agent: w.agent, model });
  const events = [];
  let n = 0;
  const send = (type, payload) => svc.handle({ source: PANEL_SOURCE, v: 1, id: 'p' + ++n, type, ...(payload === undefined ? {} : { payload }) }, sender, (e) => events.push(e));
  const answers = () => events.filter((e) => e.event === 'agent.answer').length;
  const ask = async (text) => { const before = answers(); const r = await send('agent.ask', { text }); if (!r.ok) return r; while (answers() === before) await sleep(5); return r; };
  const last = (name) => events.filter((e) => e.event === name).at(-1);
  const cards = () => w.inbox.list();

  const days = [];
  const checks = [];
  const check = (name, pass, detail = '') => checks.push({ name, pass: !!pass, detail });
  let day;
  const open = (name, title, at) => { w.state.now = at; day = { name, title, steps: [] }; days.push(day); };
  const did = (what) => day.steps.push(what);
  const t0 = Date.now();

  // ---- Monday: tell it about the shop, give it a goal, approve the change
  open('Mon', 'Tell it about the shop, set a goal, approve one change', '2026-10-12T08:00:00Z');
  const hello = (await send('agent.hello')).result;
  check('hello announces plans, memory, undo', ['agent.plan', 'agent.memory', 'agent.memory.list', 'agent.memory.forget', 'agent.undo'].every((t) => hello.types.includes(t)));
  await w.agent.remember({ text: 'I price 5% under market', key: 'price.percent', value: 5, category: 'preference' });
  await w.agent.remember({ text: 'I restock when 3 or fewer are left', key: 'restock.threshold', value: 3, category: 'setting' });
  did('Owner adds two shop facts to memory: price 5% under market; restock at 3 or fewer.');
  const stockBefore = JSON.stringify(w.inventory);
  await ask('Reprice my foils');
  const plan1 = events.filter((e) => e.event === 'agent.plan');
  check('goal produced a visible plan using the remembered 5%', plan1.length > 0 && /5% under market/.test(plan1[0].steps[0].text), plan1[0] && plan1[0].steps[0].text);
  check('nothing changed before approval', JSON.stringify(w.inventory) === stockBefore);
  const card1 = last('agent.approval-needed');
  check('approval card says what, why, expected effect and undo', card1 && /Change the saved price/.test(card1.description) && card1.why && card1.undo && /Total list value/.test(w.inbox.get(card1.approvalId).expected));
  did(`Goal "Reprice my foils" became a ${plan1[0].steps.length}-step plan; step 1 ran, step 2 became card ${card1.approvalId}.`);
  const ok1 = await send('agent.approve', { approvalId: card1.approvalId, approved: true });
  check('approved card ran once', ok1.ok && ok1.result.status === 'done' && JSON.stringify(w.inventory) !== stockBefore);
  did('Owner read the card and approved it; prices saved in the local stock list.');

  // ---- Tuesday: memory shapes the plan; the agent proposes a fact; a saved job
  open('Tue', 'Memory used in a plan, a proposed fact, a saved job', '2026-10-13T09:00:00Z');
  await ask('Restock what is running low');
  const restockPlan = last('agent.plan');
  check('restock plan used the remembered threshold of 3', /3 or fewer/.test(restockPlan.steps[0].text), restockPlan.steps[0].text);
  did('Goal "Restock what is running low" used the remembered threshold (3 or fewer), not the default 2.');
  await ask('Remember that I never list below 50 cents');
  const memCard = last('agent.approval-needed');
  check('agent-proposed fact waited for approval', w.memory.search('50 cents').length === 0 && memCard.tool === 'memory.remember');
  await send('agent.approve', { approvalId: memCard.approvalId, approved: true });
  check('fact remembered after approval, marked as agent-written', w.memory.search('50 cents')[0] && w.memory.search('50 cents')[0].source === 'agent');
  did('Agent proposed remembering "never list below 50 cents"; owner approved.');
  // this one has no recipe, so the (scripted) model handles it; the model's run waits for the owner's tap
  const askedBefore = events.filter((e) => e.event === 'agent.approval-needed').length;
  await send('agent.ask', { text: 'Set up a report whenever something runs low' });
  while (events.filter((e) => e.event === 'agent.approval-needed').length === askedBefore) await sleep(5);
  const jobCard = last('agent.approval-needed');
  check('saving a job needs approval and says what happens', jobCard.tool === 'automation.save' && /Low stock report/.test(jobCard.description) && w.automations.list().length === 0);
  const answersBefore = answers();
  await send('agent.approve', { approvalId: jobCard.approvalId, approved: true });
  while (answers() === answersBefore) await sleep(5);
  check('saved job is approval-required by default', w.automations.get('low-stock-report').approvalMode === 'always');
  w.automations.save(newJob({ id: 'unanswered', name: 'Unanswered messages', trigger: { type: 'event', value: 'unanswered-message' }, steps: [{ tool: 'messages.unanswered' }, { tool: 'support.draftReply', args: { orderId: 'ORD-1010', buyerMessage: 'Hi, where is my order? It has been a week.' } }] }));
  w.automations.save(newJob({ id: 'friday', name: 'Friday wrap-up', trigger: { type: 'cron', value: '0 8 * * 5' }, steps: [{ tool: 'report.weeklyDraft' }, { tool: 'report.chart', args: { kind: 'orders-per-week', weeks: 8 } }, { tool: 'inventory.setPrices', args: { changes: [{ printingId: w.inventory[1].printingId, condition: 'NM', finish: w.inventory[1].finish, priceCents: 777 }] } }] }));
  did('Agent proposed a "Low stock report" job (owner approved). Owner added two more jobs in settings: unanswered messages, Friday wrap-up.');

  // ---- Wednesday: events start jobs, a draft with no buyer name in it
  const detector = createEventDetector({ orders: w.orders, inventory: w.inventory, printings: w.printings, messages: w.messages, memory: w.memory, now: w.nowIso });
  open('Wed', 'Events start background jobs; reports are left for the owner', '2026-10-14T10:00:00Z');
  w.state.now = '2026-10-14T11:00:00Z';
  const evs = detector.detect();
  const fired = await fireEvents({ store: w.automations, events: evs, registry: w.registry, inbox: w.inbox, reports: w.reports, now: w.nowIso() });
  check('event jobs ran and left reports', fired.length >= 1 && w.reports.list().length === fired.length, `${fired.length} jobs`);
  const draftReport = w.reports.list().find((r) => (r.drafts || []).some((d) => d.tool === 'support.draftReply'));
  const replyDraft = draftReport && draftReport.drafts.find((d) => d.tool === 'support.draftReply').result;
  check('report holds a draft with a placeholder, not a name', replyDraft && replyDraft.draft.includes('{{first_name}}') && replyDraft.sent === false);
  const buyer = w.orders.find((o) => o.id === 'ORD-1010');
  const shown = fillPlaceholders(replyDraft.draft, { firstName: firstNameOf(buyer) });
  check('name is filled in on the device only', shown.includes(firstNameOf(buyer)) && !JSON.stringify(draftReport).includes(firstNameOf(buyer) + ' '));
  did(`Clock moved; events detected: ${Object.entries(evs.reduce((m, e) => ({ ...m, [e.type]: (m[e.type] || 0) + 1 }), {})).map(([k, v]) => v + ' ' + k).join(', ') || 'none'}. ${fired.length} background job(s) ran and left reports; the reply draft says {{first_name}}, filled in only on screen.`);

  // ---- Thursday: more goals, an honest "no", and the kill switch
  open('Thu', 'Another goal, an honest "I cannot", and the kill switch', '2026-10-15T14:00:00Z');
  await ask('Find deals on sleeves');
  check('deal goal ran read-only', last('agent.answer').status === 'done');
  await ask('Make me rich');
  check('unknown goal gets an honest no, with no tool run', last('agent.answer').status === 'done' && /can't do that/.test(last('agent.answer').text) && last('agent.answer').calls.length === 0);
  const before4 = cards().length;
  await ask('Reprice my foils 10% under market');
  const stopCard = last('agent.approval-needed');
  await send('agent.stop');
  const refused = await send('agent.approve', { approvalId: stopCard.approvalId, approved: true });
  check('kill switch: approval refused, card still waiting', !refused.ok && /kill switch/.test(refused.error) && w.inbox.get(stopCard.approvalId).status === 'pending');
  const reportsBefore = w.reports.list().length;
  const askWhileStopped = await send('agent.ask', { text: 'Reprice my foils 10% under market' });
  const tickWhileStopped = await tickJobs({ store: w.automations, registry: w.registry, inbox: w.inbox, reports: w.reports, now: '2026-10-16T08:00:00Z' });
  check('kill switch: questions refused, scheduled jobs skipped with no report', !askWhileStopped.ok && tickWhileStopped.length >= 1 && tickWhileStopped.every((r) => r.skipped) && w.reports.list().length === reportsBefore);
  await send('agent.resume');
  const dec = await send('agent.approve', { approvalId: stopCard.approvalId, approved: false });
  check('after resume the owner can decline', dec.ok && w.inbox.get(stopCard.approvalId).status === 'declined');
  did(`Deals goal ran; "Make me rich" got an honest no. A new reprice card at 10% under market (${stopCard.approvalId}) appeared; owner hit Stop: approving was refused, questions and scheduled jobs did nothing. Resumed, then declined the card.`);
  check('cards created this day', cards().length === before4 + 1);

  // ---- Friday: a cron job, a card from it, a decline
  open('Fri', 'A scheduled job leaves a report and a card; owner declines the card', '2026-10-16T08:00:00Z');
  const ran = await tickJobs({ store: w.automations, registry: w.registry, inbox: w.inbox, reports: w.reports, now: '2026-10-16T08:00:00Z' });
  check('Friday job ran at 8am and left a report', ran.length === 1 && ran[0].report.title === 'Friday wrap-up');
  const fCard = w.inbox.get(ran[0].report.cardIds[0]);
  check('its change waited as a card (nothing acted on its own)', fCard.status === 'pending' && fCard.actor === 'automation' && w.inventory[1].priceCents !== 777);
  w.inbox.decline(fCard.id);
  const again = await tickJobs({ store: w.automations, registry: w.registry, inbox: w.inbox, reports: w.reports, now: '2026-10-16T08:00:20Z' });
  check('job does not run twice in the same minute', again.length === 0);
  did('Friday 8am job ran by itself: weekly summary, chart numbers, and one price change that became a card. Owner declined the card.');

  // ---- Sunday: undo, suggestions, and the audit trail
  open('Sun', 'Undo a change, "five things worth doing", read the audit trail', '2026-10-18T18:00:00Z');
  const undo = await send('agent.undo', { approvalId: card1.approvalId });
  check('undo put Monday\'s prices back exactly', undo.ok && JSON.stringify(w.inventory) === pristine.replace(/^/, '') || JSON.stringify(w.inventory) === JSON.stringify(JSON.parse(pristine)));
  const sug = (await send('agent.suggestions')).result.suggestions;
  check('five suggestions, each with real numbers', sug.length === 5 && sug.every((s) => /\d/.test(s.why)));
  const startable = sug.find((s) => s.goal);
  await ask(startable.goal);
  check('a suggestion turns into a plan with one tap', last('agent.plan') && last('agent.plan').steps.length > 0);
  did(`Owner undid Monday's price change. The agent suggested: ${sug.map((s) => s.title).join('; ')}. Owner tapped "${startable.title}" and a plan appeared.`);

  // ---- the audit trail
  const audit = await w.audit.list();
  const jsonl = await w.audit.exportJsonl();
  const act = audit.filter((e) => e.tier === 'act');
  const allText = JSON.stringify({ events, reports: w.reports.list(), jsonl });
  const names = [...new Set(w.orders.map((o) => o.shipTo.name))];
  const okActs = act.filter((e) => e.outcome === 'ok');
  check('every act-level change that ran names who approved it; refusals are logged as denied', okActs.length > 0 && okActs.every((e) => e.approvedBy) && act.filter((e) => e.outcome !== 'ok').every((e) => e.outcome === 'denied' && !e.approvedBy));
  check('audit entries hold hashes, never arguments', audit.every((e) => /^[0-9a-f]{64}$/.test(e.argsHash)) && !/priceCents|buyerMessage/.test(jsonl));
  check('no buyer name or street address in any event, report or audit line', !names.some((nm) => allText.includes(nm)) && !allText.includes('Example St'));
  check('audit export is one JSON object per line', jsonl.trim().split('\n').every((l) => JSON.parse(l).tool));
  check('kill switch left denied entries in the trail', audit.some((e) => e.outcome === 'denied'));
  const byStatus = {};
  for (const c of cards()) byStatus[c.status] = (byStatus[c.status] || 0) + 1;
  const direct = okActs.filter((e) => ['memory.add', 'memory.edit', 'memory.delete'].includes(e.tool)).length;
  const viaCards = okActs.length - direct;
  const chatApproved = events.filter((e) => e.event === 'agent.approval-needed' && e.approvalId.startsWith('ap-')).length; // every one was approved in this week
  check('changes that ran = approved cards + undos + approved chat steps (nothing else changed anything)', viaCards === (byStatus.done || 0) + 2 * (byStatus.undone || 0) + chatApproved, `ran ${viaCards}, done ${byStatus.done}, undone ${byStatus.undone}, chat ${chatApproved}`);
  did(`Audit trail: ${audit.length} entries, ${act.length} act-level (${okActs.length} ran, each with an approver; ${act.length - okActs.length} refused).`);

  const tiers = {}, outcomes = {};
  for (const e of audit) { tiers[e.tier] = (tiers[e.tier] || 0) + 1; outcomes[e.outcome] = (outcomes[e.outcome] || 0) + 1; }
  const evCounts = {};
  for (const e of events) evCounts[e.event] = (evCounts[e.event] || 0) + 1;
  return {
    days, checks,
    pass: checks.every((c) => c.pass),
    measured: {
      checks: checks.length, checksPassed: checks.filter((c) => c.pass).length,
      auditEntries: audit.length, byTier: tiers, byOutcome: outcomes,
      cards: cards().length, cardsByStatus: byStatus,
      plans: w.agent.runs.size, reports: w.reports.list().length, memoryFacts: w.memory.list().length,
      panelEvents: events.length, eventsByType: evCounts,
      milliseconds: Date.now() - t0,
    },
    auditJsonl: jsonl,
  };
}
