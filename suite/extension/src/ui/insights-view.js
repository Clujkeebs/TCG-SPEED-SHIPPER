// The Insights tab: importing the seller's order file and showing plain numbers. All text is added as
// plain text. The file is read on this device and saved only in this browser's own storage.
import { importOrderText } from '../orders/index.js';
import { parseStockExport } from '../stock/parser.js';
import { computeInsights } from '../orders/insights.js';

const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; };
const usd = (c) => '$' + (c / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const when = (ms) => (ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`);

export function renderInsights(root, ins) {
  root.replaceChildren();
  if (!ins) return;
  const sec = (title) => { const s = el('div'); s.append(el('h2', '', title)); root.append(s); return s; };

  const o = sec('Overview');
  const stat = el('div', 'stat');
  for (const [label, value] of [['Orders', ins.orders.toLocaleString('en-US')], ['Average order', usd(ins.averageOrderCents)], ['From', ins.from], ['To', ins.to]]) {
    const d = el('div'); d.append(el('span', 'small', label), el('b', '', value)); stat.append(d);
  }
  o.append(stat);

  const w = sec('Latest week and the week before');
  w.append(el('p', 'small', 'The 7 days up to your newest order, compared with the 7 days before.'));
  const rows = el('ul', 'rows');
  const line = (a, b) => { const li = el('li'); li.append(el('span', '', a), el('strong', '', b)); rows.append(li); };
  line('Latest week', `${ins.thisWeek.orders} orders · ${usd(ins.thisWeek.revenueCents)}`);
  line('Week before', `${ins.lastWeek.orders} orders · ${usd(ins.lastWeek.revenueCents)}`);
  line('Change in sales', ins.changePct === null ? 'not enough data' : `${ins.changePct > 0 ? '+' : ''}${ins.changePct}%`);
  w.append(rows);

  const r = sec('Repeat buyers');
  r.append(el('p', 'small', `${ins.repeat.repeatBuyers} of ${ins.repeat.buyers} buyers ordered more than once (${ins.repeat.shareOfOrders}% of orders). First name and last initial only.`));
  const rl = el('ul', 'rows');
  if (!ins.repeat.top.length) rl.append(el('li', '', 'No one has ordered twice yet.'));
  for (const b of ins.repeat.top) { const li = el('li'); li.append(el('span', '', b.label), el('strong', '', `${b.orders} orders · ${usd(b.spendCents)}`)); rl.append(li); }
  r.append(rl);

  const s = sec('Where you ship most');
  const sl = el('ul', 'rows');
  for (const st of ins.states) { const li = el('li'); const bar = el('span', 'bar'); bar.style.width = Math.max(4, Math.round(st.share)) + 'px'; bar.setAttribute('aria-hidden', 'true'); const right = el('strong', '', `${st.orders} (${st.share}%)`); li.append(el('span', '', st.state), right); li.append(bar); sl.append(li); }
  s.append(sl);

  const d = sec('Busiest days');
  const dl = el('ul', 'rows');
  const max = Math.max(1, ...ins.weekdays.map((x) => x.orders));
  for (const x of ins.weekdays) { const li = el('li'); const bar = el('span', 'bar'); bar.style.width = Math.max(2, Math.round((x.orders / max) * 100)) + 'px'; bar.setAttribute('aria-hidden', 'true'); li.append(el('span', '', x.day + (x.day === ins.busiestWeekday ? ' (busiest)' : '')), el('strong', '', String(x.orders)), bar); dl.append(li); }
  d.append(dl);
}

// Wires the drop zone and buttons. deps: { store, panel, setLabels(orders), onChange() }
export function wireImport({ $, store, panel, setOrders }) {
  const status = $('importStatus');
  const say = (text, bad = false) => { status.textContent = text; status.className = bad ? 'err' : ''; };

  async function handleFile(file) {
    if (!file) return;
    if (!/\.csv$/i.test(file.name) && file.type !== 'text/csv') return say('Please choose the CSV file you export from TCGplayer.', true);
    say('Reading the file on this computer…');
    let text;
    try { text = await file.text(); } catch { return say('I could not open that file. Try choosing it again.', true); }
    const res = await importOrderText(text, { save: (orders) => store.replaceAll('orders', orders) });
    if (!res.ok) return say(res.error, true);
    const used = await panel.useOrders('imported');
    await setOrders(res.orders);
    const skipped = res.skipped.length ? ` ${res.skipped.length} row${res.skipped.length > 1 ? 's' : ''} could not be read and were left out.` : '';
    say(`Done. ${res.orders.length.toLocaleString('en-US')} orders read in ${when(res.ms)} and kept on this computer.${skipped}${used ? '' : ' (The assistant could not switch to them; reopen the panel.)'}`);
  }

  $('chooseFile').addEventListener('click', () => $('orderFile').click());
  $('orderFile').addEventListener('change', (e) => { handleFile(e.target.files[0]); e.target.value = ''; });
  const drop = $('drop');
  drop.addEventListener('click', () => $('orderFile').click());
  drop.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('orderFile').click(); } });
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); handleFile(e.dataTransfer?.files?.[0]); });
  $('removeOrders').addEventListener('click', async () => {
    await store.clear('orders');
    await panel.useOrders('practice');
    await setOrders([]);
    say('Your orders were removed from this computer. The assistant is back on the practice shop.');
  });
}

// "Your stock": read on this device, saved all-or-nothing (cards and stock together), then the Agent switches to it.
export function wireStock({ $, store, panel }) {
  const status = $('stockStatus');
  const say = (text, bad = false) => { status.textContent = text; status.className = bad ? 'err' : ''; };
  async function handleFile(file) {
    if (!file) return;
    if (!/\.csv$/i.test(file.name) && file.type !== 'text/csv') return say('Please choose the CSV file you export from TCGplayer.', true);
    say('Reading the file on this computer…');
    let text;
    try { text = await file.text(); } catch { return say('I could not open that file. Try choosing it again.', true); }
    const t0 = Date.now();
    const res = parseStockExport(text);
    if (!res.ok) return say(res.error, true);
    try { await store.replaceCollections({ printings: res.printings, inventory: res.items }); } catch { return say('I could not save the stock, so nothing was changed. Try again.', true); }
    const used = await panel.useStock('imported');
    const skipped = res.skipped.length ? ` ${res.skipped.length} row${res.skipped.length > 1 ? 's' : ''} could not be read and were left out.` : '';
    const note = used ? '' : ' The assistant could not switch to it yet: answer or decline any waiting approval cards, then choose the file again.';
    say(`Done. ${res.items.length.toLocaleString('en-US')} stock rows for ${res.printings.length.toLocaleString('en-US')} cards read in ${((Date.now() - t0) / 1000).toFixed(1)} s and kept on this computer.${skipped}${note}`, !used);
  }
  $('chooseStock').addEventListener('click', () => $('stockFile').click());
  $('stockFile').addEventListener('change', (e) => { handleFile(e.target.files[0]); e.target.value = ''; });
  $('removeStock').addEventListener('click', async () => {
    if (!(await panel.useStock('practice'))) return say('Answer or decline the waiting approval cards first, then try again.', true);
    await store.replaceCollections({ printings: [], inventory: [] });
    say('Your stock was removed from this computer. The assistant is back on the practice stock.');
  });
}
