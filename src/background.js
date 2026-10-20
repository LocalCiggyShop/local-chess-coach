import { Automation } from './automation.js';
const automation = new Automation(chrome);
let creating;
async function ensureEngine() {
  const url = chrome.runtime.getURL('offscreen.html');
  if ((await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'], documentUrls: [url] })).length) return;
  if (!creating) creating = chrome.offscreen.createDocument({ url: 'offscreen.html', reasons: ['WORKERS'],
    justification: 'Run the bundled Stockfish WASM worker for local chess analysis.' }).finally(() => { creating = null; });
  await creating;
}
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
      await ensureEngine();
    } else if (!(await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] })).length) return { ok: true };
    return chrome.runtime.sendMessage({ target: 'engine', type: message.type, tabId: sender.tab.id,
      id: message.id, fen: message.fen, refresh: message.refresh === true });
  })().then(respond, error => respond({ error: error.message }));
  return true;
});
chrome.tabs.onRemoved.addListener(tabId => {
  automation.stop(tabId);
  chrome.runtime.sendMessage({ target: 'engine', type: 'cancel', tabId }).catch(() => {});
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
