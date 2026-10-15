// Made-up supply deals for the deal finder. Fake shops, example.invalid addresses, never fetched.
// Real feeds would need an allow-listed source and a terms check before any code touches them.
export const ALLOWED_SOURCES = [
  { id: 'fixture-sleeves-co', name: 'Sample Sleeves Co (made up)', kind: 'fixture' },
  { id: 'fixture-shelf-depot', name: 'Sample Shelf Depot (made up)', kind: 'fixture' },
  { id: 'fixture-scan-outlet', name: 'Sample Scanner Outlet (made up)', kind: 'fixture' },
];

export const CATEGORIES = ['sleeves', 'toploaders', 'boxes', 'shelving', 'monitors', 'scanners', 'shipping'];

export const DEAL_FEED = [
  { id: 'd1', source: 'fixture-sleeves-co', title: 'Penny sleeves 1000 ct', category: 'sleeves', priceCents: 1399, listPriceCents: 1899, units: 1000, seenAt: '2026-10-14T09:00:00Z', url: 'https://sleeves.example.invalid/penny-1000' },
  { id: 'd2', source: 'fixture-sleeves-co', title: 'Perfect-fit sleeves 500 ct', category: 'sleeves', priceCents: 1099, listPriceCents: 1199, units: 500, seenAt: '2026-10-14T09:00:00Z', url: 'https://sleeves.example.invalid/pf-500' },
  { id: 'd3', source: 'fixture-sleeves-co', title: 'Toploaders 25 ct closeout', category: 'toploaders', priceCents: 299, listPriceCents: 599, units: 25, seenAt: '2026-10-13T12:00:00Z', url: 'https://sleeves.example.invalid/tl-25' },
  { id: 'd4', source: 'fixture-shelf-depot', title: 'Steel shelving unit, 5 shelf', category: 'shelving', priceCents: 6999, listPriceCents: 9999, units: 1, seenAt: '2026-10-12T15:00:00Z', url: 'https://shelf.example.invalid/steel-5' },
  { id: 'd5', source: 'fixture-shelf-depot', title: 'Cardboard storage boxes 800 ct (10 pack)', category: 'boxes', priceCents: 3499, listPriceCents: 3999, units: 10, seenAt: '2026-10-14T18:00:00Z', url: 'https://shelf.example.invalid/box-800x10' },
  { id: 'd6', source: 'fixture-scan-outlet', title: 'Refurbished 24 inch monitor', category: 'monitors', priceCents: 7900, listPriceCents: 12900, units: 1, seenAt: '2026-10-11T08:00:00Z', url: 'https://scan.example.invalid/mon-24' },
  { id: 'd7', source: 'fixture-scan-outlet', title: 'Flatbed scanner, open box', category: 'scanners', priceCents: 5900, listPriceCents: 8900, units: 1, seenAt: '2026-10-14T20:00:00Z', url: 'https://scan.example.invalid/flatbed' },
  { id: 'd8', source: 'unknown-marketplace', title: 'Toploaders 100 ct (not on the allow-list)', category: 'toploaders', priceCents: 99, listPriceCents: 1999, units: 100, seenAt: '2026-10-14T20:00:00Z', url: 'https://elsewhere.example.invalid/tl' },
];
