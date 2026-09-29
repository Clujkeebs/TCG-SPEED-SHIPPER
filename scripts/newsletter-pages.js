/* Publishes newsletter issues as web pages.
   `node scripts/newsletter-pages.js` turns every docs/newsletter/YYYY-MM-DD.md
   dated today or earlier (future drafts stay private) into
   public/newsletter/YYYY-MM-DD.html, lists them on /newsletter.html between
   the <!-- issues:start/end --> markers, and adds them to the sitemap.
   Run it after each Tuesday send; it's idempotent. Each archived issue is
   one more indexable page, and a sample for people deciding to subscribe. */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'docs', 'newsletter');
const OUT = path.join(ROOT, 'public', 'newsletter');
const SITE = 'https://tcgspeedshipper.com';
const today = process.env.NEWSLETTER_TODAY || new Date().toISOString().slice(0, 10);

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Inline markdown: **bold**, bare URLs. Our own links get the archive UTM
// instead of the email one, so web readers aren't counted as email clicks.
function inline(text) {
  let s = esc(text).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  return s.replace(/https?:\/\/[^\s<]+[^\s<.,;:)]/g, (url) => {
    const href = url.replace('utm_source=email', 'utm_source=newsletter_web');
    const shown = url.replace(/^https?:\/\//, '').replace(/\?.*$/, '');
    return '<a href="' + href + '">' + shown + '</a>';
  });
}

function parse(md) {
  md = md.replace(/<!--[\s\S]*?-->/g, '');
  const subject = (md.match(/^Subject:\s*(.+)$/m) || [])[1] || '';
  const preview = (md.match(/^Preview:\s*(.+)$/m) || [])[1] || '';
  const body = md.replace(/^(Subject|Preview):.*$/gm, '').trim();
  const html = [];
  for (const block of body.split(/\n\s*\n/)) {
    const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);
    if (!lines.length) continue;
    if (lines.every((l) => /^- /.test(l) || !/^\S/.test(l))) {
      html.push('<ul>' + lines.join('\n').split(/\n(?=- )/).map((li) => '<li>' + inline(li.replace(/^- /, '').replace(/\n/g, ' ')) + '</li>').join('') + '</ul>');
    } else if (lines.length === 1 && /^\*\*.+\*\*$/.test(lines[0])) {
      html.push('<h2>' + inline(lines[0].replace(/^\*\*|\*\*$/g, '')) + '</h2>');
    } else if (lines.some((l) => /^- /.test(l))) {
      // A lead-in sentence followed by a list.
      const i = lines.findIndex((l) => /^- /.test(l));
      html.push('<p>' + inline(lines.slice(0, i).join(' ')) + '</p>');
      html.push('<ul>' + lines.slice(i).join('\n').split(/\n(?=- )/).map((li) => '<li>' + inline(li.replace(/^- /, '').replace(/\n/g, ' ')) + '</li>').join('') + '</ul>');
    } else {
      html.push('<p>' + inline(lines.join(' ')) + '</p>');
    }
  }
  return { subject, preview, html: html.join('\n') };
}

function longDate(d) {
  return new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

const shell = fs.readFileSync(path.join(ROOT, 'public', 'newsletter.html'), 'utf8');
const issues = fs.readdirSync(SRC).filter((f) => /^\d{4}-\d{2}-\d{2}\.md$/.test(f)).map((f) => f.slice(0, 10))
  .filter((d) => d <= today).sort().reverse();
fs.mkdirSync(OUT, { recursive: true });

for (const d of issues) {
  const { subject, preview, html } = parse(fs.readFileSync(path.join(SRC, d + '.md'), 'utf8'));
  const url = SITE + '/newsletter/' + d + '.html';
  let title = subject + ' | TCG seller weekly';
  if (title.length > 70) title = subject.slice(0, 70);
  let page = shell
    .replace(/<title>[^<]*<\/title>/, '<title>' + esc(title) + '</title>')
    .replace(/(<meta name="description" content=")[^"]*/, '$1' + esc(preview))
    .replace(/(<meta property="og:description" content=")[^"]*/, '$1' + esc(preview))
    .replace(/(<meta name="twitter:description" content=")[^"]*/, '$1' + esc(preview))
    .replace(/(<meta property="og:title" content=")[^"]*/, '$1' + esc(title))
    .replace(/(<meta name="twitter:title" content=")[^"]*/, '$1' + esc(title))
    .replace(/(<meta property="og:type" content=")[^"]*/, '$1article')
    .split(SITE + '/newsletter.html').join(url)
    .replace(/<script type="application\/ld\+json">[\s\S]*?<\/script>/, '<script type="application/ld+json">\n' +
      JSON.stringify({ '@context': 'https://schema.org', '@type': 'Article', headline: subject, datePublished: d, url,
        author: { '@type': 'Person', name: 'Sam (Clujkeebs)' }, publisher: { '@type': 'Organization', name: 'TCG Speed Shipper', url: SITE + '/' } }) + '\n</script>');
  const a = page.indexOf('<div class="page-wrap">'), b = page.indexOf('</main>');
  page = page.slice(0, a) + '<div class="page-wrap">\n  <h1>' + esc(subject) + '</h1>\n' +
    '  <p class="updated">TCG seller weekly · ' + longDate(d) + ' · <a href="/newsletter.html">Get it every Tuesday</a></p>\n' +
    '  <article class="card issue">\n' + html + '\n  </article>\n' +
    '  <div class="highlight">Like this? One short email like it every Tuesday.<div data-news-slot class="news-slot"></div></div>\n' +
    '</div>\n' + page.slice(b);
  fs.writeFileSync(path.join(OUT, d + '.html'), page);
}

// Past-issues list on /newsletter.html.
const list = issues.length
  ? '<ul>\n' + issues.map((d) => {
      const { subject } = parse(fs.readFileSync(path.join(SRC, d + '.md'), 'utf8'));
      return '      <li><a href="/newsletter/' + d + '.html">' + esc(subject) + '</a> · ' + longDate(d) + '</li>';
    }).join('\n') + '\n    </ul>'
  : '<p>The first issue goes out Tuesday.</p>';
const np = path.join(ROOT, 'public', 'newsletter.html');
fs.writeFileSync(np, fs.readFileSync(np, 'utf8').replace(/(<!-- issues:start -->)[\s\S]*?(<!-- issues:end -->)/, '$1\n    ' + list + '\n    $2'));

// Sitemap entries.
const sp = path.join(ROOT, 'public', 'sitemap.xml');
let sm = fs.readFileSync(sp, 'utf8');
for (const d of issues) {
  const loc = SITE + '/newsletter/' + d + '.html';
  if (sm.includes('<loc>' + loc + '</loc>')) continue;
  sm = sm.replace('</urlset>', '<url>\n  <loc>' + loc + '</loc>\n  <lastmod>' + d + 'T00:00:00+00:00</lastmod>\n  <changefreq>yearly</changefreq>\n  <priority>0.5</priority>\n</url>\n</urlset>');
}
fs.writeFileSync(sp, sm);
console.log('newsletter pages:', issues.join(', ') || '(none yet)');
