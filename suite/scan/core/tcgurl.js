// Read a TCGplayer product number out of a link the seller pasted. TEXT PARSING ONLY: the page is never fetched.
// Accepted: https://www.tcgplayer.com/product/123456/some-card-name?x=1 (also shop.tcgplayer.com, no scheme, or a bare number).
// Returns a positive integer, or null when it does not look like a TCGplayer product link.
export function productIdFromLink(text) {
  const s = String(text ?? '').trim();
  if (!s) return null;
  if (/^\d{1,9}$/.test(s)) { const n = Number(s); return n > 0 ? n : null; }
  const m = s.match(/^(?:https?:\/\/)?(?:[a-z0-9-]+\.)*tcgplayer\.com\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?(?:[a-z-]+\/)?product\/(\d{1,9})(?=[\/?#]|$)/i)
    || s.match(/^(?:https?:\/\/)?(?:[a-z0-9-]+\.)*tcgplayer\.com\/product\/(\d{1,9})(?=[\/?#]|$)/i);
  if (!m) return null;
  const n = Number(m[1]);
  return n > 0 ? n : null;
}
