/* Site-wide SEO and link checks over every public page. New posts and guides
   are added often (by either agent); this catches the easy-to-miss mistakes
   before they ship: a missing canonical/description, a duplicate title,
   broken JSON-LD, a page left out of the sitemap, or a dead internal link. */
const fs = require('fs');
const path = require('path');

const PUB = path.join(__dirname, '..', 'public');
const SITE = 'https://tcgspeedshipper.com';
let passed = 0, failed = 0;
function check(name, cond, extra) {
  if (cond) { passed++; }
  else { failed++; console.log('  FAIL  ' + name + (extra ? '  — ' + extra : '')); }
}

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = path.join(dir, d.name);
    return d.isDirectory() ? walk(p) : d.name.endsWith('.html') ? [p] : [];
  });
}
// Pages that exist but are deliberately not for search engines.
const PRIVATE = /^\/(admin|affiliate)\/|^\/google[0-9a-f]+\.html$|^\/viewsitemapsxml\.html$/;
const pages = walk(PUB).map((f) => {
  const rel = '/' + path.relative(PUB, f).split(path.sep).join('/');
  return { file: f, url: rel.replace(/index\.html$/, ''), html: fs.readFileSync(f, 'utf8') };
});
const publicPages = pages.filter((p) => !PRIVATE.test(p.url));
const one = (html, re) => { const m = html.match(re); return m ? m[1].trim() : ''; };

console.log('\n-- Per-page SEO basics (' + publicPages.length + ' public pages) --');
const titles = {};
for (const p of publicPages) {
  const title = one(p.html, /<title>([\s\S]*?)<\/title>/i);
  const desc = one(p.html, /<meta\s+name="description"\s+content="([^"]*)"/i);
  const canon = one(p.html, /<link\s+rel="canonical"\s+href="([^"]*)"/i);
  check(p.url + ': has a <title>', !!title);
  check(p.url + ': title ≤ 70 chars', title.length <= 70, title.length + ' chars: ' + title);
  check(p.url + ': has a meta description (50–200 chars; aim for ≤160)', desc.length >= 50 && desc.length <= 200, desc.length + ' chars');
  check(p.url + ': canonical points at itself on the real domain', canon === SITE + p.url, canon);
  check(p.url + ': has og:title and og:image', /property="og:title"/.test(p.html) && /property="og:image"/.test(p.html));
  check(p.url + ': not accidentally noindexed', !/name="robots"\s+content="[^"]*noindex/i.test(p.html));
  check(p.url + ': one <h1>', (p.html.match(/<h1[\s>]/gi) || []).length === 1, (p.html.match(/<h1[\s>]/gi) || []).length + ' found');
  for (const m of p.html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    let ok = true; try { JSON.parse(m[1]); } catch (e) { ok = false; }
    check(p.url + ': JSON-LD parses', ok);
  }
  (titles[title] = titles[title] || []).push(p.url);
}
for (const t of Object.keys(titles)) check('title is unique: "' + t + '"', titles[t].length === 1, titles[t].join(', '));

console.log('\n-- Sitemap --');
const sm = fs.readFileSync(path.join(PUB, 'sitemap.xml'), 'utf8');
const inMap = new Set([...sm.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].replace(SITE, '')));
for (const p of publicPages) check('in sitemap: ' + p.url, inMap.has(p.url));
for (const u of inMap) check('sitemap entry exists as a page: ' + u, publicPages.some((p) => p.url === u));
check('robots.txt points at the sitemap', /Sitemap:\s*https:\/\/tcgspeedshipper\.com\/sitemap\.xml/.test(fs.readFileSync(path.join(PUB, 'robots.txt'), 'utf8')));

console.log('\n-- Internal links --');
function exists(href) {
  const clean = href.split('#')[0].split('?')[0];
  if (!clean) return true;
  const f = path.join(PUB, clean.endsWith('/') ? clean + 'index.html' : clean);
  return fs.existsSync(f);
}
let links = 0;
for (const p of pages) {
  for (const m of p.html.matchAll(/\s(?:href|src)="(\/[^"]*)"/g)) {
    const href = m[1];
    if (/^\/(api|\.netlify)\//.test(href) || href.startsWith('//')) continue;
    links++;
    check(p.url + ' → ' + href + ' exists', exists(href));
  }
}
console.log('  checked ' + links + ' internal links');

console.log('\n-- Scripts --');
// Libraries are self-hosted under /vendor/ with the version in the file name.
// A CDN <script> costs an extra connection before first paint, and a floating
// version (e.g. @2) lets the CDN change our code without a deploy.
for (const p of pages) {
  const ext = [...p.html.matchAll(/<script[^>]+src="(https?:\/\/[^"]+)"/g)].map((m) => m[1]);
  check(p.url + ': no third-party <script src>', ext.length === 0, ext.join(', '));
}
const vendored = fs.readdirSync(path.join(PUB, 'vendor')).filter((f) => f.endsWith('.js'));
for (const f of vendored) check('/vendor/' + f + ': version in the file name', /-\d+\.\d+\.\d+[.-]/.test(f));

console.log('\n-- Leftover merge-conflict markers --');
// Both agents append to the same log and edit the same blog index/sitemap, so
// conflicts get resolved by hand often. A leftover `<<<<<<<` / `|||||||` /
// `>>>>>>>` line has slipped through more than once.
const ROOT = path.join(__dirname, '..');
let tracked;
try {
  tracked = require('child_process').execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' }).split('\0').filter(Boolean);
} catch (e) {
  tracked = null; // not a git checkout: skip rather than guess
}
if (tracked) {
  const TEXT = /\.(md|html|js|css|json|xml|txt|toml|sql|yml|yaml|csv|webmanifest)$/i;
  let scanned = 0;
  for (const f of tracked) {
    if (!TEXT.test(f) || f.startsWith('public/vendor/')) continue;
    const full = path.join(ROOT, f);
    if (!fs.existsSync(full)) continue;
    scanned++;
    const lines = fs.readFileSync(full, 'utf8').split('\n');
    const bad = [];
    lines.forEach((l, i) => { if (/^(<{7}|\|{7}|>{7})( |$)/.test(l)) bad.push(i + 1); });
    check(f + ': no merge-conflict markers', bad.length === 0, 'line ' + bad.join(', '));
  }
  console.log('  scanned ' + scanned + ' tracked text files');
} else {
  console.log('  skipped (not a git checkout)');
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
