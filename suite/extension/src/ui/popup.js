import { getFlags } from '../flags.js';
import { statusLines } from '../flags-text.js';

const list = document.getElementById('status');
for (const { label, state } of statusLines(await getFlags())) {
  const li = document.createElement('li');
  const a = document.createElement('span');
  const b = document.createElement('strong');
  a.textContent = label;
  b.textContent = state;
  li.append(a, b);
  list.append(li);
}
