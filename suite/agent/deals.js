// Deal finder for supplies, from an allow-list of sources. It only reads a feed it is handed (fixtures
// for now) and never makes a network call or scrapes a page. Items from a source that is not on the
// allow-list are dropped and counted, so the seller can see something was ignored.
import { ALLOWED_SOURCES, CATEGORIES, DEAL_FEED } from './fixtures/deals.js';

export { ALLOWED_SOURCES, CATEGORIES };

const isCents = (v) => Number.isInteger(v) && v >= 0;

export function findDeals(feed, { category, source, maxPriceCents, minDiscountPct = 0, limit = 10, sources = ALLOWED_SOURCES } = {}) {
  const allowed = new Set(sources.map((s) => s.id));
  const blocked = new Set();
  const ok = [];
  for (const d of feed) {
    if (!allowed.has(d.source)) { blocked.add(d.source); continue; }
    if (!isCents(d.priceCents) || !isCents(d.listPriceCents) || d.listPriceCents === 0) continue; // unusable row
    if (category && d.category !== category) continue;
    if (source && d.source !== source) continue;
    if (maxPriceCents !== undefined && d.priceCents > maxPriceCents) continue;
    const discountPct = Math.round(((d.listPriceCents - d.priceCents) / d.listPriceCents) * 1000) / 10;
    if (discountPct < minDiscountPct) continue;
    const row = { id: d.id, title: d.title, category: d.category, source: d.source, priceCents: d.priceCents, listPriceCents: d.listPriceCents, discountPct, seenAt: d.seenAt, url: d.url };
    if (Number.isInteger(d.units) && d.units > 0) row.perUnitCents = Math.round((d.priceCents / d.units) * 100) / 100;
    ok.push(row);
  }
  ok.sort((a, b) => b.discountPct - a.discountPct || a.priceCents - b.priceCents || a.id.localeCompare(b.id));
  return { total: ok.length, deals: ok.slice(0, limit), ignoredSources: [...blocked].sort(), note: 'Fixture feed. Check the price on the shop\'s own page before buying; this tool never buys.' };
}

export const defaultFeed = () => DEAL_FEED;
