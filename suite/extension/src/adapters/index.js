// Page adapters: one interface over a TCGplayer-style page (detectPage, readOrders, fillTracking,
// openImport, attachFile). They work on a Document you hand them and never fetch anything.
//
// Safety:
//  - dryRun defaults to TRUE: it only records what it would do in `actions`; the page is untouched.
//  - Even with dryRun off, nothing is ever submitted. Fill and attach only; the seller clicks the
//    page's own Save / Upload button.
//  - Callers must check the feature flag and the TOS gate first (see `guardedAdapter`).
import { PAGES } from './selectors.js';
import { validateOrder, dollarsToCents } from '../vendor/models.js';
import { isEnabled } from '../flags.js';

const text = (el, sel) => el?.querySelector(sel)?.textContent.trim() ?? '';

// A local pseudonymous key (not a security hash): lets repeat buyers be spotted without the name.
export function buyerKeyFor(name, postalCode) {
  let h = 5381;
  for (const ch of `${name.toLowerCase()}|${postalCode}`) h = ((h << 5) + h + ch.codePointAt(0)) >>> 0;
  return 'b-' + h.toString(36);
}

export function createAdapter(doc, { dryRun = true, log = () => {}, pages = PAGES, url = doc.location?.href ?? '' } = {}) {
  const actions = [];
  const record = (action) => {
    actions.push(action);
    log(action);
  };
  const pageOf = (kind) => pages[kind];

  function detectPage() {
    for (const [kind, p] of Object.entries(pages)) if (doc.querySelector(p.detect.selector)) return kind;
    return 'unknown';
  }

  // Which selectors for the current page (or `kind`) match nothing right now.
  function selfTest(kind = detectPage()) {
    if (!pageOf(kind)) return { page: kind, ok: false, missing: [], error: 'unknown page' };
    const missing = Object.entries(pageOf(kind).selectors)
      .filter(([, sel]) => !doc.querySelector(sel))
      .map(([key, selector]) => ({ key, selector }));
    return { page: kind, ok: missing.length === 0, missing };
  }

  function readOrders() {
    const s = pages.orders.selectors;
    const orders = [];
    const problems = [];
    for (const row of doc.querySelectorAll(s.row)) {
      const id = row.dataset.orderId;
      const name = text(row, s.buyerName);
      const postalCode = text(row, s.postalCode);
      const order = {
        id,
        source: 'tcgplayer',
        orderedAt: text(row, s.orderDate),
        status: text(row, s.status),
        buyerKey: buyerKeyFor(name, postalCode),
        shipTo: {
          name,
          address1: text(row, s.address1),
          ...(text(row, s.address2) ? { address2: text(row, s.address2) } : {}),
          city: text(row, s.city),
          state: text(row, s.state),
          postalCode,
          country: text(row, s.country)
        },
        items: [...row.querySelectorAll(s.item)].map((li) => ({
          name: text(li, s.itemName),
          quantity: parseInt(text(li, s.itemQty), 10),
          priceCents: dollarsToCents(text(li, s.itemPrice))
        })),
        itemsTotalCents: dollarsToCents(text(row, s.itemsTotal)),
        shippingPaidCents: dollarsToCents(text(row, s.shippingPaid))
      };
      const check = validateOrder(order);
      if (check.ok) orders.push(order);
      else problems.push({ id: id ?? '(no id)', errors: check.errors });
    }
    record({ type: 'read', page: 'orders', count: orders.length, skipped: problems.length });
    return { orders, problems };
  }

  // map: { [orderId]: { trackingNumber, carrier? } }. Returns what was (or would be) filled.
  function fillTracking(map) {
    const s = pages.markShipped.selectors;
    const done = [];
    const notFound = [];
    for (const [orderId, entry] of Object.entries(map)) {
      const row = [...doc.querySelectorAll(s.row)].find((r) => r.dataset.orderId === orderId);
      const input = row?.querySelector(s.tracking);
      if (!input || typeof entry?.trackingNumber !== 'string' || !entry.trackingNumber.trim()) {
        notFound.push(orderId);
        continue;
      }
      record({ type: 'fill', field: 'tracking', orderId, length: entry.trackingNumber.length });
      if (entry.carrier) record({ type: 'fill', field: 'carrier', orderId, value: entry.carrier });
      if (!dryRun) {
        input.value = entry.trackingNumber.trim();
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        const select = row.querySelector(s.carrier);
        if (select && entry.carrier) {
          select.value = entry.carrier;
          select.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }
      done.push(orderId);
    }
    return { done, notFound };
  }

  // Finds the Import CSV link; navigates only when dryRun is off.
  function openImport() {
    const link = doc.querySelector(pages.orders.selectors.importLink);
    if (!link) return { found: false };
    record({ type: 'navigate', to: link.getAttribute('href') });
    if (!dryRun) link.click();
    return { found: true, href: link.getAttribute('href') };
  }

  // Puts the seller's CSV into the page's file box. Never clicks Upload.
  function attachFile(file) {
    const input = doc.querySelector(pages.import.selectors.fileInput);
    if (!input) return { attached: false, reason: 'file input not found' };
    if (!/\.csv$/i.test(file?.name ?? '')) return { attached: false, reason: 'only .csv files' };
    record({ type: 'attach', name: file.name, size: file.size });
    if (!dryRun) {
      const dt = new (doc.defaultView.DataTransfer)();
      dt.items.add(file);
      input.files = dt.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }
    return { attached: true };
  }

  return { detectPage, selfTest, readOrders, fillTracking, openImport, attachFile, actions, dryRun };
}

// The only way extension code should get an adapter: refuses unless the flag is on AND TOS is OK.
export async function guardedAdapter(flagName, doc, options = {}, flagOptions = {}) {
  if (!(await isEnabled(flagName, flagOptions))) return null;
  return createAdapter(doc, options);
}
