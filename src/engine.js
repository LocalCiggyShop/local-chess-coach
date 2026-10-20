// One worker, one active UCI search, with latest-only pending work per tab.
export class EngineQueue {
  constructor(makeWorker, { startupMs = 15000, searchMs = 5000, idleMs = 30000 } = {}) {
    this.makeWorker = makeWorker;
    this.startupMs = startupMs; this.searchMs = searchMs; this.idleMs = idleMs;
    this.pending = new Map(); this.active = null; this.worker = null; this.starting = null;
    this.cache = new Map(); this.busy = false; this.waiters = new Set();
  }
  waitFor(test, timeout) {
    return new Promise((resolve, reject) => {
      const waiter = { test, resolve: value => { clearTimeout(waiter.timer); this.waiters.delete(waiter); resolve(value); },
        reject: err => { clearTimeout(waiter.timer); this.waiters.delete(waiter); reject(err); } };
      waiter.timer = setTimeout(() => waiter.reject(new Error('Stockfish timed out. Refresh to retry.')), timeout);
      this.waiters.add(waiter);
    });
  }
  async start() {
    if (this.worker && !this.starting) return;
    if (this.starting) return this.starting;
    this.starting = (async () => {
      this.worker = this.makeWorker();
      this.worker.onmessage = event => {
        for (const line of String(event.data).split('\n')) {
          if (this.active && line.startsWith('info ') && /\bpv\b/.test(line)) this.active.info = line;
          for (const w of [...this.waiters]) if (w.test(line)) w.resolve(line);
        }
      };
      this.worker.onerror = () => this.destroy(new Error('Stockfish worker failed. Refresh to retry.'));
      let waiting = this.waitFor(line => line === 'uciok', this.startupMs);
      this.worker.postMessage('uci'); await waiting;
      this.worker.postMessage('setoption name Hash value 16');
      this.worker.postMessage('setoption name MultiPV value 1');
      waiting = this.waitFor(line => line === 'readyok', this.startupMs);
      this.worker.postMessage('isready'); await waiting;
    })();
    try { await this.starting; } finally { this.starting = null; }
  }
  analyze(request) {
    clearTimeout(this.idleTimer);
    this.cancel(request.tabId);
    return new Promise(resolve => {
      this.pending.set(request.tabId, { request, resolve });
      this.pump();
    });
  }
  cancel(tabId) {
    const old = this.pending.get(tabId);
    if (old) { old.resolve({ cancelled: true }); this.pending.delete(tabId); }
    if (this.active?.request.tabId === tabId) {
      this.active.cancelled = true;
      if (this.active.searching) this.worker?.postMessage('stop');
    }
  }
  async pump() {
    if (this.busy) return;
    this.busy = true;
    try {
      while (this.pending.size) {
        const [key, task] = this.pending.entries().next().value;
        this.pending.delete(key); this.active = task;
        try {
          const { request } = task;
          const cached = !request.refresh && this.cache.get(request.fen);
          if (cached) { task.resolve({ ...cached, id: request.id }); continue; }
          // At most one automatic restart for a failed initialization.
          try { await this.start(); } catch {
            this.destroy(new Error('Restarting Stockfish.'));
            if (!task.cancelled) await this.start();
          }
          if (task.cancelled) { task.resolve({ cancelled: true }); continue; }
          this.worker.postMessage('ucinewgame');
          this.worker.postMessage(`position fen ${request.fen}`);
          const waiting = this.waitFor(line => line.startsWith('bestmove '), this.searchMs);
          task.searching = true;
          this.worker.postMessage('go movetime 300');
          const best = await waiting;
          task.searching = false;
          if (task.cancelled) { task.resolve({ cancelled: true }); continue; }
          const result = { id: request.id, fen: request.fen, move: best.split(/\s+/)[1],
            score: task.info?.match(/\bscore (cp|mate) (-?\d+)/)?.slice(1) || null,
            pv: task.info?.split(' pv ')[1]?.split(' ').slice(0, 12) || [] };
          this.cache.set(request.fen, result);
          if (this.cache.size > 32) this.cache.delete(this.cache.keys().next().value);
          task.resolve(result);
        } catch (error) {
          this.destroy(error);
          task.resolve({ error: error.message });
        } finally { this.active = null; }
      }
    } finally {
      this.busy = false;
      this.idleTimer = setTimeout(() => this.destroy(), this.idleMs);
    }
  }
  destroy(error = new Error('Engine stopped.')) {
    this.worker?.terminate(); this.worker = null;
    for (const waiter of [...this.waiters]) waiter.reject(error);
    clearTimeout(this.idleTimer);
  }
}
