import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, copyFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EngineQueue } from '../src/engine.js';
import { DEFAULT_POSITION, replay } from '../src/position.js';
import { Chess } from '../vendor/chess/chess.js';

function fakeFactory(log) {
  return () => {
    let timer;
    const worker = { terminate() { clearTimeout(timer); }, postMessage(cmd) {
      log.push(cmd);
      const emit = data => queueMicrotask(() => worker.onmessage?.({ data }));
      if (cmd === 'uci') emit('uciok');
      if (cmd === 'isready') emit('readyok');
      if (cmd.startsWith('go ')) timer = setTimeout(() => emit('bestmove e2e4'), 20);
      if (cmd === 'stop') { clearTimeout(timer); emit('bestmove e2e4'); }
    } }; return worker;
  };
}
test('latest request wins, searches serialize, other tabs proceed, cache and refresh work', async () => {
  const log = [], engine = new EngineQueue(fakeFactory(log), { idleMs: 100 });
  try {
    const first = engine.analyze({ tabId: 1, id: 'first', fen: DEFAULT_POSITION });
    await new Promise(r => setTimeout(r, 5));
    const second = engine.analyze({ tabId: 1, id: 'second', fen: DEFAULT_POSITION });
    const other = engine.analyze({ tabId: 2, id: 'other', fen: DEFAULT_POSITION });
    assert.equal((await first).cancelled, true);
    assert.equal((await second).id, 'second'); assert.equal((await other).id, 'other');
    assert.equal(log.filter(l => l.startsWith('go ')).length, 2);
    await engine.analyze({ tabId: 2, id: 'refresh', fen: DEFAULT_POSITION, refresh: true });
    assert.equal(log.filter(l => l.startsWith('go ')).length, 3);
  } finally { engine.destroy(); }
});
test('failed startup restarts once, times out cleanly, then accepts new requests', async () => {
  let attempts = 0;
  const engine = new EngineQueue(() => { attempts++; return { postMessage() {}, terminate() {} }; }, { startupMs: 15, idleMs: 50 });
  try {
    const bad = await engine.analyze({ tabId: 1, id: 'bad', fen: DEFAULT_POSITION });
    assert.match(bad.error, /timed out/); assert.equal(attempts, 2);
    engine.makeWorker = fakeFactory([]);
    assert.equal((await engine.analyze({ tabId: 1, id: 'good', fen: DEFAULT_POSITION })).move, 'e2e4');
  } finally { engine.destroy(); }
});

test('actual bundled WASM completes UCI startup and returns a legal move', { timeout: 20000 }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'chess-engine-'));
  let child;
  try {
    await writeFile(join(dir, 'package.json'), '{"type":"commonjs"}');
    for (const suffix of ['js', 'wasm']) await copyFile(new URL(`../vendor/stockfish/stockfish-19-lite-single.${suffix}`, import.meta.url), join(dir, `stockfish-19-lite-single.${suffix}`));
    child = spawn(process.execPath, [join(dir, 'stockfish-19-lite-single.js')]);
    const fen = replay(['e4', 'e5', 'Nf3']).at(-1);
    const best = await new Promise((resolve, reject) => {
      let output = '', ready = false;
      child.on('error', reject);
      child.on('exit', code => { if (code) reject(new Error(`Stockfish exited ${code}`)); });
      child.stdout.on('data', chunk => {
        output += chunk;
        if (!ready && output.includes('uciok')) { ready = true; child.stdin.write(`setoption name Hash value 16\nposition fen ${fen}\ngo movetime 300\n`); }
        const match = output.match(/bestmove ([a-h][1-8][a-h][1-8][qrbn]?)/); if (match) resolve(match[1]);
      });
      child.stdin.write('uci\n');
    });
    const c = new Chess(fen);
    assert.ok(c.move({ from: best.slice(0, 2), to: best.slice(2, 4), promotion: best[4] }));
  } finally { child?.kill(); await rm(dir, { recursive: true, force: true }); }
});
