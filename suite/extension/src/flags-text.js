// Plain-words descriptions of each switch and of the overall status, for the popup and Settings.
import { FLAG_DEFS, TOS_OK } from './flags.js';

export const FLAG_TEXT = {
  pasteTracking: { title: 'Paste tracking', what: 'Fills tracking numbers into your TCGplayer "mark as shipped" page. You click Save.' },
  printShipping: { title: 'Print shipping', what: 'Sends the orders on your TCGplayer Orders page to Speed Shipper, with no CSV file.' },
  uploadToTcgplayer: { title: 'Upload to TCGplayer', what: 'Puts the CSV from Speed Scan into the TCGplayer Import page. You click Upload.' },
  agentPanel: { title: 'Agent side panel', what: 'A chat panel that helps with your orders. Practice mode only for now: made-up data.' }
};

export const LOCK_NOTE = 'Helpers that work on TCGplayer are locked. They stay locked until TCGplayer says it is okay and we turn them on in an update. Switching one on here does nothing yet.';

// Lines for the popup: [{ label, state }]
export function statusLines(flags, tosOk = TOS_OK) {
  return Object.entries(FLAG_DEFS).map(([name, def]) => {
    let state;
    if (def.touchesTcgplayer && !tosOk) state = 'Locked (waiting for TCGplayer)';
    else state = flags[name] ? 'On' : 'Off';
    return { label: FLAG_TEXT[name].title, state };
  });
}
