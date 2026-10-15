import { applyPriceRule, DEFAULT_CONDITION_MULTIPLIERS } from '../core/pricing.js';
import { PRESETS, presetToFields } from '../core/presets.js';
import { buildCsv } from '../core/csv.js';
import { openSession, createIndexedDbStore } from '../core/session.js';
import { createIndex } from '../data/index.js';
import { formatUsd, dollarsToCents } from '../../shared/models.js';
import { startCamera, grabFrame } from './camera.js';
import { identifyFrame } from '../ocr/pipeline.js';
import { browserFeedback } from '../core/rapid.js';

const $ = (id) => document.getElementById(id);
const FOIL_FOR = { mtg: 'foil', pokemon: 'holo', yugioh: 'first-edition', onepiece: 'foil' };
const FIELDS = ['game', 'condition', 'finish', 'language', 'quantity', 'basis', 'percent', 'fixed', 'rounding', 'floor', 'ceiling', 'minList', 'byCondition'];

const index = createIndex(await (await fetch('../data/sample/printings.json')).json());
const session = await openSession({ store: createIndexedDbStore() });

// Restore saved defaults into the form.
const saved = session.defaults;
for (const f of FIELDS) {
  if (saved[f] === undefined) continue;
  if ($(f).type === 'checkbox') $(f).checked = saved[f]; else $(f).value = saved[f];
}

function readDefaults() {
  const d = {};
  for (const f of FIELDS) d[f] = $(f).type === 'checkbox' ? $(f).checked : $(f).value;
  return d;
}
function cents(id) {
  const v = $(id).value.trim();
  if (v === '') return undefined;
  const c = dollarsToCents(v);
  return Number.isFinite(c) && c >= 0 ? c : undefined;
}
function currentRule() {
  const rule = {
    id: 'rule-1', name: 'My rule', basis: $('basis').value, percent: Number($('percent').value) || 0,
    rounding: $('rounding').value,
    conditionMultipliers: $('byCondition').checked ? DEFAULT_CONDITION_MULTIPLIERS : undefined,
  };
  if (rule.basis === 'fixed') rule.fixedCents = cents('fixed') ?? 0;
  const floorCents = cents('floor'), ceilingCents = cents('ceiling'), minListCents = cents('minList');
  if (floorCents !== undefined) rule.floorCents = floorCents;
  if (ceilingCents !== undefined) rule.ceilingCents = ceilingCents;
  if (minListCents !== undefined) rule.minListCents = minListCents;
  return rule;
}
// "Foil / holo" picks the foil-like finish this printing really has; if it has none, the card is added regular.
function finishFor(p) {
  if ($('finish').value !== 'foil') return p.finishes.includes('nonfoil') ? 'nonfoil' : p.finishes.find((f) => !['foil', 'holo', 'reverse-holo'].includes(f)) || p.finishes[0];
  return p.finishes.includes(FOIL_FOR[p.game]) ? FOIL_FOR[p.game] : p.finishes.find((f) => ['foil', 'holo', 'reverse-holo', 'etched'].includes(f)) || p.finishes[0];
}
const say = (msg) => { $('status').textContent = msg; };
const el = (tag, attrs = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') n.className = v; else if (k.startsWith('on')) n.addEventListener(k.slice(2), v); else n.setAttribute(k, v);
  }
  n.append(...kids);
  return n;
};
const label = (p) => p.name + ' (' + p.setCode + ' ' + p.number + ')';

function addCard(p) {
  const condition = $('condition').value;
  const finish = finishFor(p);
  const out = applyPriceRule(currentRule(), p, { condition, finish });
  const qty = Math.max(1, parseInt($('quantity').value, 10) || 1);
  if (out.status === 'skip') { say('Skipped ' + p.name + ': ' + out.reason); return; }
  session.add({
    printingId: p.id, condition, finish, language: $('language').value, quantity: qty,
    priceCents: out.status === 'priced' ? out.priceCents : 0, priceRuleId: 'rule-1', source: 'manual',
  });
  say(out.status === 'priced' ? 'Added ' + label(p) + ' at ' + formatUsd(out.priceCents) : 'Added ' + label(p) + ' with no price. Type one in your list.');
}

function renderResults() {
  const q = $('q').value.trim();
  const ul = $('results');
  ul.replaceChildren();
  if (!q) return;
  const hits = index.search(q, { game: $('game').value || undefined, limit: 8 });
  if (!hits.length) { say('No match. Try fewer words.'); return; }
  say(hits.length + ' found');
  for (const p of hits) {
    const finish = finishFor(p);
    const out = applyPriceRule(currentRule(), p, { condition: $('condition').value, finish });
    const priceText = out.status === 'priced' ? formatUsd(out.priceCents) : out.status === 'skip' ? 'skip' : 'no price';
    ul.append(el('li', { class: 'item' },
      el('div', { class: 'title' }, p.name),
      el('div', { class: 'meta' }, (p.setName || p.setCode) + ' · ' + p.setCode + ' ' + p.number + ' · ' + finish),
      el('div', { class: 'controls' },
        el('span', { class: 'price' }, priceText),
        el('button', { type: 'button', class: 'primary', 'aria-label': 'Add ' + label(p), onclick: () => { addCard(p); $('q').focus(); $('q').select(); } }, 'Add'))));
  }
}

function renderQueue() {
  const ul = $('queue');
  ul.replaceChildren();
  const items = session.items;
  $('empty').hidden = items.length > 0;
  for (const it of items) {
    const p = index.get(it.printingId);
    const name = p ? label(p) : it.printingId;
    const priceInput = el('input', { type: 'number', inputmode: 'decimal', min: '0', step: '0.01', value: (it.priceCents / 100).toFixed(2), 'aria-label': 'Price in dollars for ' + name });
    priceInput.addEventListener('change', () => {
      const c = dollarsToCents(priceInput.value);
      if (Number.isFinite(c) && c >= 0) session.edit(it.id, { priceCents: c });
    });
    const step = (d) => { if (it.quantity + d >= 1) session.setQuantity(it.id, it.quantity + d); };
    ul.append(el('li', { class: 'item' },
      el('div', { class: 'title' }, name),
      el('div', { class: 'meta' }, it.condition + ' · ' + it.finish + ' · ' + it.language),
      el('div', { class: 'controls' },
        el('button', { type: 'button', 'aria-label': 'One fewer ' + name, onclick: () => step(-1) }, '−'),
        el('strong', { 'aria-label': 'Quantity' }, '× ' + it.quantity),
        el('button', { type: 'button', 'aria-label': 'One more ' + name, onclick: () => step(1) }, '+'),
        el('label', {}, '$', priceInput),
        el('button', { type: 'button', class: 'ghost', 'aria-label': 'Remove ' + name, onclick: () => session.remove(it.id) }, 'Remove'))));
  }
}

function currentCsv() {
  return buildCsv(session.items, (id) => index.get(id));
}

function renderProblems(result) {
  const rows = [
    ...result.missingId.map((m) => ({ ...m, kind: 'id' })),
    ...result.missingPrice.map((m) => ({ ...m, kind: 'price' })),
  ];
  $('problems').hidden = rows.length === 0;
  const ul = $('problemList');
  ul.replaceChildren();
  const seen = new Set();
  for (const r of rows) {
    if (r.kind === 'id') {
      if (seen.has(r.printingId)) continue;
      seen.add(r.printingId);
      const input = el('input', { type: 'number', inputmode: 'numeric', min: '1', step: '1', placeholder: 'TCGplayer product ID', 'aria-label': 'TCGplayer product ID for ' + r.label });
      input.addEventListener('change', () => { const n = parseInt(input.value, 10); if (n > 0) session.setProductId(r.printingId, n); });
      ul.append(el('li', { class: 'item' }, el('div', { class: 'title' }, r.label),
        el('div', { class: 'meta' }, 'We do not know this card’s TCGplayer product ID. Paste it from the product page on TCGplayer.'), input));
    } else {
      ul.append(el('li', { class: 'item' }, el('div', { class: 'title' }, r.label), el('div', { class: 'meta danger' }, 'No price yet. Type one in your list above.')));
    }
  }
}

let rendering = false;
function render() {
  // Replacing a focused input fires blur -> change -> render again; ignore the nested call.
  if (rendering) return;
  rendering = true;
  try { renderAll(); } finally { rendering = false; }
}
function renderAll() {
  renderQueue();
  const t = session.totals();
  const result = currentCsv();
  renderProblems(result);
  $('totals').textContent = t.cards + ' card' + (t.cards === 1 ? '' : 's') + ' · ' + formatUsd(t.valueCents) + (result.listed < t.rows ? ' · ' + (t.rows - result.listed) + ' to fix' : '');
  $('download').disabled = result.listed === 0;
  $('undo').disabled = !session.canUndo();
  $('fixedWrap').hidden = $('basis').value !== 'fixed';
}

for (const f of FIELDS) $(f).addEventListener('change', () => { session.setDefaults(readDefaults()); render(); renderResults(); });
$('q').addEventListener('input', renderResults);
$('q').addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  const first = index.search($('q').value, { game: $('game').value || undefined, limit: 1 })[0];
  if (first) { addCard(first); $('q').select(); }
});
$('undo').addEventListener('click', () => session.undo());
$('clear').addEventListener('click', () => { if (session.items.length && confirm('Remove every card from the list? You can still undo.')) session.clear(); });
$('merge').addEventListener('click', () => { const n = session.mergeDuplicates(); say(n ? 'Merged ' + n + ' duplicate row' + (n === 1 ? '' : 's') : 'No duplicates.'); });
$('download').addEventListener('click', () => {
  const r = currentCsv();
  const url = URL.createObjectURL(new Blob([r.csv], { type: 'text/csv' }));
  const a = el('a', { href: url, download: 'speed-scan-' + new Date().toISOString().slice(0, 10) + '.csv' });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  say('Downloaded ' + r.listed + ' rows (format unverified).' + (r.missingId.length + r.missingPrice.length ? ' Some rows were left out.' : ''));
});
for (const p of PRESETS) $('preset').append(el('option', { value: p.key }, p.label));
$('preset').addEventListener('change', () => {
  const p = PRESETS.find((x) => x.key === $('preset').value);
  if (!p) return;
  for (const [k, v] of Object.entries(presetToFields(p))) $(k).value = v;
  session.setDefaults(readDefaults()); render(); renderResults();
  say('Rule set: ' + p.label);
});

// Camera. An OCR engine can be plugged in as window.SpeedScanOcr = { recognize(grayImage, { region }) -> Promise<string> }.
const feedback = browserFeedback();
let stopCamera = null;
const scanSay = (m) => { $('scanStatus').textContent = m; };
function showChoices(options) {
  const ul = $('choices');
  ul.replaceChildren();
  for (const o of options) {
    ul.append(el('li', { class: 'item' }, el('div', { class: 'title' }, label(o.printing)),
      el('div', { class: 'controls' }, el('button', { type: 'button', class: 'primary', 'aria-label': 'Add ' + label(o.printing), onclick: () => { addCard(o.printing); ul.replaceChildren(); } }, 'This one'))));
  }
}
$('camStart').addEventListener('click', async () => {
  try {
    stopCamera = await startCamera($('video'));
    $('video').hidden = false; $('camShot').disabled = false; $('camStop').disabled = false; $('camStart').disabled = true;
    scanSay('Camera on. Hold one card flat, fill most of the picture.');
  } catch (e) { scanSay('Could not start the camera: ' + e.message); }
});
$('camStop').addEventListener('click', () => {
  stopCamera?.(); stopCamera = null;
  $('video').hidden = true; $('camShot').disabled = true; $('camStop').disabled = true; $('camStart').disabled = false;
});
$('camShot').addEventListener('click', async () => {
  const frame = grabFrame($('video'), $('canvas'));
  const engine = window.SpeedScanOcr;
  if (!engine) {
    const { detectCard } = await import('../vision/detect.js');
    const box = detectCard(frame);
    feedback[box ? 'needsTap' : 'miss']();
    scanSay(box ? 'Found a card (' + box.w + '×' + box.h + '). No text reader installed yet: add it by search.' : 'No card found. Try a plain background and more light.');
    return;
  }
  const r = await identifyFrame(frame, { engine, index, game: $('game').value || undefined });
  if (!r.ok) { feedback.miss(); scanSay('No card found. Try again.'); return; }
  if (r.decision.action === 'accept') { feedback.accepted(); addCard(r.decision.pick); scanSay('Added ' + label(r.decision.pick) + ' (' + Math.round(r.ms) + ' ms)'); }
  else if (r.decision.action === 'choose') { feedback.needsTap(); scanSay('Tap the right one.'); showChoices(r.decision.options); }
  else { feedback.miss(); scanSay('Could not tell which card. Add it by search.'); }
});

session.onChange(render);
render();

if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
