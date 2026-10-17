import { FLAG_DEFS, getFlags, setFlag, TOS_OK } from '../flags.js';
import { FLAG_TEXT, LOCK_NOTE } from '../flags-text.js';
import { SITE_ORIGIN } from '../site-origin.js';
import { getSettings, saveEndpoint } from '../settings.js';

const box = document.getElementById('flags');
const gate = document.getElementById('gate');
gate.textContent = TOS_OK ? 'TCGplayer helpers are unlocked.' : LOCK_NOTE;

const flags = await getFlags();
for (const [name, def] of Object.entries(FLAG_DEFS)) {
  const label = document.createElement('label');
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = flags[name];
  input.dataset.flag = name;
  const note = document.createElement('p');
  note.className = 'what';
  note.setAttribute('role', 'status');
  input.addEventListener('change', async () => {
    note.textContent = '';
    if (def.needsSitePermission) {
      // Chrome only shows its question on a click, so this runs straight from the change event.
      const origins = [SITE_ORIGIN];
      try {
        if (input.checked) {
          if (!(await chrome.permissions.request({ origins }))) { input.checked = false; note.textContent = 'Chrome did not give permission, so this stays off.'; return setFlag(name, false); }
        } else await chrome.permissions.remove({ origins });
      } catch { input.checked = false; note.textContent = 'Could not ask Chrome. This stays off.'; return setFlag(name, false); }
    }
    return setFlag(name, input.checked);
  });
  const locked = def.touchesTcgplayer && !TOS_OK;
  label.append(input, ' ' + FLAG_TEXT[name].title + (locked ? ' (locked)' : ''));
  const what = document.createElement('p');
  what.className = 'what';
  what.textContent = FLAG_TEXT[name].what;
  box.append(label, what, note);
}

const settings = await getSettings();
document.getElementById('endpoint').value = settings.agentEndpoint;
document.getElementById('endpointOn').checked = settings.agentEndpointEnabled;
document.getElementById('saveEndpoint').addEventListener('click', async () => {
  const res = await saveEndpoint(document.getElementById('endpoint').value.trim(), document.getElementById('endpointOn').checked);
  document.getElementById('endpointMsg').textContent = res.ok ? 'Saved.' : res.error;
});

// Clear everything: ask first, then have the service worker erase it all.
const ask = document.getElementById('clearAsk'), sure = document.getElementById('clearSure'), msg = document.getElementById('clearMsg');
ask.addEventListener('click', () => { ask.hidden = true; sure.hidden = false; document.getElementById('clearNo').focus(); });
document.getElementById('clearNo').addEventListener('click', () => { sure.hidden = true; ask.hidden = false; ask.focus(); });
document.getElementById('clearYes').addEventListener('click', async () => {
  sure.hidden = true; ask.hidden = false;
  let res;
  try { res = await chrome.runtime.sendMessage({ source: 'tcgss-admin', type: 'clear-everything' }); } catch { res = null; }
  msg.textContent = res && res.ok ? 'Everything was erased. Reload this page to see the defaults.' : 'Something went wrong and nothing was erased. Try again.';
  ask.focus();
});
