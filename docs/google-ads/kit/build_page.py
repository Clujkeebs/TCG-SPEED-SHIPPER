import json, os, sys, html
OUT = sys.argv[1]; c = json.load(open(os.path.join(sys.argv[2], 'copy.json')))
imgs = sorted(os.listdir(os.path.join(OUT, 'images', 'ads'))); notext = sorted(os.listdir(os.path.join(OUT, 'images', 'no-text'))); logos = sorted(os.listdir(os.path.join(OUT, 'images', 'logos')))
e = html.escape
def copyrow(t, lim):
    return f'<li><span class="t">{e(t)}</span><span class="n">{len(t)}/{lim}</span><button onclick="cp(this)">Copy</button></li>'
parts = []
for ag, d in c['ad_groups'].items():
    kws = ''.join(f'<li><span class="t">{e("["+k+"]" if t=="Exact" else chr(34)+k+chr(34))}</span><button onclick="cp(this)">Copy</button></li>' for k, t in d['keywords'])
    parts.append(f'''<section><h3>Ad group: {e(ag)}</h3>
<p class="meta">Final URL: <b>{e(d["url"])}</b> · Display path: tcgspeedshipper.com/{e(d["path"][0])}/{e(d["path"][1])}</p>
<h4>Keywords</h4><ul class="copy">{kws}</ul>
<h4>15 headlines</h4><ul class="copy">{"".join(copyrow(h,30) for h in d["headlines"])}</ul>
<h4>4 descriptions</h4><ul class="copy">{"".join(copyrow(x,90) for x in d["descriptions"])}</ul></section>''')
gallery = lambda folder, files: ''.join(f'<figure><img src="images/{folder}/{f}" loading="lazy"><figcaption>{e(f)}</figcaption></figure>' for f in files)
page = f'''<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Google Ads Kit · TCG Speed Shipper</title>
<style>
:root{{--bg:#f7f5f0;--card:#fff;--ink:#1c1b18;--muted:#6b6960;--line:#e4e0d8;--accent:#2d6a4f}}
body{{margin:0;background:var(--bg);color:var(--ink);font:16px/1.55 -apple-system,system-ui,sans-serif}}
main{{max-width:880px;margin:0 auto;padding:24px 16px 80px}}
h1{{font-size:28px;margin:0 0 4px}} h2{{margin:40px 0 8px;font-size:22px;border-top:2px solid var(--accent);padding-top:16px}}
h3{{margin:24px 0 4px}} h4{{margin:14px 0 6px;color:var(--muted);font-size:13px;text-transform:uppercase;letter-spacing:.05em}}
section{{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px;margin:12px 0}}
.meta{{color:var(--muted);font-size:14px;margin:0}}
ol.steps li{{margin:8px 0}}
ul.copy{{list-style:none;padding:0;margin:0}} ul.copy li{{display:flex;gap:10px;align-items:center;padding:7px 0;border-bottom:1px solid var(--line)}}
ul.copy .t{{flex:1}} ul.copy .n{{color:var(--muted);font-size:12px;font-variant-numeric:tabular-nums}}
button{{border:1px solid var(--accent);background:#fff;color:var(--accent);border-radius:8px;padding:5px 10px;font:600 13px system-ui;cursor:pointer}}
button.ok{{background:var(--accent);color:#fff}}
.grid{{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:12px}}
figure{{margin:0;background:#fff;border:1px solid var(--line);border-radius:10px;padding:8px}} figure img{{width:100%;border-radius:6px;display:block}}
figcaption{{font-size:12px;color:var(--muted);margin-top:6px;word-break:break-all}}
table{{border-collapse:collapse;width:100%;font-size:14px}} td,th{{border-bottom:1px solid var(--line);padding:8px 6px;text-align:left;vertical-align:top}}
.note{{background:#edf7f1;border:1px solid #b7e4c7;border-radius:10px;padding:12px 14px}}
</style></head><body><main>
<h1>Google Ads Kit</h1><p class="meta">TCG Speed Shipper · everything to launch a $150 Search test. Tap <b>Copy</b> next to any line.</p>

<h2>1. Do this, in order (about 45 minutes)</h2>
<ol class="steps">
<li><b>ads.google.com</b>: sign in with the business Gmail. When it pushes a "Smart campaign", tap <b>Switch to Expert Mode</b> → <b>Create an account without a campaign</b>. Country United States, time zone Pacific, currency USD (these can't be changed later).</li>
<li><b>Billing</b>: add your card. Use a new-account promo code if Google shows one.</li>
<li><b>New campaign</b> → goal <b>Website traffic</b> → type <b>Search</b>. Name it exactly <b>{e(c["campaign"])}</b>.</li>
<li>Settings: <b>uncheck</b> Search Partners and Display Network · Location <b>United States</b> ("Presence") · Language English · Bidding <b>Maximize clicks</b> with max CPC <b>$1.50</b> · Budget <b>$5.00/day</b> · turn <b>off</b> AI Max and auto-apply recommendations.</li>
<li>Campaign URL options → <b>Final URL suffix</b>: <code>utm_source=google_ads&amp;utm_medium=cpc&amp;utm_campaign={{campaignid}}&amp;utm_content={{adgroupid}}</code></li>
<li>Create the <b>4 ad groups</b> below: paste each group's keywords, 15 headlines and 4 descriptions. (Or import the CSVs in the <code>google-ads-editor-import</code> folder with Google Ads Editor on a computer.)</li>
<li><b>Assets</b>: add the sitelinks, callouts, structured snippet, price assets, business name <b>TCG Speed Shipper</b>, logos and images (section 3).</li>
<li><b>Tools → Shared library → Negative keyword lists</b>: create "Not our customer", paste the negatives, apply it to the campaign.</li>
<li>Publish. Ads are reviewed within a day. If "TCGplayer" in ad text gets restricted, swap in the backup headlines.</li>
</ol>
<div class="note"><b>How we measure it:</b> no Google tag is needed (the site promises no tracking cookies). Every ad click carries a <code>gclid</code>, and the site already counts those visitors as source <b>google_ads</b> in the admin funnel: visits → CSV loads → PDFs → signups → upgrades. <b>Keep going</b> if the $150 test brings 3+ paying customers (a paying seller is worth about $36, so break-even is ~$15 each). Otherwise pause.</div>

<h2>2. Search campaign text</h2>
{"".join(parts)}
<section><h3>Backup headlines</h3><p class="meta">Use these if Google limits the "TCGplayer" trademark in ad text. Keywords with "tcgplayer" are fine either way.</p>
<ul class="copy">{"".join(copyrow(h,30) for h in c["tm_safe"])}</ul></section>
<section><h3>Negative keywords (phrase match, shared list)</h3><ul class="copy">{"".join(f'<li><span class="t">{e(k)}</span><button onclick="cp(this)">Copy</button></li>' for k in c["negatives"])}</ul>
<p><button onclick="cpAll(this)" data-all="{e(chr(10).join(c["negatives"]))}">Copy all negatives</button></p></section>
<section><h3>Sitelinks</h3><table><tr><th>Text (25)</th><th>Line 1 (35)</th><th>Line 2 (35)</th><th>URL</th></tr>
{"".join(f"<tr><td>{e(t)}</td><td>{e(a)}</td><td>{e(b)}</td><td style='word-break:break-all'>{e(u)}</td></tr>" for t,a,b,u in c["sitelinks"])}</table></section>
<section><h3>Callouts (25)</h3><ul class="copy">{"".join(copyrow(x,25) for x in c["callouts"])}</ul></section>
<section><h3>Structured snippet</h3>{"".join(f"<p>Header: <b>{e(h)}</b><br>Values: {e(', '.join(v))}</p>" for h,v in c["snippets"])}</section>
<section><h3>Price assets</h3><table><tr><th>Header</th><th>Price</th><th>Unit</th><th>Description</th></tr>{"".join(f"<tr><td>{e(h)}</td><td>{e(p)}</td><td>{e(u)}</td><td>{e(d)}</td></tr>" for h,p,u,d in c["prices"])}</table></section>

<h2>3. Images and logos</h2>
<p class="meta">Google image assets: landscape 1.91:1 (1200×628), square 1:1 (1200×1200), portrait 4:5 (960×1200). Logos: square 1:1 and landscape 4:1. Upload 3-4 of each shape.</p>
<h3>Ad images</h3><div class="grid">{gallery("ads", imgs)}</div>
<h3>Product-only (no text; Google favors these for Performance Max)</h3><div class="grid">{gallery("no-text", notext)}</div>
<h3>Logos</h3><div class="grid">{gallery("logos", logos)}</div>

<h2>4. Later: Performance Max and Demand Gen</h2>
<p class="meta">Only after the Search test works. These need a conversion goal to optimize well.</p>
<section><h3>Performance Max asset group</h3>
<h4>Headlines (30)</h4><ul class="copy">{"".join(copyrow(x,30) for x in c["pmax"]["headlines"])}</ul>
<h4>Long headlines (90)</h4><ul class="copy">{"".join(copyrow(x,90) for x in c["pmax"]["long_headlines"])}</ul>
<h4>Descriptions (90; one is under 60)</h4><ul class="copy">{"".join(copyrow(x,90) for x in c["pmax"]["descriptions"])}</ul>
<p>Business name: <b>{e(c["pmax"]["business_name"])}</b> · Call to action: <b>{e(c["pmax"]["cta"])}</b><br>Audience signal (custom segment, people who searched for): tcgplayer shipping labels, tcgplayer packing slip, pwe shipping, pirate ship tcgplayer, rollo printer.</p></section>
<section><h3>Demand Gen (YouTube, Discover, Gmail)</h3>
<h4>Headlines (40)</h4><ul class="copy">{"".join(copyrow(x,40) for x in c["demand_gen"]["headlines"])}</ul>
<h4>Descriptions (90)</h4><ul class="copy">{"".join(copyrow(x,90) for x in c["demand_gen"]["descriptions"])}</ul></section>

<h2>5. Every Monday (10 minutes)</h2>
<ol class="steps"><li><b>Search terms report</b>: add anything irrelevant to the negative list.</li>
<li>Pause any keyword with <b>$15+ spent and 0 CSV loads</b> (admin funnel, source google_ads).</li>
<li>Write the week's spend, clicks, CSV loads, signups and upgrades in the Scoreboard.</li>
<li><b>Day 30</b>: 3+ paying customers → raise to $10/day. Otherwise pause and put the money into creator partners.</li></ol>
</main>
<script>
function cp(b){{var t=b.parentNode.querySelector('.t').textContent;done(b,t);}}
function cpAll(b){{done(b,b.getAttribute('data-all'));}}
function done(b,t){{var f=function(){{var o=b.textContent;b.textContent='Copied';b.classList.add('ok');setTimeout(function(){{b.textContent=o;b.classList.remove('ok');}},1200);}};
if(navigator.clipboard)navigator.clipboard.writeText(t).then(f,function(){{prompt('Copy:',t);}});else prompt('Copy:',t);}}
</script></body></html>'''
open(os.path.join(OUT, 'START-HERE.html'), 'w').write(page)
print('html ok')
