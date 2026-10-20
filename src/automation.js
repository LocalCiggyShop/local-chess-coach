import { validFen } from './position.js';
import { expectedPosition } from './play-state.js';

// Privileged input stays in the extension. The page-world bridge remains read-only.
export class Automation {
  constructor(api, pause = ms => new Promise(resolve => setTimeout(resolve, ms))) {
    this.api = api; this.pause = pause; this.sessions = new Map();
  }
  async stop(tabId, reason = 'Auto moves off.') {
    const session = this.sessions.get(tabId);
    if (!session) return;
    this.sessions.delete(tabId);
    session.enabled = false;
    if (session.pressed) {
      await this.api.debugger.sendCommand({ tabId }, 'Input.dispatchMouseEvent', {
        type: 'mouseReleased', button: 'left', buttons: 0, clickCount: 1, ...session.origin,
      }).catch(() => {});
    }
    if (session.attached) await this.api.debugger.detach({ tabId }).catch(() => {});
    await this.api.tabs.sendMessage(tabId, { type: 'auto-stopped', sessionId: session.id, reason }).catch(() => {});
  }
  async arm(sender, gameKey) {
    if (typeof gameKey !== 'string' || !gameKey || gameKey.length > 400) throw new Error('Invalid game.');
    for (const id of [...this.sessions.keys()]) await this.stop(id);
    const tabId = sender.tab.id, tab = await this.api.tabs.get(tabId);
    if (!tab.active) throw new Error('Select the game tab before enabling auto moves.');
    const session = { id: crypto.randomUUID(), documentId: sender.documentId, gameKey, enabled: true };
    this.sessions.set(tabId, session);
    try {
      await this.api.debugger.attach({ tabId }, '1.3'); session.attached = true;
      if (this.sessions.get(tabId) !== session) { await this.api.debugger.detach({ tabId }).catch(() => {}); throw new Error('Auto moves cancelled.'); }
      return { sessionId: session.id };
    } catch (error) { await this.stop(tabId); throw error; }
  }
  async move(sender, message) {
    const tabId = sender.tab.id, session = this.sessions.get(tabId);
    if (!session?.enabled || session.id !== message.sessionId || session.documentId !== sender.documentId || session.gameKey !== message.gameKey) throw new Error('Auto session expired.');
    if (session.busy) throw new Error('A move is already in progress.');
    const fen = validFen(message.fen);
    if (!fen || !/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(message.move)) throw new Error('Invalid move request.');
    if (message.move.length === 5) throw new Error('Choose the promotion manually; auto moves paused.');
    const expected = expectedPosition(fen, message.move);
    if (session.lastFen === fen) throw new Error('This position has already been played.');
    session.busy = true;
    try {
      const settings = await this.api.storage.local.get({ enabled: true });
      const tab = await this.api.tabs.get(tabId);
      if (!settings.enabled || !tab.active) throw new Error('Auto moves paused: game tab is inactive.');
      const prepared = await this.api.tabs.sendMessage(tabId, { type: 'auto-prepare', sessionId: session.id,
        gameKey: message.gameKey, fen, move: message.move });
      if (!prepared?.ok) {
        if (prepared?.retryable) return { ok: false, retryable: true, error: prepared.error || 'Waiting for live position data…' };
        throw new Error(prepared?.error || 'Position changed before the move.');
      }
      const { from, to } = prepared;
      for (const point of [from, to]) if (!Number.isFinite(point?.x) || !Number.isFinite(point?.y) || point.x < 0 || point.y < 0 || point.x > 20000 || point.y > 20000) throw new Error('Invalid board coordinates.');
      const input = async (type, point, pressed) => {
        if (!session.enabled || this.sessions.get(tabId) !== session) throw new Error('Auto moves cancelled.');
        await this.api.debugger.sendCommand({ tabId }, 'Input.dispatchMouseEvent', {
          type, x: point.x, y: point.y, button: type === 'mouseMoved' ? 'none' : 'left', buttons: pressed ? 1 : 0, clickCount: type === 'mouseMoved' ? 0 : 1,
        });
      };
      session.lastFen = fen; session.origin = from;
      await input('mouseMoved', from, false);
      session.pressed = true; await input('mousePressed', from, true);
      await input('mouseMoved', to, true); await this.pause(90);
      await input('mouseReleased', to, false); session.pressed = false;
      const verified = await this.api.tabs.sendMessage(tabId, { type: 'auto-verify', sessionId: session.id,
        gameKey: message.gameKey, previous: fen, expected, ply: prepared.ply, move: message.move });
      if (!verified?.ok) throw new Error(verified?.error || 'The site did not confirm the move. Auto moves paused.');
      return { ok: true };
    } catch (error) {
      await this.stop(tabId, error.message); throw error;
    } finally { session.busy = false; }
  }
}
