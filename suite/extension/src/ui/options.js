import { FLAG_DEFS, getFlags, setFlag, TOS_OK } from '../flags.js';
import { FLAG_TEXT, LOCK_NOTE } from '../flags-text.js';
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
  input.addEventListener('change', () => setFlag(name, input.checked));
  const locked = def.touchesTcgplayer && !TOS_OK;
  label.append(input, ' ' + FLAG_TEXT[name].title + (locked ? ' (locked)' : ''));
  const what = document.createElement('p');
  what.className = 'what';
  what.textContent = FLAG_TEXT[name].what;
  box.append(label, what);
}

const settings = await getSettings();
document.getElementById('endpoint').value = settings.agentEndpoint;
document.getElementById('endpointOn').checked = settings.agentEndpointEnabled;
document.getElementById('saveEndpoint').addEventListener('click', async () => {
  const res = await saveEndpoint(document.getElementById('endpoint').value.trim(), document.getElementById('endpointOn').checked);
  document.getElementById('endpointMsg').textContent = res.ok ? 'Saved.' : res.error;
});
