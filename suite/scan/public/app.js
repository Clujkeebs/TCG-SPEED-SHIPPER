import { applyPriceRule, DEFAULT_CONDITION_MULTIPLIERS } from '../core/pricing.js';
import { PRESETS, presetToFields } from '../core/presets.js';
import { buildCsv } from '../core/csv.js';
import { openSession, createIndexedDbStore } from '../core/session.js';
import { createIndex } from '../data/index.js';
import { formatUsd, dollarsToCents } from '../../shared/models.js';
import { startCamera, grabFrame, frameFromFile } from './camera.js';
import { detectCard } from '../vision/detect.js';
import { createLiveScanner } from '../core/live.js';
import { identifyFrame } from '../ocr/pipeline.js';
import { browserFeedback } from '../core/rapid.js';
import { createBrowserEngine } from '../ocr/engine-browser.js';

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
        el('button', { type: 'button', class: 'btn-dl', 'aria-label': 'Add ' + label(p), onclick: () => { addCard(p); $('q').focus(); $('q').select(); } }, 'Add'))));
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
        el('button', { type: 'button', class: 'btn-ghost', 'aria-label': 'Remove ' + name, onclick: () => session.remove(it.id) }, 'Remove'))));
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
  $('navCount').textContent = String(t.cards);
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

// Camera and photos. An OCR engine can be plugged in as window.SpeedScanOcr = { recognize(grayImage, { region }) -> Promise<string> }.
const feedback = browserFeedback();
const scanSay = (m) => { $('scanStatus').textContent = m; };
let stopCamera = null;
let liveTimer = null;
let scanner = null;

function showChoices(options) {
  const ul = $('choices');
  ul.replaceChildren();
  for (const o of options) {
    ul.append(el('li', { class: 'item' }, el('div', { class: 'title' }, label(o.printing)),
      el('div', { class: 'meta' }, (o.printing.setName || o.printing.setCode) + ' · ' + o.printing.finishes.join(', ')),
      el('div', { class: 'controls' }, el('button', { type: 'button', class: 'btn-dl', 'aria-label': 'Add ' + label(o.printing), onclick: () => { addCard(o.printing); ul.replaceChildren(); } }, 'This one'))));
  }
}

// One frame (live, captured or from a photo) -> add, ask, or explain. Returns a short text for photo lists.
let builtIn = null;
async function getEngine() {
  if (window.SpeedScanOcr) return window.SpeedScanOcr; // a test or a different reader can be plugged in
  builtIn ||= createBrowserEngine();
  try { await builtIn.ready(); return builtIn; } catch { builtIn = null; return null; }
}
async function handleFrame(frame, name = '') {
  const prefix = name ? name + ': ' : '';
  scanSay(prefix + 'reading…');
  const engine = await getEngine();
  if (!engine) {
    const box = detectCard(frame);
    feedback[box ? 'needsTap' : 'miss']();
    const msg = box ? 'card found, but the text reader could not load, so add it by search.' : 'no card found. Try a plain background and more light.';
    scanSay(prefix + msg);
    return msg;
  }
  const r = await identifyFrame(frame, { engine, index, game: $('game').value || undefined });
  let msg;
  if (!r.ok) { feedback.miss(); msg = 'no card found.'; }
  else if (r.decision.action === 'accept') { feedback.accepted(); addCard(r.decision.pick); msg = 'added ' + label(r.decision.pick) + ' (' + Math.round(r.ms) + ' ms)'; }
  else if (r.decision.action === 'choose') { feedback.needsTap(); showChoices(r.decision.options); msg = 'tap the right one.'; }
  else { feedback.miss(); msg = 'could not tell which card. Add it by search.'; }
  scanSay(prefix + msg);
  return msg;
}

function drawOverlay(box, frame) {
  const c = $('overlay');
  c.width = frame.width; c.height = frame.height;
  const g = c.getContext('2d');
  g.clearRect(0, 0, c.width, c.height);
  if (!box) return;
  g.lineWidth = Math.max(3, frame.width / 200);
  g.strokeStyle = box.confidence >= 0.3 ? '#40916c' : '#e2c46b';
  g.strokeRect(box.x, box.y, box.w, box.h);
}

function setCameraUi(on) {
  $('video').hidden = !on; $('overlay').hidden = !on;
  $('camShot').disabled = !on; $('camStop').disabled = !on; $('camStart').disabled = on;
}
function stopLive() {
  clearInterval(liveTimer); liveTimer = null;
  stopCamera?.(); stopCamera = null; scanner = null;
  setCameraUi(false);
}

$('camStart').addEventListener('click', async () => {
  try {
    $('preview').hidden = true;
    stopCamera = await startCamera($('video'));
    setCameraUi(true);
    scanner = createLiveScanner({
      detect: (f) => detectCard(f),
      identify: (f) => handleFrame(f),
    });
    scanSay('Live camera on. Hold one card steady in the frame; it is read when it stops moving. Swap cards to keep going.');
    liveTimer = setInterval(async () => {
      if (!stopCamera || $('video').readyState < 2) return;
      const frame = grabFrame($('video'), $('canvas'));
      const ev = await scanner.step(frame);
      drawOverlay(ev.box, frame);
    }, 400);
  } catch (e) { scanSay('Could not start the camera: ' + e.message + ' You can still upload photos.'); }
});
$('camStop').addEventListener('click', stopLive);
$('camShot').addEventListener('click', () => handleFrame(grabFrame($('video'), $('canvas'))));

// Photos: pick or drop one or many; each is checked in turn.
async function handleFiles(files) {
  const list = [...files].filter((f) => f.type.startsWith('image/'));
  if (!list.length) { scanSay('That is not a photo. Use JPG, PNG or HEIC from your camera roll.'); return; }
  let n = 0;
  for (const f of list) {
    n += 1;
    try {
      const frame = await frameFromFile(f, $('canvas'));
      const url = URL.createObjectURL(f);
      $('preview').src = url; $('preview').hidden = false; $('video').hidden = true;
      await handleFrame(frame, list.length > 1 ? n + '/' + list.length + ' ' + f.name : f.name);
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch { scanSay(f.name + ': could not open this photo.'); }
  }
}
$('file').addEventListener('change', (e) => { handleFiles(e.target.files); e.target.value = ''; });
const drop = $('drop');
for (const ev of ['dragenter', 'dragover']) drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('dragover'); });
for (const ev of ['dragleave', 'drop']) drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('dragover'); });
drop.addEventListener('drop', (e) => handleFiles(e.dataTransfer.files));

// Tabs.
for (const t of document.querySelectorAll('.nav-tab')) {
  t.addEventListener('click', () => {
    for (const o of document.querySelectorAll('.nav-tab')) { o.classList.toggle('active', o === t); o.setAttribute('aria-selected', String(o === t)); }
    for (const s of document.querySelectorAll('.tab')) s.hidden = s.id !== 'tab-' + t.dataset.tab;
    if (t.dataset.tab !== 'add' && stopCamera) stopLive();
    window.scrollTo(0, 0);
  });
}

session.onChange(render);
render();

if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
