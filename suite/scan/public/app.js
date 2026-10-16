import { applyPriceRule, DEFAULT_CONDITION_MULTIPLIERS } from '../core/pricing.js';
import { PRESETS, presetToFields } from '../core/presets.js';
import { buildCsv, checkHeader } from '../core/csv.js';
import { openSession, createIndexedDbStore } from '../core/session.js';
import { resolveClues } from '../ocr/resolve.js';
import { decide } from '../core/rapid.js';
import { loadIndex } from '../data/load.js';
import { createLiveLookup } from '../data/live.js';
import { priceFreshness, formatAsOf } from '../core/freshness.js';
import { productIdFromLink } from '../core/tcgurl.js';
import { buildReport, describeLast } from '../core/report.js';
import { APP_VERSION } from '../core/version.js';
import { formatUsd, dollarsToCents } from '../../shared/models.js';
import { startCamera, grabFrame, frameFromFile, CameraError } from './camera.js';
import { checkDevice, checksToText, browserEnv } from '../core/device.js';
import { createWakeLock } from '../core/wakelock.js';
import { describeCameraError } from '../core/camera-errors.js';
import { detectCard } from '../vision/detect.js';
import { createLiveScanner } from '../core/live.js';
import { identifyFrame } from '../ocr/pipeline.js';
import { browserFeedback } from '../core/rapid.js';
import { createBrowserEngine } from '../ocr/engine-browser.js';

const $ = (id) => document.getElementById(id);
const FOIL_FOR = { mtg: 'foil', pokemon: 'holo', yugioh: 'first-edition', onepiece: 'foil' };
const FIELDS = ['game', 'condition', 'finish', 'language', 'quantity', 'onlineLookup', 'basis', 'percent', 'fixed', 'rounding', 'floor', 'ceiling', 'minList', 'byCondition'];

const { index } = await loadIndex(async (u) => { const r = await fetch(u); if (!r.ok) throw new Error(String(r.status)); return r.json(); }, { base: '../data/' });
const live = createLiveLookup({
  fetchJson: async (url) => { const r = await fetch(url, { headers: { Accept: 'application/json' } }); if (!r.ok) throw new Error(String(r.status)); return r.json(); },
  index, store: createIndexedDbStore('tcg-speed-scan-cache', 'cards'),
});
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

// Prices older than 24 hours are fetched again when we can; if not, the row says how old the price is.
async function addCard(p0) {
  let p = p0;
  const condition = $('condition').value;
  const finish = finishFor(p);
  let fresh = priceFreshness(p, finish);
  if (fresh.state === 'stale' && $('onlineLookup').checked && navigator.onLine !== false) {
    live.enabled = true;
    const again = await live.refresh(p);
    if (again) { p = again; fresh = priceFreshness(p, finish); }
    noteLast();
  }
  const out = applyPriceRule(currentRule(), p, { condition, finish });
  const qty = Math.max(1, parseInt($('quantity').value, 10) || 1);
  if (out.status === 'skip') { say('Skipped ' + p.name + ': ' + out.reason); return; }
  const row = {
    printingId: p.id, condition, finish, language: $('language').value, quantity: qty,
    priceCents: out.status === 'priced' ? out.priceCents : 0, priceRuleId: 'rule-1', source: 'manual',
  };
  if (fresh.state === 'stale') row.priceAsOf = formatAsOf(fresh.asOf);
  session.add(row);
  const old = fresh.state === 'stale' ? ' WARNING: price is from ' + formatAsOf(fresh.asOf) + ' (older than a day).' : '';
  say((out.status === 'priced' ? 'Added ' + label(p) + ' at ' + formatUsd(out.priceCents) : 'Added ' + label(p) + ' with no price. Type one in your list.') + old);
}

// "bolt m11 149" -> name + set code + number. The word next to the number, if it looks like a set code, is the set.
function clueFromQuery(q) {
  const toks = q.trim().split(/\s+/).filter(Boolean);
  const numIdx = toks.findIndex((t) => /^\d{1,4}[a-z★]?$/i.test(t));
  const clue = {};
  let setIdx = -1;
  if (numIdx >= 0) {
    clue.number = toks[numIdx];
    for (const k of [numIdx - 1, numIdx + 1]) if (k >= 0 && k < toks.length && /^[a-z0-9]{2,5}$/i.test(toks[k]) && toks.length > 1) { setIdx = k; break; }
    if (setIdx >= 0) clue.setCode = toks[setIdx];
  }
  clue.name = toks.filter((_, k) => k !== numIdx && k !== setIdx).join(' ');
  return clue;
}
let lastRead = '';
function noteLast(extra) {
  const l = extra || live.lastLookup;
  $('lastLookup').textContent = describeLast(l);
}
let deviceChecks = null;
async function runDeviceCheck() { deviceChecks = await checkDevice(browserEnv()); return deviceChecks; }
runDeviceCheck();
$('devCheck').addEventListener('click', async () => {
  const cs = await runDeviceCheck();
  const ul = $('devOut'); ul.replaceChildren();
  for (const c of cs) ul.append(el('li', { class: 'item' }, el('div', { class: c.ok ? 'title ok' : 'title danger' }, (c.ok ? '✓ ' : '✗ ') + c.label), el('div', { class: 'meta' }, c.text)));
});
function reportText() {
  const l = live.lastLookup;
  let t = buildReport({ last: l, version: APP_VERSION, userAgent: navigator.userAgent, online: navigator.onLine });
  t += '\ndevice check:\n' + (deviceChecks ? checksToText(deviceChecks) : 'not run yet');
  if (lastRead) t += '\nlast text read from a card: ' + lastRead.replace(/\s+/g, ' ').slice(0, 200);
  return t;
}
$('report').addEventListener('click', async () => {
  const t = reportText();
  try { await navigator.clipboard.writeText(t); $('reportOut').value = ''; $('reportOut').hidden = true; say('Copied. Paste it into the board inbox.'); }
  catch { $('reportOut').hidden = false; $('reportOut').value = t; $('reportOut').focus(); $('reportOut').select(); say('Could not copy by itself. Select the text below, copy it, and paste it into the board inbox.'); }
});
let lookupTimer = null; let lookupSeq = 0;
function scheduleLive() {
  clearTimeout(lookupTimer);
  const q = $('q').value.trim();
  live.enabled = $('onlineLookup').checked;
  if (!live.enabled || q.length < 3) return;
  const seq = (lookupSeq += 1);
  lookupTimer = setTimeout(async () => {
    say('Searching online…');
    const r = await live.findAny($('game').value || '', clueFromQuery(q));
    if (seq !== lookupSeq) return; // the seller kept typing
    renderResults();
    noteLast();
    if ($('game').value === 'onepiece' && !$('results').children.length) { say('One Piece cards outside the small sample list cannot be looked up online yet.'); return; }
    say(r.errors[0] || (r.printings.length ? r.printings.length + ' found online' : $('results').children.length ? '' : 'No match, even online. Check the spelling or try the set code and number.'));
  }, 450);
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
    const fr = priceFreshness(p, finish);
    const priceText = (out.status === 'priced' ? formatUsd(out.priceCents) : out.status === 'skip' ? 'skip' : 'no price') + (fr.state === 'stale' ? ' (old price)' : fr.state === 'demo' ? ' (demo)' : '');
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
      if (Number.isFinite(c) && c >= 0) session.edit(it.id, { priceCents: c, priceAsOf: undefined });
    });
    const step = (d) => { if (it.quantity + d >= 1) session.setQuantity(it.id, it.quantity + d); };
    ul.append(el('li', { class: 'item' },
      el('div', { class: 'title' }, name),
      el('div', { class: 'meta' }, it.condition + ' · ' + it.finish + ' · ' + it.language),
      ...(it.priceAsOf ? [el('div', { class: 'meta danger' }, '⚠ price from ' + it.priceAsOf + ', older than a day. Check it.')] : []),
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
      const input = el('input', { type: 'text', inputmode: 'url', autocomplete: 'off', autocapitalize: 'off', placeholder: 'Paste the TCGplayer page link or the number', 'aria-label': 'TCGplayer link or product ID for ' + r.label });
      const warn = el('div', { class: 'meta danger', role: 'alert' });
      input.addEventListener('change', () => {
        const n = productIdFromLink(input.value);
        if (n) session.setProductId(r.printingId, n);
        else if (input.value.trim()) warn.textContent = 'That is not a TCGplayer product link or number. It looks like https://www.tcgplayer.com/product/123456/…';
      });
      ul.append(el('li', { class: 'item' }, el('div', { class: 'title' }, r.label),
        el('div', { class: 'meta' }, 'We do not know this card’s TCGplayer product ID. Open the card on TCGplayer, copy the page address, and paste it here. We only read the number out of the text; the page is not opened by us.'), input, warn));
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
$('q').addEventListener('input', () => { renderResults(); scheduleLive(); });
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
const wake = createWakeLock({ nav: navigator, doc: document }); // keeps the screen on while scanning (quietly does nothing if unsupported)
let liveTimer = null;
let scanner = null;

// Cards that need a tap stay on screen, one group per card, until the seller picks or dismisses them.
function showChoices(options, title = '') {
  const ul = $('choices');
  const group = el('li', { class: 'item' });
  if (title) group.append(el('div', { class: 'meta' }, title));
  for (const o of options) {
    group.append(el('div', { class: 'controls' },
      el('span', { class: 'title' }, label(o.printing)),
      el('button', { type: 'button', class: 'btn-dl', 'aria-label': 'Add ' + label(o.printing), onclick: () => { addCard(o.printing); group.remove(); } }, 'This one')));
  }
  group.append(el('div', { class: 'controls' }, el('button', { type: 'button', class: 'btn-ghost', onclick: () => group.remove() }, 'Skip')));
  ul.append(group);
}

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
  if (r.text) lastRead = r.text;
  if (r.ok && r.decision.action !== 'accept' && $('onlineLookup').checked) {
    // Not sure from the saved list: ask the online sources for this exact card, then decide again.
    live.enabled = true;
    const got = await live.findAny($('game').value || r.clues.game || '', r.clues);
    noteLast();
    if (got.printings.length) { r.candidates = resolveClues(r.clues, index); r.decision = decide(r.candidates); }
  }
  let msg;
  if (!r.ok) { feedback.miss(); msg = 'no card found.'; }
  else if (r.decision.action === 'accept') { feedback.accepted(); addCard(r.decision.pick); msg = 'added ' + label(r.decision.pick) + ' (' + Math.round(r.ms) + ' ms)'; }
  else if (r.decision.action === 'choose') { feedback.needsTap(); showChoices(r.decision.options, name); msg = 'tap the right one.'; }
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
  wake.off();
  setCameraUi(false);
}

$('camStart').addEventListener('click', async () => {
  try {
    $('preview').hidden = true;
    stopCamera = await startCamera($('video'));
    wake.on();
    $('video').addEventListener('cameralost', () => { if (stopCamera) { stopLive(); scanSay('The camera stopped (another app took it, or the screen went to sleep). Tap Start camera again.'); } }, { once: true });
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
  } catch (e) { scanSay((e instanceof CameraError ? e.message : describeCameraError(e)) + ' You can also upload photos.'); }
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

$('hdrCheck').addEventListener('click', () => {
  const r = checkHeader($('hdr').value);
  const ul = $('hdrOut'); ul.replaceChildren();
  for (const n of r.notes) ul.append(el('li', { class: 'item' }, el('div', { class: r.ok ? 'title' : 'title danger' }, n)));
});

// Safari switches the camera off when the page is hidden; say so instead of showing a frozen picture.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden' && stopCamera) { stopLive(); scanSay('Camera paused because you left the page. Tap Start camera to continue.'); }
});

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

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  const hadController = Boolean(navigator.serviceWorker.controller);
  navigator.serviceWorker.register('sw.js').then((reg) => {
    // A new version waiting: say so, and switch only when the seller taps (never silently swap files under them).
    const offer = (w) => { $('updateBar').hidden = false; $('updateBtn').onclick = () => w.postMessage({ type: 'SKIP_WAITING' }); };
    if (reg.waiting && navigator.serviceWorker.controller) offer(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      if (w) w.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) offer(w); });
    });
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reg.update().catch(() => {}); });
  }).catch(() => {});
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (hadController && !reloading) { reloading = true; location.reload(); } });
}
