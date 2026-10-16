import { applyPriceRule, DEFAULT_CONDITION_MULTIPLIERS } from '../core/pricing.js';
import { PRESETS, presetToFields } from '../core/presets.js';
import { buildCsv, checkHeader } from '../core/csv.js';
import { openSession, createIndexedDbStore } from '../core/session.js';
import { openLists } from '../core/lists.js';
import { emptyStats, recordScan, summarize } from '../core/stats.js';
import { addEntry, buildResultsText } from '../core/scanlog.js';
import { readOurCsv } from '../core/csv-import.js';
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
// Device-wide things (settings, counts, results log) live under one key; each list's rows under its own.
const deviceStore = createIndexedDbStore('tcg-speed-scan', 'device');
const device = (await deviceStore.load()) || {};
const legacy = await createIndexedDbStore().load(); // the single list from before lists existed
const lists = await openLists({ store: createIndexedDbStore('tcg-speed-scan', 'lists'), legacy });
let stats = { ...emptyStats(), ...(device.stats || {}) };
let scanLog = Array.isArray(device.scanLog) ? device.scanLog : [];
let savedDefaults = device.defaults || (legacy && legacy.defaults) || {};
const saveDevice = () => { deviceStore.save({ stats, scanLog, defaults: savedDefaults }).catch(() => {}); };
let session = await openSession({ store: lists.sessionStore(lists.activeId) });

// Restore saved defaults into the form.
const saved = savedDefaults;
for (const f of FIELDS) {
  if (saved[f] === undefined) continue;
  if ($(f).type === 'checkbox') $(f).checked = saved[f]; else $(f).value = saved[f];
}

function saveDefaults() { savedDefaults = readDefaults(); saveDevice(); }
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
function finishChoice(p, foil) {
  const FOILY = ['foil', 'holo', 'reverse-holo', 'etched'];
  if (!foil) return p.finishes.includes('nonfoil') ? 'nonfoil' : p.finishes.find((f) => !FOILY.includes(f)) || p.finishes[0];
  return p.finishes.includes(FOIL_FOR[p.game]) ? FOIL_FOR[p.game] : p.finishes.find((f) => FOILY.includes(f)) || p.finishes[0];
}
function finishFor(p) { return finishChoice(p, $('finish').value === 'foil'); }
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
const labelKey = (p) => p.name + '|' + p.setCode + '|' + p.number;
let unresolved = []; // scans that asked for a tap or found nothing and are still waiting for the seller
function finishScan(scan, how, chosen) { // how: auto | tap | fixed | none (counts and anonymous text only)
  unresolved = unresolved.filter((s) => s !== scan);
  scanLog = addEntry(scanLog, { g: scan.g, t: scan.t, n: scan.n, m: scan.m, c: chosen, h: how, s: scan.s });
  stats = recordScan(stats, how === 'none' ? 'notFound' : how);
  saveDevice(); renderStats();
}
const expireScans = () => { for (const s of unresolved.filter((x) => Date.now() - x.at > 300000)) finishScan(s, 'none', ''); };

async function addCard(p0, opts = {}) {
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
  row.how = opts.how || 'search';
  if (opts.scan) finishScan(opts.scan, opts.how, labelKey(p));
  else { // added by search: if a scan was waiting for help, the seller just fixed it
    expireScans();
    const waiting = unresolved[unresolved.length - 1];
    if (waiting) { row.how = 'fixed'; finishScan(waiting, 'fixed', labelKey(p)); }
  }
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
  { const sm = summarize(stats); t += '\n' + sm.text + '\ncounts: auto=' + sm.auto + ' tap=' + sm.tap + ' fixed=' + sm.fixed + ' autoUndone=' + sm.autoUndone + ' notFound=' + sm.notFound; }
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

const selected = new Set(); // rows ticked for a bulk change
function renderQueue() {
  for (const id of [...selected]) if (!session.items.some((i) => i.id === id)) selected.delete(id);
  const ul = $('queue');
  ul.replaceChildren();
  const items = session.items;
  $('empty').hidden = items.length > 0;
  for (const it of items) {
    const p = index.get(it.printingId);
    const name = p ? label(p) : it.printingId.startsWith('product:tcgplayer:') ? 'TCGplayer product ' + it.tcgplayerProductId : it.printingId;
    const priceInput = el('input', { type: 'number', inputmode: 'decimal', min: '0', step: '0.01', value: (it.priceCents / 100).toFixed(2), 'aria-label': 'Price in dollars for ' + name });
    priceInput.addEventListener('change', () => {
      const c = dollarsToCents(priceInput.value);
      if (Number.isFinite(c) && c >= 0) session.edit(it.id, { priceCents: c, priceAsOf: undefined });
    });
    const step = (d) => { if (it.quantity + d >= 1) session.setQuantity(it.id, it.quantity + d); };
    const pick = el('input', { type: 'checkbox', 'aria-label': 'Choose ' + name });
    pick.checked = selected.has(it.id);
    pick.addEventListener('change', () => { if (pick.checked) selected.add(it.id); else selected.delete(it.id); renderBulk(); });
    ul.append(el('li', { class: 'item' + (selected.has(it.id) ? ' chosen' : ''), 'data-id': it.id },
      el('label', { class: 'pick' }, pick, 'Choose'),
      el('div', { class: 'title' }, name),
      el('div', { class: 'meta' }, it.condition + ' · ' + it.finish + ' · ' + it.language),
      ...(it.priceAsOf ? [el('div', { class: 'meta danger' }, '⚠ price from ' + it.priceAsOf + ', older than a day. Check it.')] : []),
      el('div', { class: 'controls' },
        el('button', { type: 'button', 'aria-label': 'One fewer ' + name, onclick: () => step(-1) }, '−'),
        el('strong', { 'aria-label': 'Quantity' }, '× ' + it.quantity),
        el('button', { type: 'button', 'aria-label': 'One more ' + name, onclick: () => step(1) }, '+'),
        el('label', {}, '$', priceInput),
        el('button', { type: 'button', class: 'btn-ghost', 'aria-label': 'Remove ' + name, onclick: () => { if (it.how === 'auto') { stats = recordScan(stats, 'autoUndone'); saveDevice(); } session.remove(it.id); } }, 'Remove'))));
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
  renderStats(); renderLists(); renderBulk();
  $('fixedWrap').hidden = $('basis').value !== 'fixed';
}

for (const f of FIELDS) $(f).addEventListener('change', () => { saveDefaults(); render(); renderResults(); });
$('q').addEventListener('input', () => { renderResults(); scheduleLive(); });
$('q').addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  const first = index.search($('q').value, { game: $('game').value || undefined, limit: 1 })[0];
  if (first) { addCard(first); $('q').select(); }
});
$('undo').addEventListener('click', () => session.undo());
$('clear').addEventListener('click', () => { if (session.items.length && confirm('Remove every card from the list? You can still undo.')) session.clear(); });
$('merge').addEventListener('click', () => { const n = session.mergeDuplicates(); say(n ? 'Merged ' + n + ' duplicate row' + (n === 1 ? '' : 's') : 'No duplicates.'); });
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'list';
function downloadCsvFile(items, listName) {
  const r = buildCsv(items, (id) => index.get(id));
  const url = URL.createObjectURL(new Blob([r.csv], { type: 'text/csv' }));
  const a = el('a', { href: url, download: 'speed-scan-' + slug(listName) + '-' + new Date().toISOString().slice(0, 10) + '.csv' });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return r;
}
const activeName = () => (lists.meta().find((m) => m.active) || { name: 'list' }).name;
$('download').addEventListener('click', () => {
  const r = downloadCsvFile(session.items, activeName());
  say('Downloaded ' + r.listed + ' rows (format unverified).' + (r.missingId.length + r.missingPrice.length ? ' Some rows were left out.' : ''));
});
for (const p of PRESETS) $('preset').append(el('option', { value: p.key }, p.label));
$('preset').addEventListener('change', () => {
  const p = PRESETS.find((x) => x.key === $('preset').value);
  if (!p) return;
  for (const [k, v] of Object.entries(presetToFields(p))) $(k).value = v;
  saveDefaults(); render(); renderResults();
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
function showChoices(options, title = '', scan = null) {
  const ul = $('choices');
  const group = el('li', { class: 'item' });
  if (title) group.append(el('div', { class: 'meta' }, title));
  for (const o of options) {
    group.append(el('div', { class: 'controls' },
      el('span', { class: 'title' }, label(o.printing)),
      el('button', { type: 'button', class: 'btn-dl', 'aria-label': 'Add ' + label(o.printing), onclick: () => { addCard(o.printing, scan ? { how: o.printing.id === scan.topId ? 'tap' : 'fixed', scan } : {}); group.remove(); } }, 'This one')));
  }
  group.append(el('div', { class: 'controls' }, el('button', { type: 'button', class: 'btn-ghost', onclick: () => { if (scan) finishScan(scan, 'none', ''); group.remove(); } }, 'Skip')));
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
  expireScans();
  let scan = null;
  if (r.ok) {
    const top = r.candidates && r.candidates[0];
    scan = { g: (r.clues && r.clues.game) || $('game').value || '', t: (r.parts && r.parts.title) || '', n: (r.parts && r.parts.bottom) || '', m: top ? labelKey(top.printing) : '', topId: top ? top.printing.id : '', s: top ? top.score : 0, at: Date.now() };
  }
  let msg;
  if (!r.ok) { feedback.miss(); msg = 'no card found.'; }
  else if (r.decision.action === 'accept') { feedback.accepted(); addCard(r.decision.pick, { how: 'auto', scan }); msg = 'added ' + label(r.decision.pick) + ' (' + Math.round(r.ms) + ' ms)'; }
  else if (r.decision.action === 'choose') { feedback.needsTap(); showChoices(r.decision.options, name, scan); unresolved.push(scan); msg = 'tap the right one.'; }
  else { feedback.miss(); unresolved.push(scan); msg = 'could not tell which card. Add it by search.'; }
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

let unbind = session.onChange(render);
async function useList(id) { // switch to another saved list
  lists.switchTo(id);
  await session.flush();
  session = await openSession({ store: lists.sessionStore(id) });
  unbind(); unbind = session.onChange(render);
  selected.clear(); $('choices').replaceChildren();
  render();
}

// ---- stats and sharing
function renderStats() { $('rightFirst').textContent = summarize(stats).text; }
async function copyText(text, box, okMessage, setMsg) {
  try { await navigator.clipboard.writeText(text); box.hidden = true; box.value = ''; setMsg(okMessage); }
  catch { box.hidden = false; box.value = text; box.focus(); box.select(); setMsg('Could not copy by itself. Select the text below, copy it, and paste it into the board inbox.'); }
}
$('shareResults').addEventListener('click', () => {
  const t = buildResultsText(scanLog, { version: APP_VERSION });
  copyText(t, $('shareOut'), 'Copied ' + Math.min(scanLog.length, 60) + ' rows. No photos, names or prices are in it. Paste it into the board inbox.', (m) => { $('rightFirst').textContent = summarize(stats).text + ' ' + m; });
});

// ---- lists
function renderLists() {
  const ul = $('listsOut'); ul.replaceChildren();
  const metas = lists.meta();
  $('activeListName').textContent = 'Now working on: ' + (metas.find((m) => m.active) || {}).name + '. Your newest ' + 20 + ' lists are kept on this device.';
  for (const m of metas) {
    ul.append(el('li', { class: 'item' + (m.active ? ' chosen' : '') },
      el('div', { class: 'title' }, m.name + (m.active ? ' (open)' : '')),
      el('div', { class: 'meta' }, m.cards + ' cards · ' + m.rows + ' rows · changed ' + m.updatedAt.slice(0, 16).replace('T', ' ')),
      el('div', { class: 'controls' },
        ...(m.active ? [] : [el('button', { type: 'button', class: 'btn-dl', 'aria-label': 'Open ' + m.name, onclick: () => useList(m.id) }, 'Open')]),
        el('button', { type: 'button', class: 'btn-ghost', 'aria-label': 'Make a copy of ' + m.name, onclick: async () => { await session.flush(); await useList(lists.duplicate(m.id)); } }, 'Copy'),
        el('button', { type: 'button', class: 'btn-ghost', 'aria-label': 'Download CSV for ' + m.name, onclick: async () => { await session.flush(); const r = downloadCsvFile(lists.items(m.id), m.name); $('listMsg').textContent = 'Downloaded ' + r.listed + ' rows from "' + m.name + '".'; } }, 'CSV'),
        el('button', { type: 'button', class: 'btn-ghost danger', 'aria-label': 'Delete ' + m.name, onclick: async () => {
          if (!confirm('Delete the list "' + m.name + '" with its ' + m.cards + ' cards? This cannot be undone.')) return;
          const wasOpen = m.active; const next = lists.remove(m.id);
          if (wasOpen) await useList(next); else renderLists();
        } }, 'Delete'))));
  }
}
$('listNew').addEventListener('click', async () => { const n = prompt('Name for the new list (you can leave it blank):', ''); if (n === null) return; await session.flush(); await useList(lists.create(n)); });
$('listRename').addEventListener('click', () => { const n = prompt('New name for this list:', activeName()); if (n && n.trim()) { lists.rename(lists.activeId, n); renderLists(); } });
$('listImport').addEventListener('click', () => $('importFile').click());
$('importFile').addEventListener('change', async (e) => {
  const f = e.target.files[0]; e.target.value = '';
  if (!f) return;
  const r = readOurCsv(await f.text());
  if (!r.rows.length) { $('listMsg').textContent = r.problems[0] || 'No rows to open.'; return; }
  const byProduct = new Map(); for (const p of index.all()) if (p.tcgplayerProductId) byProduct.set(p.tcgplayerProductId, p);
  const typed = new Map(); for (const m of lists.meta()) for (const it of lists.items(m.id)) if (it.tcgplayerProductId) typed.set(it.tcgplayerProductId, it.printingId);
  await session.flush();
  await useList(lists.create('Opened ' + f.name.replace(/\.csv$/i, '')));
  let unknown = 0;
  for (const row of r.rows) {
    const printingId = (byProduct.get(row.productId) || {}).id || typed.get(row.productId) || 'product:tcgplayer:' + row.productId;
    const p = index.get(printingId); if (!p) unknown += 1;
    session.add({ printingId, condition: row.condition, finish: p ? finishChoice(p, row.foil) : row.foil ? 'foil' : 'nonfoil', language: 'en', quantity: row.quantity, priceCents: row.priceCents, tcgplayerProductId: row.productId, source: 'import', how: 'search' });
  }
  $('listMsg').textContent = 'Opened ' + r.rows.length + ' rows' + (unknown ? ' (' + unknown + ' show as "TCGplayer product" because this device does not know the card name)' : '') + (r.problems.length ? '. Skipped ' + r.problems.length + ': ' + r.problems[0] : '') + '.';
});

// ---- bulk edit
function renderBulk() {
  const n = session.items.length;
  $('bulk').hidden = n === 0;
  $('selCount').textContent = String(selected.size);
  $('selAll').checked = n > 0 && selected.size === n;
  for (const li of $('queue').children) li.classList.toggle('chosen', selected.has(li.dataset.id));
}
const chosenIds = () => [...selected];
function bulkSay(m) { $('bulkMsg').textContent = m; }
$('selAll').addEventListener('change', () => {
  selected.clear(); if ($('selAll').checked) for (const i of session.items) selected.add(i.id);
  for (const box of $('queue').querySelectorAll('.pick input')) box.checked = $('selAll').checked;
  renderBulk();
});
$('bulkCondGo').addEventListener('click', () => {
  if (!selected.size) return bulkSay('Choose some rows first.');
  const n = session.editMany(chosenIds(), () => ({ condition: $('bulkCond').value }));
  bulkSay('Condition set on ' + n + ' row' + (n === 1 ? '' : 's') + '. Tap "Apply my price rule" to update prices. Undo reverses this.');
});
$('bulkFinGo').addEventListener('click', () => {
  if (!selected.size) return bulkSay('Choose some rows first.');
  let skipped = 0;
  const n = session.editMany(chosenIds(), (row) => { const p = index.get(row.printingId); if (!p) { skipped += 1; return undefined; } return { finish: finishChoice(p, $('bulkFin').value === 'foil') }; });
  bulkSay('Finish set on ' + n + ' row' + (n === 1 ? '' : 's') + (skipped ? ' (' + skipped + ' left alone: card not known on this device)' : '') + '. Tap "Apply my price rule" to update prices. Undo reverses this.');
});
$('bulkPrice').addEventListener('click', () => {
  if (!selected.size) return bulkSay('Choose some rows first.');
  let left = 0;
  const n = session.editMany(chosenIds(), (row) => {
    const p = index.get(row.printingId);
    const out = p ? applyPriceRule(currentRule(), p, { condition: row.condition, finish: row.finish }) : { status: 'missing' };
    if (out.status !== 'priced') { left += 1; return undefined; }
    return { priceCents: out.priceCents, priceAsOf: undefined };
  });
  bulkSay('Price rule applied to ' + n + ' row' + (n === 1 ? '' : 's') + (left ? '; ' + left + ' left as they were (no price known, or under your minimum)' : '') + '. Undo reverses this.');
});
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
