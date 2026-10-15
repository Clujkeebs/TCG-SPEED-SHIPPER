// Support reply drafts. Pure text from templates: a draft for the seller to review, never sent.
// The drafter makes no promises about refunds or replacements; those stay the seller's decision.
const CATEGORIES = [
  ['damaged', /\b(damag|bent|crease|creased|crushed|torn|scratch|wet|water)\w*/i],
  ['wrong-item', /\b(wrong|incorrect|different|not what i ordered|missing)\b/i],
  ['cancel', /\b(cancel|changed my mind|refund)\w*/i],
  ['where-is-it', /\b(where|track|tracking|arrive|arrived|late|when will|shipped|status|delay)\w*/i],
];

export function classify(message) {
  for (const [name, re] of CATEGORIES) if (re.test(message)) return name;
  return 'other';
}

const firstName = (order) => (order.shipTo.name || '').split(' ')[0] || 'there';
const days = (a, b) => Math.floor((Date.parse(b) - Date.parse(a)) / 86400000);

export function draftReply(order, message, { sellerName = 'the shop', now } = {}) {
  const category = classify(message);
  const hi = `Hi ${firstName(order)},\n\n`;
  const bye = `\n\nThanks,\n${sellerName}`;
  const notes = [];
  let body;
  let needsHuman = false;

  if (category === 'where-is-it') {
    if (order.shippedAt && order.trackingNumber) {
      body = `Your order ${order.id} shipped on ${order.shippedAt.slice(0, 10)} with ${order.carrier || 'the carrier'}. Tracking number: ${order.trackingNumber}. It can take a few days to show movement, and I'm happy to check again if it stalls.`;
    } else {
      const waited = now ? days(order.orderedAt, now) : null;
      body = `Thanks for your patience. Your order ${order.id} hasn't shipped yet and I'm getting it packed. I'll send tracking as soon as it goes out.`;
      if (waited !== null && waited >= 3) notes.push(`Order is ${waited} days old and unshipped: ship it or explain the delay.`);
    }
  } else if (category === 'damaged') {
    needsHuman = true;
    body = `I'm sorry your order ${order.id} arrived in that shape. Could you send a photo of the cards and the packaging? Once I've seen it I'll sort out the next step with you.`;
    notes.push('Seller decides on refund or replacement. The draft promises neither.');
  } else if (category === 'wrong-item') {
    needsHuman = true;
    body = `Thanks for letting me know about order ${order.id}. Could you tell me which card or cards are wrong or missing? I'll check against what I packed and come back to you.`;
    notes.push('Check the pick list before replying further.');
  } else if (category === 'cancel') {
    needsHuman = true;
    body = order.shippedAt
      ? `Order ${order.id} has already shipped, so I can't cancel it, but I'm glad to look at options once it arrives.`
      : `I've seen your request about order ${order.id}. Let me check where it is in packing and I'll get back to you shortly.`;
    notes.push('Cancellations and refunds are the seller\'s call.');
  } else {
    needsHuman = true;
    body = `Thanks for your message about order ${order.id}. I'll take a look and reply properly soon.`;
  }
  return { orderId: order.id, category, draft: hi + body + bye, needsHuman, notes, sent: false };
}
