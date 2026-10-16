// Support reply drafts. Pure text from templates: a draft for the seller to review, never sent.
// The drafter makes no promises about refunds or replacements; those stay the seller's decision.
// Tone: 'friendly' (default), 'formal' or 'brief'.
import { CATEGORY_POLICIES, sellerNotes } from './policies.js';
export const TONES = ['friendly', 'formal', 'brief'];

const CATEGORIES = [
  ['address', /\baddress\b/i],
  ['damaged', /\b(damag|bent|crease|creased|crushed|torn|scratch|wet|water)\w*/i],
  ['wrong-item', /\b(wrong|incorrect|different|not what i ordered|missing)\b/i],
  ['cancel', /\b(cancel|changed my mind|refund)\w*/i],
  ['where-is-it', /\b(where|track|tracking|arrive|arrived|late|when will|shipped|status|delay)\w*/i],
];

export function classify(message) {
  for (const [name, re] of CATEGORIES) if (re.test(message)) return name;
  return 'other';
}

// The draft never holds a buyer's name. It carries {{first_name}}, filled in on the seller's device by
// fillPlaceholders() after the model (or the panel) has seen the draft.
export const FIRST_NAME = '{{first_name}}';
export const firstNameOf = (order) => (order.shipTo.name || '').split(' ')[0] || 'there';
export function fillPlaceholders(text, { firstName }) {
  return String(text).split(FIRST_NAME).join(firstName || 'there');
}
const days = (a, b) => Math.floor((Date.parse(b) - Date.parse(a)) / 86400000);

const FRAME = {
  friendly: { hi: (n) => `Hi ${n},\n\n`, bye: (s) => `\n\nThanks,\n${s}` },
  formal: { hi: (n) => `Dear ${n},\n\n`, bye: (s) => `\n\nKind regards,\n${s}` },
  brief: { hi: (n) => `Hi ${n},\n`, bye: (s) => `\n${s}` },
};

// Each body: [friendly, formal, brief]
const BODY = {
  shipped: (o) => [
    `Your order ${o.id} shipped on ${o.shippedAt && o.shippedAt.slice(0, 10)} with ${o.carrier || 'the carrier'}. Tracking number: ${o.trackingNumber}. It can take a few days to show movement, and I'm happy to check again if it stalls.`,
    `Your order ${o.id} was shipped on ${o.shippedAt && o.shippedAt.slice(0, 10)} via ${o.carrier || 'the carrier'}. The tracking number is ${o.trackingNumber}. Please allow a few days for tracking to update; I will gladly investigate if it stalls.`,
    `${o.id} shipped ${o.shippedAt && o.shippedAt.slice(0, 10)} (${o.carrier || 'carrier'}), tracking ${o.trackingNumber}.`,
  ],
  notShipped: (o) => [
    `Thanks for your patience. Your order ${o.id} hasn't shipped yet and I'm getting it packed. I'll send tracking as soon as it goes out.`,
    `Thank you for your patience. Order ${o.id} has not yet shipped; it is being prepared and tracking will follow as soon as it is dispatched.`,
    `${o.id} isn't shipped yet. Packing now; tracking to follow.`,
  ],
  damaged: (o) => [
    `I'm sorry your order ${o.id} arrived in that shape. Could you send a photo of the cards and the packaging? Once I've seen it I'll sort out the next step with you.`,
    `I apologise that order ${o.id} arrived damaged. Please send a photograph of the cards and the packaging, and I will review the matter and respond with next steps.`,
    `Sorry about ${o.id}. Please send photos of the cards and packaging and I'll follow up.`,
  ],
  wrong: (o) => [
    `Thanks for letting me know about order ${o.id}. Could you tell me which card or cards are wrong or missing? I'll check against what I packed and come back to you.`,
    `Thank you for notifying me regarding order ${o.id}. Please state which cards are incorrect or missing, and I will check this against what was packed.`,
    `Which card(s) on ${o.id} are wrong or missing? I'll check what I packed.`,
  ],
  cancelShipped: (o) => [
    `Order ${o.id} has already shipped, so I can't cancel it, but I'm glad to look at options once it arrives.`,
    `Order ${o.id} has already been shipped and cannot be cancelled. I am happy to discuss options once it has arrived.`,
    `${o.id} already shipped, so it can't be cancelled. Happy to look at options once it arrives.`,
  ],
  cancelOpen: (o) => [
    `I've seen your request about order ${o.id}. Let me check where it is in packing and I'll get back to you shortly.`,
    `I have received your request regarding order ${o.id}. I will check its status and reply shortly.`,
    `Got your request on ${o.id}. Checking its status and will reply shortly.`,
  ],
  address: (o) => [
    `Thanks for flagging the address on order ${o.id}. Once an order is placed I can't send it somewhere else. If it hasn't shipped, the way to fix it is to request a cancellation on TCGplayer and place a new order with the right address.`,
    `Thank you for contacting me about the address on order ${o.id}. An order cannot be redirected once placed. If it has not shipped, please request a cancellation through TCGplayer and place a new order with the correct address.`,
    `${o.id}: I can't change the address after the order is placed. If it hasn't shipped, request a cancellation on TCGplayer and reorder with the right address.`,
  ],
  other: (o) => [
    `Thanks for your message about order ${o.id}. I'll take a look and reply properly soon.`,
    `Thank you for your message regarding order ${o.id}. I will review it and reply in due course.`,
    `Got your message about ${o.id}. Will reply soon.`,
  ],
};

export function draftReply(order, message, { sellerName = 'the shop', now, tone = 'friendly' } = {}) {
  if (!TONES.includes(tone)) throw new Error('tone must be one of ' + TONES.join(', '));
  const category = classify(message);
  const i = TONES.indexOf(tone);
  const notes = [];
  let key;
  let needsHuman = true;

  if (category === 'where-is-it') {
    needsHuman = false;
    if (order.shippedAt && order.trackingNumber) key = 'shipped';
    else {
      key = 'notShipped';
      const waited = now ? days(order.orderedAt, now) : null;
      if (waited !== null && waited >= 3) notes.push(`Order is ${waited} days old and unshipped: ship it or explain the delay.`);
    }
  } else if (category === 'address') {
    key = 'address';
    notes.push('Do not ship to a different address than the one on the order.');
  } else if (category === 'damaged') {
    key = 'damaged';
    notes.push('Seller decides on refund or replacement. The draft promises neither.');
  } else if (category === 'wrong-item') {
    key = 'wrong';
    notes.push('Check the pick list before replying further.');
  } else if (category === 'cancel') {
    key = order.shippedAt ? 'cancelShipped' : 'cancelOpen';
    notes.push('Cancellations and refunds are the seller\'s call.');
  } else key = 'other';

  const f = FRAME[tone];
  const policies = key === 'notShipped' ? CATEGORY_POLICIES['not-shipped'] : CATEGORY_POLICIES[category] || [];
  const reply = f.hi(FIRST_NAME) + BODY[key](order)[i] + f.bye(sellerName);
  // `message` is for the buyer; `draft` adds a seller-only block that cites the policy entries it relied on.
  return { orderId: order.id, category, tone, message: reply, draft: reply + sellerNotes(policies), policies, needsHuman, notes, sent: false, placeholders: ['first_name'] };
}
