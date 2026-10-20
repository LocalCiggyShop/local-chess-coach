import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { DEFAULT_POSITION, replay } from '../src/position.js';

const source = readFileSync(new URL('../src/bridge.js', import.meta.url), 'utf8');
function fixture(boot, { hostname = 'lichess.org', game, lateBoot = false } = {}) {
  const listeners = new Map(), output = [];
  class Socket {
    constructor(url) { this.url = url; this.listeners = new Map(); }
    addEventListener(type, callback) { this.listeners.set(type, callback); }
    receive(data) { this.listeners.get('message')?.({ data: JSON.stringify(data) }); }
  }
  const script = { nodeType: 1, tagName: 'SCRIPT', src: '', textContent: JSON.stringify(boot) };
  const window = { WebSocket: Socket, addEventListener: (type, callback) => listeners.set(type, callback), postMessage: value => output.push(value) };
  const location = { hostname, pathname: '/AbCd1234xxxx', origin: `https://${hostname}` };
  const document = { scripts: lateBoot ? [] : [script], querySelector: () => game ? { game, getAttribute: () => null } : null };
  let notify;
  class MutationObserver { constructor(callback) { notify = callback; } observe() {} }
  vm.runInNewContext(source, { window, location, document, MutationObserver });
  return { script, location, removeBoot() {
    document.scripts = [];
    notify([{ type: 'childList', target: { tagName: 'BODY' }, addedNodes: [], removedNodes: [script] }]);
  }, updateBoot(boot) {
    script.textContent = JSON.stringify(boot);
    notify([{ type: 'characterData', target: { parentElement: script } }]);
  }, socket: new window.WebSocket('wss://socket5.lichess.org/play/AbCd1234xxxx/v6?sri=test'), read() {
    listeners.get('message')({ source: window, origin: location.origin, data: { type: 'local-chess-coach:read', id: 'read' } });
    return output.at(-1).data;
  } };
}
function data(status = { id: 20 }) {
  return { game: { id: 'AbCd1234', variant: { key: 'standard' }, status, fen: DEFAULT_POSITION }, player: { id: 'xxxx', color: 'white' } };
}
test('Lichess identity is readable even when bootstrap data and steps are separate', () => {
  const f = fixture({ data: data(), steps: [{ ply: 0, fen: DEFAULT_POSITION }] });
  assert.equal(f.read().isPlaying, true); assert.equal(f.read().playerColor, 'w');
  assert.equal(f.read().initial, DEFAULT_POSITION);
  const noSteps = fixture({ data: data() });
  assert.equal(noSteps.read().isPlaying, true); assert.equal(noSteps.read().liveFen, DEFAULT_POSITION);
});
for (const status of [{ id: 10, name: 'created' }, 20, 'started', { name: 'started' }]) test(`Lichess active status ${JSON.stringify(status)}`, () => {
  assert.equal(fixture({ data: data(status) }).read().isPlaying, true);
});
test('Lichess batches append moves once and live FEN advances after delayed packets', () => {
  const f = fixture({ data: { ...data(), steps: [{ ply: 0, fen: DEFAULT_POSITION }] } });
  const positions = replay(['e4', 'e5']);
  const packets = ['e2e4', 'e7e5'].map((uci, i) => ({ t: 'move', d: { ply: i + 1, uci, fen: positions[i + 1] } }));
  f.socket.receive({ t: 'batch', d: packets });
  f.socket.receive(packets[0]);
  assert.deepEqual(Array.from(f.read().moves), ['e2e4', 'e7e5']); assert.equal(f.read().liveFen, positions[2]);
  f.socket.receive({ t: 'batch', d: [{ t: 'endData', d: {} }] });
  assert.equal(f.read().isPlaying, false);
});
test('spectator identity remains unavailable and replaced bootstrap text is reparsed', () => {
  const f = fixture({ data: { ...data(), player: { color: 'black', spectator: true } } });
  assert.equal(f.read().isPlaying, false);
  f.script.textContent = JSON.stringify({ data: data() });
  assert.equal(f.read().isPlaying, true); assert.equal(f.read().playerColor, 'w');
});
test('Lichess retains player identity after the loader removes page-init-data before the first read', () => {
  const boot = { data: { ...data(), player: { color: 'black', id: 'PRIVATE' }, steps: [{ ply: 0, fen: DEFAULT_POSITION }] } };
  const f = fixture(boot, { lateBoot: true });
  f.removeBoot();
  assert.equal(f.read().isPlaying, true); assert.equal(f.read().playerColor, 'b');
  assert.equal(f.read().initial, DEFAULT_POSITION);
  assert.ok(!JSON.stringify(f.read()).includes('PRIVATE'));
  f.socket.receive({ t: 'move', d: { ply: 1, uci: 'e2e4' } });
  assert.deepEqual(Array.from(f.read().moves), ['e2e4']);
});
test('retained Lichess spectator and finished game data never enable automatic play', () => {
  for (const boot of [{ data: { ...data(), player: { color: 'white', spectator: true } } }, { data: data({ id: 30, name: 'mate' }) }]) {
    const f = fixture(boot, { lateBoot: true }); f.removeBoot();
    assert.equal(f.read().isPlaying, false);
  }
});
test('Lichess captures script text updates and does not reuse identity on another game route', () => {
  const f = fixture({}, { lateBoot: true });
  f.updateBoot({ data: data() }); f.removeBoot();
  assert.equal(f.read().isPlaying, true);
  f.location.pathname = '/Other123mock';
  assert.equal(f.read().playerColor, null); assert.equal(f.read().isPlaying, null);
  f.updateBoot({ data: { ...data(), game: { ...data().game, id: 'Other123' }, player: { color: 'black' } } });
  assert.equal(f.read().playerColor, 'b'); assert.equal(f.read().gameId, 'Other123');
});
test('Chess.com publishes its native full FEN history and live cursor without DOM text', () => {
  const positions = replay(['e4', 'e5', 'Nf3']); let full;
  const game = { getFEN: () => positions.at(-1), getPlayingAs: () => 2, getMode: () => ({ name: 'playing' }),
    getResult: () => '*', getPositionInfo: () => ({ gameOver: false }), isAtEndOfLine: () => true,
    getHistoryFENs: value => { full = value; return positions; } };
  const result = fixture({}, { hostname: 'www.chess.com', game }).read();
  assert.equal(result.fen, positions.at(-1)); assert.equal(result.atLiveEnd, true);
  assert.deepEqual(Array.from(result.historyFens), positions); assert.equal(full, true);
});
test('an unavailable native Chess.com history getter does not discard position or player fields', () => {
  const game = { getFEN: () => DEFAULT_POSITION, getPlayingAs: () => 1,
    getMode: () => ({ name: 'playing' }), getResult: () => '*',
    getHistoryFENs: () => { throw new Error('not supported'); } };
  const result = fixture({}, { hostname: 'www.chess.com', game }).read();
  assert.equal(result.fen, DEFAULT_POSITION); assert.equal(result.playerColor, 'w'); assert.equal(result.isPlaying, true);
  assert.equal(result.atLiveEnd, null); assert.deepEqual(Array.from(result.historyFens), []);
});
