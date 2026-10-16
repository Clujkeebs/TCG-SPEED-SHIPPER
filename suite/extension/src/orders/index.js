// The small interface between "the seller's order file" and the rest of the extension.
//   parser: { name, parse(text) -> { ok, orders, skipped: [{row, reason}], rows, error? } }
// The Agent session is writing a faster parser; when it is merged, vendor it and pass it as `parser`.
import { parseOrderExport } from './parser.js';

export const defaultParser = { name: 'extension-basic', parse: parseOrderExport };

// Read, check and (optionally) save. `save(orders)` is called only when parsing worked.
export async function importOrderText(text, { parser = defaultParser, save } = {}) {
  const t0 = Date.now();
  const res = parser.parse(text);
  if (!res || typeof res !== 'object' || !Array.isArray(res.orders)) return { ok: false, error: 'The reader returned something unexpected.', orders: [], skipped: [] };
  if (!res.ok) return res;
  if (save) await save(res.orders);
  return { ...res, parser: parser.name, ms: Date.now() - t0 };
}
