// Renders the panel. Everything is added as plain text (never as markup), so nothing an agent
// says can become markup or script.
import { getFlags } from '../flags.js';
import { createPanel } from '../agent/panel-controller.js';
import { createRuntimeTransport } from '../agent/runtime-transport.js';

const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; };

const flags = await getFlags();
if (!flags.agentPanel) {
  $('off').hidden = false;
  $('stop').hidden = true;
} else {
  const panel = createPanel(createRuntimeTransport());
  const s = panel.state;

  function render() {
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
      card.append(el('h3', '', 'Needs your OK: ' + i.description));
      const dl = el('dl');
      for (const row of i.rows) dl.append(el('dt', '', row.label + ':'), el('dd', '', row.value));
      card.append(dl);
      if (i.why) card.append(el('p', '', 'Why: ' + i.why));
      if (i.undo) card.append(el('p', '', 'Undo: ' + i.undo));
      if (i.state === 'waiting') {
        for (const [label, ok] of [['Approve', true], ['Deny', false]]) {
          const b = el('button', '', label);
          b.dataset.answer = ok ? 'approve' : 'deny';
          b.addEventListener('click', () => panel.answer(i.id, ok));
          card.append(b);
        }
      } else card.append(el('em', '', { approved: 'You approved this.', denied: 'You denied this.', expired: 'This is no longer waiting.' }[i.state]));
      return card;
    }));

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
  }

  panel.subscribe(render);
  $('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const goal = $('goal').value;
    if (await panel.start(goal)) $('goal').value = '';
  });
  $('stop').addEventListener('click', () => panel.stop());
  $('resume').addEventListener('click', () => panel.resume());
  if (!(await panel.connect())) $('offline').hidden = false;
  render();
}
