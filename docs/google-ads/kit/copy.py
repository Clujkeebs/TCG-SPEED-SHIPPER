# All Google Ads copy for TCG Speed Shipper, validated against Google's limits.
import csv, json, os, sys
OUT = sys.argv[1]; os.makedirs(OUT, exist_ok=True)
SITE = 'https://tcgspeedshipper.com/'
CAMPAIGN = 'Search - TCG Speed Shipper'
errors = []
def lim(items, n, what):
    for x in items:
        if len(x) > n: errors.append(f'{what} too long ({len(x)}>{n}): {x}')
    return items

COMMON_H = ['Free: 10 Labels a Month', 'No Signup Needed to Start', 'Plans From $2.99/mo', 'Your Data Stays in Browser',
            'Built by a TCGplayer Seller', 'Try a Sample Order Free', 'Unlimited Labels $5.99/mo', 'Stop Typing Buyer Addresses']
AD_GROUPS = {
  'TCGplayer labels': {
    'url': SITE, 'path': ('labels', 'free'),
    'kw': [('tcgplayer shipping labels','Exact'),('tcgplayer shipping label','Exact'),('print tcgplayer shipping labels','Phrase'),
           ('tcgplayer label printer','Exact'),('tcgplayer shipping label template','Exact'),('tcgplayer labels','Exact'),
           ('how to print tcgplayer shipping labels','Phrase'),('tcgplayer address labels','Phrase')],
    'h': ['TCGplayer Orders to Labels', 'Print TCGplayer Labels Fast', 'CSV to Shipping Labels', '4x6, Envelope & Avery 5160',
          'Label + Packing Slip in One', 'Batch-Print All Your Orders', 'Labels in Seconds, Not Hours'],
    'd': ['Upload your TCGplayer order CSV and get print-ready labels, envelopes and slips in seconds',
          'Flags which orders need tracking ($49.99+) or signature ($250+). Free for 10 labels/month.',
          'Thermal 4x6, #10 envelopes, Avery 5160 or label + slip on one page. Try free, no signup.',
          'Made by a card seller for card sellers. Addresses never leave your computer. Start free.'],
  },
  'Packing slips with card lists': {
    'url': SITE, 'path': ('packing-slips', 'free'),
    'kw': [('tcgplayer packing slip','Exact'),('tcgplayer packing slips','Exact'),('print tcgplayer packing slips','Phrase'),
           ('tcgplayer packing slip template','Exact'),('tcgplayer packing list','Exact'),('tcgplayer packing slip pdf','Phrase')],
    'h': ['Packing Slips With Card Lists', 'Slips Sorted to Match Labels', 'Label + Packing Slip in One', 'Uses TCGplayer\'s Own Slips',
          'One File: Label, Then Slip', 'No More Mixed-Up Slips', 'Print Slips in Label Order'],
    'd': ['Add TCGplayer\'s packing slip PDF and every slip lands right behind its matching label.',
          'Card lists included. Each slip is matched to its order automatically. Nothing uploaded.',
          'Thermal printer? Get your slips re-sorted to match your label stack. Free to try.',
          'Made by a card seller for card sellers. 10 free labels a month, no signup needed.'],
  },
  'PWE and envelopes': {
    'url': SITE, 'path': ('pwe', 'envelopes'),
    'kw': [('pwe shipping labels','Phrase'),('print addresses on envelopes from csv','Exact'),('trading card envelope labels','Phrase'),
           ('avery 5160 from csv','Exact'),('plain white envelope trading cards','Phrase'),('print envelopes from csv','Phrase'),
           ('how many stamps to mail a trading card','Phrase')],
    'h': ['PWE Envelopes Printed For You', 'Print #10 Envelopes From CSV', 'Avery 5160 Sheets From CSV', 'Stamp Counts for Every PWE',
          'Envelope OK or Needs Tracking', 'Ship Singles in Envelopes', 'Addresses Printed, Not Typed'],
    'd': ['Print buyer addresses onto #10 envelopes or Avery 5160 sheets straight from your order CSV',
          'Counts the stamps for every envelope order and flags anything over 3.5 oz. Try it free.',
          'Tags each order envelope-OK, tracking required or signature required before you print.',
          'Made by a card seller for card sellers. Addresses never leave your computer. Start free.'],
  },
  'Card shipping tools': {
    'url': SITE, 'path': ('shipping', 'tools'),
    'kw': [('tcgplayer shipping tool','Exact'),('tcgplayer shipping software','Exact'),('card seller shipping software','Phrase'),
           ('trading card shipping software','Exact'),('shipping labels for card sellers','Phrase'),('tcgplayer seller tools','Phrase')],
    'h': ['Trading Card Shipping Tool', 'Shipping Software for TCG', 'Made for TCGplayer Sellers', 'Pirate Ship Export Built In',
          'Mark a Batch Shipped at Once', 'Tracking Sync for TCGplayer', 'Faster Shipping Days'],
    'd': ['Labels, packing slips, stamp counts and a Pirate Ship export from one TCGplayer CSV.',
          'Paste tracking once and get one file that marks the whole batch shipped on TCGplayer.',
          'Flags which orders need tracking ($49.99+) or signature ($250+). Free for 10 labels/month.',
          'Made by a card seller for card sellers. Addresses never leave your computer. Start free.'],
  },
}
# Safer headlines if Google restricts the "TCGplayer" trademark in ad text.
TM_SAFE = ['Card Orders to Labels', 'Print Card Shipping Labels', 'Made for Card Sellers', 'Card Seller Shipping Tool']
NEGATIVES = ['login','log in','sign in','customer service','phone number','careers','jobs','salary','refund','where is my order',
             'track my order','buyer protection','buylist','sell my cards','sell cards to tcgplayer','price guide','prices','coupon',
             'promo code','app store','download app','reddit','scam','stock','ups store','fedex','label maker','dymo software',
             'wedding','address labels for christmas cards']
SITELINKS = [('Pricing & Plans','Free, $2.99/mo or $5.99/mo','Save 2 months with yearly', SITE+'#pricing'),
             ('Card Lists on Slips','Uses TCGplayer\'s own slips','Sorted to match your labels', SITE+'#faq'),
             ('Envelopes & Avery','Print #10 envelopes for PWE','Or 30 labels per Avery sheet', SITE+'blog/how-to-ship-trading-cards-in-a-plain-white-envelope.html'),
             ('How to Print Labels','Step-by-step, 5 minutes','From TCGplayer Export Shipping', SITE+'guide/how-to-print-tcgplayer-shipping-labels.html'),
             ('Enterprise','Automation for card shops','Custom tools and team seats', SITE+'#enterprise'),
             ('Partner Program','Earn 40% recurring','For TCG creators and shops', SITE+'partners.html')]
CALLOUTS = ['Free: 10 labels/month','No signup needed','Data stays in browser','Thermal, Avery, #10','Card lists on slips',
            'Cancel anytime','Made by a card seller','Yearly plans save 2 mo']
SNIPPETS = [('Types', ['4x6 Thermal','#10 Envelope','Avery 5160','Label + Slip','Pull Sheet'])]
PRICES = [('Free','$0','per month','10 labels a month, no signup'),('Base','$2.99','per month','500 labels a month'),
          ('Premium','$5.99','per month','Unlimited labels + design')]
PMAX = {
  'headlines': ['Orders to Labels in Seconds','Card Lists on Every Slip','10 Free Labels a Month','PWE Envelopes, Printed','Made for TCGplayer Sellers'],
  'long_headlines': ['Turn your TCGplayer order CSV into print-ready labels and packing slips in seconds',
                     'Print 4x6 labels, #10 envelopes or Avery sheets straight from your TCGplayer orders',
                     'Packing slips with card lists, sorted to match your labels, all in one file',
                     'Stop typing buyer addresses. Free for 10 labels a month, no signup needed',
                     'Built by a TCGplayer seller: labels, slips, envelopes and tracking in one place'],
  'descriptions': ['Labels and packing slips from one TCGplayer CSV.',
                   'Flags orders that need tracking ($49.99+) or signature ($250+) before you print.',
                   'Thermal 4x6, #10 envelopes, Avery 5160 or label + slip on one page.',
                   'Everything runs in your browser, so buyer addresses never leave your computer.',
                   'Free for 10 labels a month. Base $2.99/mo for 500, Premium $5.99/mo unlimited.'],
  'business_name': 'TCG Speed Shipper', 'cta': 'Sign up',
}
DEMAND_GEN = {
  'headlines': ['Orders to printed labels in seconds','Card lists on every packing slip','10 free shipping labels every month',
                'PWE envelopes printed straight from CSV','Built by a TCGplayer seller, for sellers'],
  'descriptions': PMAX['descriptions'],
}

# ── validate ──
for ag, d in AD_GROUPS.items():
    d['headlines'] = d['h'] + [h for h in COMMON_H if h not in d['h']]
    d['headlines'] = d['headlines'][:15]
    if len(d['headlines']) != 15: errors.append(f'{ag}: need 15 headlines, have {len(d["headlines"])}')
    lim(d['headlines'], 30, f'{ag} headline'); lim(d['d'], 90, f'{ag} description')
    lim(list(d['path']), 15, f'{ag} path')
    if len(set(d['headlines'])) != 15: errors.append(f'{ag}: duplicate headlines')
lim(TM_SAFE, 30, 'tm-safe headline'); lim(CALLOUTS, 25, 'callout')
for t, a, b, u in SITELINKS: lim([t], 25, 'sitelink text'); lim([a, b], 35, 'sitelink line')
lim(PMAX['headlines'], 30, 'pmax headline'); lim(PMAX['long_headlines'], 90, 'pmax long headline'); lim(PMAX['descriptions'], 90, 'pmax description')
if not any(len(x) <= 60 for x in PMAX['descriptions']): errors.append('pmax needs one description <= 60')
lim(DEMAND_GEN['headlines'], 40, 'demand gen headline')
for h, vals in SNIPPETS: lim(vals, 25, 'snippet value')
if errors:
    print('\n'.join(errors)); sys.exit(1)

# ── Google Ads Editor import files ──
def w(name, header, rows):
    with open(os.path.join(OUT, name), 'w', newline='', encoding='utf-8') as f:
        c = csv.writer(f); c.writerow(header); c.writerows(rows)
w('1-keywords.csv', ['Campaign','Ad Group','Keyword','Criterion Type','Final URL'],
  [(CAMPAIGN, ag, k, t, d['url']) for ag, d in AD_GROUPS.items() for k, t in d['kw']])
w('2-negative-keywords.csv', ['Campaign','Keyword','Criterion Type'], [(CAMPAIGN, k, 'Campaign negative phrase') for k in NEGATIVES])
w('3-responsive-search-ads.csv',
  ['Campaign','Ad Group','Ad type'] + [f'Headline {i}' for i in range(1,16)] + [f'Description {i}' for i in range(1,5)] + ['Path 1','Path 2','Final URL'],
  [[CAMPAIGN, ag, 'Responsive search ad'] + d['headlines'] + d['d'] + list(d['path']) + [d['url']] for ag, d in AD_GROUPS.items()])
w('4-sitelinks.csv', ['Campaign','Sitelink text','Description line 1','Description line 2','Final URL'], [(CAMPAIGN,)+s for s in SITELINKS])
w('5-callouts.csv', ['Campaign','Callout text'], [(CAMPAIGN, c) for c in CALLOUTS])
w('6-structured-snippets.csv', ['Campaign','Header','Values'], [(CAMPAIGN, h, ';'.join(v)) for h, v in SNIPPETS])
w('7-price-assets.csv', ['Campaign','Price qualifier','Header','Price','Unit','Description','Final URL'],
  [(CAMPAIGN,'From',h,p,u,dsc,SITE+'#pricing') for h,p,u,dsc in PRICES])

# ── Plain-text copy sheet ──
L = []
def sec(t): L.append('\n' + '=' * 70 + '\n' + t + '\n' + '=' * 70)
sec('SEARCH CAMPAIGN: "' + CAMPAIGN + '"')
for ag, d in AD_GROUPS.items():
    L.append(f'\n--- Ad group: {ag} ---\nFinal URL: {d["url"]}\nDisplay path: tcgspeedshipper.com/{d["path"][0]}/{d["path"][1]}\n\nKeywords:')
    L += [f'  [{k}]' if t == 'Exact' else f'  "{k}"' for k, t in d['kw']]
    L.append('\nHeadlines (max 30 characters):')
    L += [f'  {i+1:>2}. {h}  ({len(h)})' for i, h in enumerate(d['headlines'])]
    L.append('\nDescriptions (max 90 characters):')
    L += [f'  {i+1}. {x}  ({len(x)})' for i, x in enumerate(d['d'])]
sec('BACKUP HEADLINES (use if Google restricts "TCGplayer" in ad text)'); L += ['  ' + h for h in TM_SAFE]
sec('NEGATIVE KEYWORDS (add as a shared list, phrase match)'); L += ['  ' + k for k in NEGATIVES]
sec('SITELINKS'); L += [f'  {t}\n     {a}\n     {b}\n     {u}' for t, a, b, u in SITELINKS]
sec('CALLOUTS (max 25)'); L += ['  ' + c for c in CALLOUTS]
sec('STRUCTURED SNIPPET'); L += [f'  Header: {h}\n  Values: ' + ', '.join(v) for h, v in SNIPPETS]
sec('PRICE ASSETS'); L += [f'  {h}: {p} {u} ({d})' for h, p, u, d in PRICES]
sec('PERFORMANCE MAX ASSET GROUP (only after Search works)')
L.append('Headlines (max 30):'); L += ['  ' + x for x in PMAX['headlines']]
L.append('Long headlines (max 90):'); L += ['  ' + x for x in PMAX['long_headlines']]
L.append('Descriptions (max 90, one under 60):'); L += ['  ' + x for x in PMAX['descriptions']]
L.append('Business name: ' + PMAX['business_name'] + '\nCall to action: ' + PMAX['cta'])
sec('DEMAND GEN (YouTube / Discover / Gmail)')
L.append('Headlines (max 40):'); L += ['  ' + x for x in DEMAND_GEN['headlines']]
L.append('Descriptions (max 90):'); L += ['  ' + x for x in DEMAND_GEN['descriptions']]
open(os.path.join(OUT, 'ALL-AD-COPY.txt'), 'w').write('\n'.join(L).strip() + '\n')
json.dump({'campaign': CAMPAIGN, 'ad_groups': {k: {'url': v['url'], 'path': v['path'], 'keywords': v['kw'], 'headlines': v['headlines'], 'descriptions': v['d']} for k, v in AD_GROUPS.items()},
           'tm_safe': TM_SAFE, 'negatives': NEGATIVES, 'sitelinks': SITELINKS, 'callouts': CALLOUTS, 'snippets': SNIPPETS,
           'prices': PRICES, 'pmax': PMAX, 'demand_gen': DEMAND_GEN}, open(os.path.join(OUT, 'copy.json'), 'w'), indent=1)
print('ok: all copy within Google limits')
