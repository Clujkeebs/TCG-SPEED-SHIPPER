// Renders the panel. Everything is added as plain text (never as markup), so nothing an agent
// says can become markup or script.
import { getFlags } from '../flags.js';
import { createPanel } from '../agent/panel-controller.js';
import { createRuntimeTransport } from '../agent/runtime-transport.js';
import { createTour, tourSeen, markTourSeen } from './tour.js';

const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; };

const flags = await getFlags();
if (!flags.agentPanel) {
  $('off').hidden = false;
  $('stop').hidden = true;
  $('again').hidden = true;
} else {
  const panel = createPanel(createRuntimeTransport());
  const s = panel.state;
  let focusedCard = null;

  // Re-drawing the list must not throw away keyboard focus: remember what was focused, put it back after.
  function focusKey() {
    const a = document.activeElement;
    if (!a || a === document.body) return null;
    const card = a.closest?.('[data-card-id]');
    if (!card) return null;
    return { card: card.dataset.cardId, btn: a === card ? null : (a.dataset.answer ? 'answer:' + a.dataset.answer : a.dataset.undo ? 'undo' : null) };
  }
  function restoreFocus(k) {
    if (!k) return;
    const card = document.querySelector(`[data-card-id="${k.card}"]`);
    if (!card) return;
    const target = k.btn === null ? card : k.btn === 'undo' ? card.querySelector('[data-undo]') : card.querySelector(`[data-answer="${k.btn.slice(7)}"]`);
    (target || card).focus();
  }

  function render() {
    const keep = focusKey();
    $('practice').hidden = false;
    $('body').hidden = false;
    $('form').hidden = false;
    $('stop').hidden = s.killed;
    $('resume').hidden = !s.killed;
    $('go').disabled = s.busy || s.killed;

    $('plan').hidden = s.plan.length === 0;
    $('planlist').replaceChildren(...s.plan.map((p) => el('li', p.state, p.text + (p.state === 'done' ? ' (done)' : p.state === 'doing' ? ' (working on it)' : p.state === 'skipped' ? ' (skipped)' : ''))));

    $('log').replaceChildren(...s.items.map((i) => {
      if (i.kind !== 'approval') return el('div', 'msg ' + i.kind, i.text);
      const card = el('div', 'card');
      card.setAttribute('role', 'group');
      card.setAttribute('aria-label', 'Needs your OK');
      card.tabIndex = -1;
      card.dataset.cardId = i.id;
      card.append(el('h3', '', 'Needs your OK: ' + i.description));
      const dl = el('dl');
      for (const row of i.rows) dl.append(el('dt', '', row.label + ':'), el('dd', '', row.value));
      card.append(dl);
      if (i.why) card.append(el('p', 'why', 'Why: ' + i.why));
      if (i.expected) card.append(el('p', 'why', 'What will change: ' + i.expected));
      if (i.undo) card.append(el('p', 'why', 'Undo: ' + i.undo));
      if (i.state === 'waiting') {
        for (const [label, ok] of [['Approve', true], ['Deny', false]]) {
          const b = el('button', '', label);
          b.dataset.answer = ok ? 'approve' : 'deny';
          b.addEventListener('click', () => panel.answer(i.id, ok));
          card.append(b);
        }
      } else {
        card.append(el('em', '', { approved: 'You approved this.', denied: 'You denied this.', undone: 'Put back as it was.', expired: 'This is no longer waiting.' }[i.state]));
        if (i.state === 'approved' && s.canUndo) {
          const u = el('button', '', 'Undo');
          u.dataset.undo = i.id;
          u.addEventListener('click', () => panel.undo(i.id));
          card.append(' ', u);
        }
      }
      return card;
    }));

    $('suggest').hidden = s.suggestions.length === 0;
    $('suglist').replaceChildren(...s.suggestions.map((x) => {
      const li = el('li');
      li.append(el('strong', '', x.title), el('div', 'small', x.why));
      if (x.goal && !s.busy && !s.killed) {
        const b = el('button', '', 'Do this');
        b.dataset.goal = x.id;
        b.addEventListener('click', () => panel.start(x.goal));
        li.append(b);
      }
      return li;
    }));
    $('jobs').hidden = !s.canJobs;
    $('joblist').replaceChildren(...s.jobs.map((j) => {
      const li = el('li');
      const t = el('span', '', `${j.name} · ${j.when}${j.enabled ? '' : ' (off)'}`);
      const box = el('span');
      const tog = el('button', '', j.enabled ? 'Turn off' : 'Turn on');
      tog.dataset.toggle = j.id;
      tog.addEventListener('click', () => panel.toggleJob(j.id, !j.enabled));
      const rm = el('button', '', 'Remove');
      rm.dataset.remove = j.id;
      rm.addEventListener('click', () => panel.removeJob(j.id));
      box.append(tog, ' ', rm);
      li.append(t, box);
      return li;
    }));
    $('reports').replaceChildren(...s.reports.slice(-3).map((r) => el('div', 'report', `${r.title}\n${r.text}`)));
    $('memory').hidden = !s.canMemory || s.memory === null;
    $('memlist').replaceChildren(...(s.memory || []).map((m) => {
      const li = el('li');
      const b = el('button', '', 'Forget');
      b.dataset.forget = m.id;
      b.addEventListener('click', () => panel.forget(m.id));
      li.append(el('span', '', m.text), b);
      return li;
    }));
    $('body').scrollTop = $('body').scrollHeight;
    restoreFocus(keep);
    // A new card that needs an answer gets keyboard focus once, so it is the next thing a keyboard user reaches.
    const waiting = s.items.find((x) => x.kind === 'approval' && x.state === 'waiting');
    if (waiting && waiting.id !== focusedCard) {
      focusedCard = waiting.id;
      document.querySelector(`[data-card-id="${waiting.id}"]`)?.focus();
    }
  }

  panel.subscribe(render);
  $('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const goal = $('goal').value;
    if (await panel.start(goal)) $('goal').value = '';
  });
  $('goal').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); $('form').requestSubmit(); }
  });
  $('addDaily').addEventListener('click', () => panel.addJob('daily'));
  $('addMinute').addEventListener('click', () => panel.addJob('minute'));
  $('stop').addEventListener('click', () => panel.stop());
  $('resume').addEventListener('click', () => panel.resume());
  const tour = createTour();
  function showTour() {
    const t = $('tour');
    t.hidden = false;
    $('tourCount').textContent = `Step ${tour.index + 1} of ${tour.total}`;
    $('tourTitle').textContent = tour.step.title;
    $('tourBody').textContent = tour.step.body;
    $('tourBack').disabled = tour.isFirst;
    $('tourNext').textContent = tour.isLast ? 'Done' : 'Next';
    $('tourTitle').focus();
  }
  async function closeTour() { $('tour').hidden = true; await markTourSeen(); $('goal').focus(); }
  $('tourNext').addEventListener('click', () => { if (tour.isLast) closeTour(); else { tour.next(); showTour(); } });
  $('tourBack').addEventListener('click', () => { tour.back(); showTour(); });
  $('tourSkip').addEventListener('click', closeTour);
  $('tour').addEventListener('keydown', (e) => { if (e.key === 'Escape') closeTour(); });
  $('again').addEventListener('click', () => { while (!tour.isFirst) tour.back(); showTour(); });

  if (!(await panel.connect())) $('offline').hidden = false;
  // Jobs run in the background: look again now and then while the panel is open (read-only lookups).
  setInterval(() => { if (!document.hidden) panel.refresh(); }, 15000);
  render();
  if (!(await tourSeen())) showTour();
}
