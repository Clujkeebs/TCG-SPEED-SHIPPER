// Seller-policy knowledge base: a small, cited set of TCGplayer seller rules the Agent can quote when it drafts a
// reply. Every entry is our own short summary of a public source, never a copy, and says where it came from:
//   blog      our own post (public/blog/, read only) and the date that post says it was current
//   official  the TCGplayer help article that post links to, when it links one
// Rules change. Any draft that uses an entry cites its id and tells the seller to check TCGplayer's current article.
// `check` is a phrase that should still appear in the blog post; a test fails if the post changes under us.
const BLOG = 'https://tcgspeedshipper.com/blog/';
const REFUNDS = 'https://help.tcgplayer.com/hc/en-us/articles/24768427937943-Seller-Guide-to-Refunds-and-Returns';
const MISSING = 'https://help.tcgplayer.com/hc/en-us/articles/201318116-How-do-I-resolve-missing-orders-packages-for-my-customers';

const e = (id, topic, title, summary, file, asOf, check, official) => ({
  id, topic, title, summary,
  source: { blog: `public/blog/${file}`, blogUrl: BLOG + file, ...(official ? { official } : {}) },
  asOf, check,
});

export const POLICIES = [
  e('SHIP-1', 'shipping', 'Shipping by order value',
    'Under $20 no tracking is required. Over $20 tracking is recommended. From $49.99 tracking or delivery confirmation is required. From $250 tracking and signature confirmation are required. Shipping without what the order required usually loses a "never arrived" dispute.',
    'tcgplayer-shipping-guidelines.html', '2026-09', '$49.99 and up'),
  e('SHIP-2', 'shipping', 'Free shipping and the $5 rule',
    'Only Level 4 sellers can set standard shipping to $0.00; levels 1 to 3 have a set price range. Orders under $5 from one seller get a $1.49 shipping fee whatever the seller set.',
    'tcgplayer-free-shipping-for-sellers.html', '2026-09', '$1.49 shipping fee'),
  e('SHIP-3', 'shipping', '"Shipping not confirmed"',
    'The status only means the seller has not marked the order shipped. Mark orders shipped the same day you post them and add tracking where there is any. Confirming after the ship-by date counts against on-time shipping.',
    'tcgplayer-shipping-not-confirmed.html', '2026-09', 'marked the order as shipped'),
  e('SHIP-4', 'shipping', 'Normal delivery times',
    'Seller handling is usually 1 to 2 business days. Plain white envelope mail takes about 2 to 5 business days and tracked domestic packages about 1 to 3. A healthy order lands in roughly 3 to 7 business days.',
    'how-long-does-tcgplayer-take-to-ship.html', '2026-09', '3-7 business days'),
  e('LOST-1', 'lost', 'Order missing after the estimated delivery date',
    'The buyer must contact the seller after the estimated delivery date (EDD) and within 30 days of it. If they report on the EDD or within two business days after, the seller may ask them to wait until EDD plus two business days. Later reports get an immediate refund. A missing order means a full refund including the original shipping. Reply within two business days.',
    'tcgplayer-lost-package.html', '2026-09-28', 'EDD + 2 business days', MISSING),
  e('LOST-2', 'lost', 'Untracked envelope that never arrives',
    'An untracked plain white envelope that does not arrive still needs a full refund after any permitted wait. A missing tracking number is not a reason to delay the refund.',
    'tcgplayer-lost-package.html', '2026-09-28', 'untracked PWE', REFUNDS),
  e('LOST-3', 'lost', 'Tracked order marked delivered but missing',
    'Wait two business days after the delivery status. If it is still missing, refund in full and contact TCGplayer. If a signature confirmed delivery, contact TCGplayer to investigate.',
    'tcgplayer-lost-package.html', '2026-09-28', 'Wait two business days after delivery status', MISSING),
  e('RET-1', 'returns', 'Buyer\'s remorse',
    'The seller does not have to accept a return or refund for a change of mind. If the seller agrees to one, the buyer pays the return postage. A package returned or refused without any earlier message from the buyer is not eligible for a refund, with a few exceptions.',
    'tcgplayer-return-policy-for-sellers.html', '2026-09-28', 'Buyer’s remorse', REFUNDS),
  e('RET-2', 'returns', 'Wrong or missing card',
    'For a wrong single the seller offers one of three things: a partial refund if the buyer keeps it, a confirmed replacement, or a full refund after the wrong card comes back. If the seller asks for the wrong card back, the seller provides and pays for prepaid return shipping. Buyers should report within 48 hours of arrival and the seller replies within two business days.',
    'tcgplayer-return-policy-for-sellers.html', '2026-09-28', 'wrong single', REFUNDS),
  e('RET-3', 'returns', 'Damaged in the mail',
    'If the package arrived unopened or everything is damaged, send a prepaid return label and refund after the package is back, using the reason "Package - Damaged". If only some items are damaged, handle those as condition issues. Opened sealed product is no longer eligible.',
    'tcgplayer-return-policy-for-sellers.html', '2026-09-28', 'Package - Damaged', REFUNDS),
  e('ADDR-1', 'address', 'Changing the shipping address',
    'Since the address policy updated on June 30, 2026, a buyer who needs a different address before shipment must request a cancellation and, if approved, place a new order. Do not send an order to an alternate address. If the buyer entered a wrong address and did not flag it before shipment, the order does not qualify for a refund.',
    'tcgplayer-lost-package.html', '2026-09-28', 'Do not send an order to an alternate address', REFUNDS),
  e('LVL-1', 'levels', 'Seller levels',
    'There are four levels. Level 4 needs high steady sales and a feedback rating of 99.5% or more, and Gold Star status comes at 100 or more transactions in 90 days. TCGplayer does not publish the exact thresholds. Shipping on time and grading conservatively protect your rating.',
    'tcgplayer-seller-levels-explained.html', '2026-09-13', '99.5%'),
];

// Frozen: no code path (and no text) can rewrite a rule while the Agent runs.
for (const p of POLICIES) { Object.freeze(p.source); Object.freeze(p); }
Object.freeze(POLICIES);
export const POLICY_IDS = POLICIES.map((p) => p.id);
const byId = new Map(POLICIES.map((p) => [p.id, p]));

export const CHECK_WORDING = 'Rules change, so check TCGplayer\'s current article before relying on this.';

export function getPolicy(id) { return byId.get(id); }

export function searchPolicies(text, { topic } = {}) {
  const words = String(text || '').toLowerCase().split(/[^a-z0-9$.%]+/).filter((w) => w.length > 2);
  return POLICIES
    .filter((p) => !topic || p.topic === topic)
    .map((p) => ({ p, score: words.filter((w) => (p.title + ' ' + p.summary).toLowerCase().includes(w)).length }))
    .filter((x) => !words.length || x.score > 0)
    .sort((a, b) => b.score - a.score || a.p.id.localeCompare(b.p.id))
    .map((x) => x.p);
}

// Which entries a reply category should cite.
export const CATEGORY_POLICIES = {
  'where-is-it': ['LOST-1', 'SHIP-4'],
  'not-shipped': ['SHIP-3', 'SHIP-4'],
  damaged: ['RET-3'],
  'wrong-item': ['RET-2'],
  cancel: ['RET-1'],
  address: ['ADDR-1'],
  other: [],
};

export function citation(p) {
  return `${p.id}: ${p.title} (our post, as of ${p.asOf}). ${p.summary} ${CHECK_WORDING} ${p.source.official || p.source.blogUrl}`;
}

// Seller-only notes added under a draft. The buyer never sees this block.
export function sellerNotes(ids) {
  const list = ids.map((id) => byId.get(id)).filter(Boolean);
  if (!list.length) return '';
  return ['', '---', 'For you, not the buyer. Delete this block before sending.', ...list.map((p) => '- ' + citation(p))].join('\n');
}
