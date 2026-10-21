import { EngineQueue } from './engine.js';
import { validFen } from './position.js';

const queue = new EngineQueue(() => new Worker(chrome.runtime.getURL('vendor/stockfish/stockfish-19-lite-single.js')));
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id || message?.target !== 'engine') return;
  if (message.type === 'ping') { respond({ ready: true }); return; }
  if (message.type === 'cancel' && Number.isInteger(message.tabId)) { queue.cancel(message.tabId); respond({ ok: true }); return; }
  if (message.type !== 'analyze' || !Number.isInteger(message.tabId) || !validFen(message.fen) ||
      typeof message.id !== 'string' || message.id.length > 300) { respond({ error: 'Invalid analysis request.' }); return; }
  queue.analyze(message).then(respond, error => respond({ error: error.message }));
  return true;
});
