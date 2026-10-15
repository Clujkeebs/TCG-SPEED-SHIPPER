// Renders the panel. Everything is added as plain text (never as markup), so nothing an agent
// says can become markup or script.
import { getFlags } from '../flags.js';
import { createPanel } from '../agent/panel-controller.js';
import { createFixtureTransport } from '../agent/fixture-transport.js';

const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; };

const flags = await getFlags();
if (!flags.agentPanel) {
  $('off').hidden = false;
} else {
  $('practice').hidden = false;
  $('form').hidden = false;
  const panel = createPanel(createFixtureTransport());

  function render() {
    const log = $('log');
    log.replaceChildren(...panel.items.map((i) => {
      if (i.kind === 'approval') {
        const card = el('div', 'card');
        card.append(el('h2', '', 'Needs your OK: ' + i.description));
        const dl = el('dl');
        for (const row of i.args) { dl.append(el('dt', '', row.label + ':'), el('dd', '', String(row.value))); }
        card.append(dl);
        if (i.state === 'waiting') {
          for (const [label, ok] of [['Approve', true], ['Deny', false]]) {
            const b = el('button', '', label);
            b.dataset.answer = ok ? 'approve' : 'deny';
            b.addEventListener('click', () => panel.answer(i.id, ok));
            card.append(b);
          }
        } else card.append(el('em', '', i.state === 'approved' ? 'You approved this.' : 'You denied this.'));
        return card;
      }
      return el('div', 'msg ' + i.kind, i.text);
    }));
    log.scrollTop = log.scrollHeight;
    $('go').disabled = panel.busy;
  }
  panel.subscribe(render);
  $('form').addEventListener('submit', (e) => {
    e.preventDefault();
    if (panel.say($('text').value)) $('text').value = '';
  });
  render();
}
