// Scan uploader (skeleton). Takes the CSV the seller just made in Speed Scan and puts it in the
// file box on an import page. It never presses Upload: the seller does. Off unless the
// "uploadToTcgplayer" flag is on AND the TOS gate is open (guardedAdapter checks both).
import { guardedAdapter } from '../adapters/index.js';

export const MAX_CSV_BYTES = 5 * 1024 * 1024;

// Checks only what we can know without TCGplayer's real format: a .csv name, a size, a header and a row.
// (The real column check waits for a real export file; see docs/suite/LOG.md.)
export function prepareUpload({ name, text } = {}) {
  if (typeof name !== 'string' || !/^[\w .()-]{1,100}\.csv$/i.test(name)) return { ok: false, error: 'The file name must end in .csv and use plain characters.' };
  if (typeof text !== 'string' || text.trim() === '') return { ok: false, error: 'The file is empty.' };
  if (text.length > MAX_CSV_BYTES) return { ok: false, error: 'The file is too big (over 5 MB).' };
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '');
  if (lines.length < 2) return { ok: false, error: 'The file needs a header row and at least one card.' };
  return { ok: true, rows: lines.length - 1, file: new Blob([text], { type: 'text/csv' }), name };
}

// Returns a plain-words result for the UI. `doc` is the import page; `File` comes from that page.
export async function attachCsv(doc, upload, { dryRun = true, flagOptions = {}, log = () => {} } = {}) {
  const prepared = prepareUpload(upload);
  if (!prepared.ok) return { ok: false, message: prepared.error };
  const adapter = await guardedAdapter('uploadToTcgplayer', doc, { dryRun, log }, flagOptions);
  if (!adapter) return { ok: false, message: 'This helper is switched off.' };
  if (adapter.detectPage() !== 'import') return { ok: false, message: 'Open the Import CSV page first.' };
  const file = new doc.defaultView.File([prepared.file], prepared.name, { type: 'text/csv' });
  const res = adapter.attachFile(file);
  if (!res.attached) return { ok: false, message: 'Could not find the file box on this page.' };
  return {
    ok: true,
    dryRun,
    message: dryRun
      ? `Practice run: would attach ${prepared.name} (${prepared.rows} cards). Nothing was changed.`
      : `Attached ${prepared.name} (${prepared.rows} cards). Check it, then press Upload yourself.`
  };
}
