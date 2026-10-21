import { Automation } from './automation.js';
import { EngineConnection } from './engine-connection.js';
const automation = new Automation(chrome);
const engine = new EngineConnection(chrome);
const supported = url => /^https:\/\/(www\.)?(chess\.com|lichess\.org)\//.test(url || '');
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id || message?.target !== 'background' || !sender.tab || sender.frameId !== 0 || !supported(sender.url)) return;
  if (!['analyze', 'cancel', 'auto-enable', 'auto-disable', 'auto-move'].includes(message.type)) return;
  (async () => {
    if (message.type === 'auto-enable') return automation.arm(sender, message.gameKey);
    if (message.type === 'auto-disable') {
      await automation.stop(sender.tab.id, typeof message.reason === 'string' ? message.reason.slice(0, 240) : undefined);
      return { ok: true };
    }
    if (message.type === 'auto-move') return automation.move(sender, message);
    if (message.type === 'analyze') {
      const settings = await chrome.storage.local.get({ enabled: true });
      if (!settings.enabled) return { cancelled: true };
    }
    return engine.send({ target: 'engine', type: message.type, tabId: sender.tab.id,
      id: message.id, fen: message.fen, refresh: message.refresh === true });
  })().then(respond, error => respond({ error: error.message }));
  return true;
});
chrome.tabs.onRemoved.addListener(tabId => {
  automation.stop(tabId);
  engine.send({ target: 'engine', type: 'cancel', tabId }).catch(() => {});
});
chrome.tabs.onUpdated.addListener((tabId, change) => {
  if (change.status === 'loading' || change.url) automation.stop(tabId, 'Auto moves reset after navigation.');
});
chrome.tabs.onActivated.addListener(({ tabId }) => {
  for (const id of automation.sessions.keys()) if (id !== tabId) automation.stop(id, 'Auto moves paused: game tab is inactive.');
});
chrome.debugger.onDetach.addListener(({ tabId }) => {
  automation.stop(tabId, 'Browser input disconnected. Auto moves off.');
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.enabled?.newValue === false) for (const id of automation.sessions.keys()) automation.stop(id);
});
