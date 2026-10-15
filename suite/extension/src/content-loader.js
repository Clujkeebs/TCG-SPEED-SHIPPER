// Content scripts cannot be modules, so this loader imports the real bridge code.
import(chrome.runtime.getURL('src/content-bridge.js'));
