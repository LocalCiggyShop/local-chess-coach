const missingReceiver = error => /Could not establish connection\. Receiving end does not exist\./i.test(error?.message || '');
const unavailable = () => new Error('The local engine could not connect. Click Refresh to retry.');

// An offscreen context can be visible before its module registers a listener.
export class EngineConnection {
  constructor(api, { pause = ms => new Promise(resolve => setTimeout(resolve, ms)), attempts = 30 } = {}) {
    this.api = api; this.pause = pause; this.attempts = attempts; this.connecting = null;
  }
  ensure() {
    if (!this.connecting) this.connecting = this.connect().finally(() => { this.connecting = null; });
    return this.connecting;
  }
  async connect() {
    const url = this.api.runtime.getURL('offscreen.html');
    const contexts = await this.api.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'], documentUrls: [url] });
    if (!contexts.length) await this.api.offscreen.createDocument({ url: 'offscreen.html', reasons: ['WORKERS'],
      justification: 'Run the bundled Stockfish WASM worker for local chess analysis.' });
    for (let attempt = 0; attempt < this.attempts; attempt++) {
      try {
        const response = await this.api.runtime.sendMessage({ target: 'engine', type: 'ping' });
        if (response?.ready === true) return;
      } catch (error) { if (!missingReceiver(error)) throw error; }
      if (attempt + 1 < this.attempts) await this.pause(100);
    }
    throw unavailable();
  }
  async send(message) {
    if (message.type === 'cancel') {
      // Cancellation must never create an engine or wait behind startup.
      try { return await this.api.runtime.sendMessage(message); }
      catch (error) { if (missingReceiver(error)) return { ok: true }; throw error; }
    }
    for (let attempt = 0; attempt < 2; attempt++) {
      await this.ensure();
      try { return await this.api.runtime.sendMessage(message); }
      catch (error) { if (!missingReceiver(error)) throw error; }
    }
    throw unavailable();
  }
}
