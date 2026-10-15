import { FLAG_DEFS, getFlags, setFlag, TOS_OK } from '../flags.js';

const box = document.getElementById('flags');
document.getElementById('gate').textContent = TOS_OK
  ? 'TCGplayer modules are unlocked.'
  : 'Modules that touch TCGplayer are locked: switching them on does nothing until the Builder records "TOS OK".';

const flags = await getFlags();
for (const [name, def] of Object.entries(FLAG_DEFS)) {
  const label = document.createElement('label');
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = flags[name];
  input.dataset.flag = name;
  input.addEventListener('change', () => setFlag(name, input.checked));
  label.append(input, ' ' + def.label + (def.touchesTcgplayer ? ' (TCGplayer, locked)' : ''));
  box.append(label);
}
