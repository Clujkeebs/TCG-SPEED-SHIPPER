// Content scripts cannot be modules, so this loader imports the real bridge code. The import is
// asynchronous, so messages the page posts meanwhile are queued here and replayed afterwards.
const queue = [];
const hold = (event) => queue.push(event);
addEventListener('message', hold);
import(chrome.runtime.getURL('src/content-bridge.js')).then((bridge) => {
  removeEventListener('message', hold);
  bridge.start();
  for (const event of queue.splice(0)) bridge.handle(event);
});
