import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';
import { Automation } from '../src/automation.js';
import { squareCenter } from '../src/board-ui.js';
import { playState, expectedPosition, confirmsTransition } from '../src/play-state.js';
import { DEFAULT_POSITION, replay } from '../src/position.js';

test('board coordinates follow both orientations, offsets, and non-square dimensions', () => {
  const rect = { left: 20, top: 40, width: 400, height: 320 };
  assert.deepEqual(squareCenter('a1', rect), { x: 45, y: 340 });
  assert.deepEqual(squareCenter('a1', rect, true), { x: 395, y: 60 });
  assert.deepEqual(squareCenter('h8', rect, true), { x: 45, y: 340 });
  assert.throws(() => squareCenter('a9', rect));
});
test('auto eligibility requires a known player, live position, and the player’s turn', () => {
  const { document } = parseHTML('<html><body></body></html>');
  const bridge = { isPlaying: true, playerColor: 'w', initial: DEFAULT_POSITION, moves: [] };
  assert.equal(playState(document, 'lichess.org', bridge, DEFAULT_POSITION).canMove, true);
  const after = replay(['e4']).at(-1);
  const blackTurn = playState(document, 'lichess.org', { ...bridge, moves: ['e2e4'] }, after);
  assert.equal(blackTurn.available, true); assert.equal(blackTurn.canMove, false);
  assert.equal(playState(document, 'lichess.org', { ...bridge, moves: ['e2e4'] }, DEFAULT_POSITION).available, false);
  assert.equal(playState(document, 'lichess.org', { ...bridge, playerColor: null }, DEFAULT_POSITION).available, false);
  assert.equal(playState(document, 'lichess.org', { ...bridge, isPlaying: false }, DEFAULT_POSITION).available, false);
  assert.throws(() => expectedPosition(DEFAULT_POSITION, 'e2e5'));
});

function harness(pause) {
  const commands = [], messages = [];
  const state = { active: true, enabled: true, prepare: true, verify: true };
  const api = {
    debugger: {
      attach: async target => commands.push({ type: 'attach', ...target }),
      detach: async target => commands.push({ type: 'detach', ...target }),
      sendCommand: async (_target, method, params) => commands.push({ method, ...params }),
    },
    storage: { local: { get: async () => ({ enabled: state.enabled }) } },
    tabs: { get: async () => ({ active: state.active }), sendMessage: async (_tab, message) => {
      messages.push(message);
      if (message.type === 'auto-prepare') return state.prepare ? { ok: true, from: { x: 50, y: 100 }, to: { x: 50, y: 200 } } : { ok: false, error: 'Stale position.' };
      if (message.type === 'auto-verify') return { ok: state.verify };
    } },
  };
  const automation = new Automation(api, pause || (async () => {}));
  const sender = { tab: { id: 1 }, documentId: 'document-a' };
  return { automation, sender, commands, messages, state };
}
async function arm(h) { return { ...(await h.automation.arm(h.sender, 'game-a')), gameKey: 'game-a', fen: DEFAULT_POSITION, move: 'e2e4' }; }

test('auto executes once per position and verifies the result', async () => {
  const h = harness(), request = await arm(h);
  assert.deepEqual(await h.automation.move(h.sender, request), { ok: true });
  const input = h.commands.filter(c => c.method === 'Input.dispatchMouseEvent');
  assert.deepEqual(input.map(c => c.type), ['mouseMoved', 'mousePressed', 'mouseMoved', 'mouseReleased']);
  assert.equal(h.messages.find(m => m.type === 'auto-verify').expected, expectedPosition(DEFAULT_POSITION, 'e2e4'));
  await assert.rejects(h.automation.move(h.sender, request), /already been played/);
  await h.automation.stop(1);
});
test('stale document, wrong game, promotions, and illegal moves never dispatch input', async () => {
  const h = harness(), request = await arm(h);
  await assert.rejects(h.automation.move({ ...h.sender, documentId: 'new-document' }, request), /expired/);
  await assert.rejects(h.automation.move(h.sender, { ...request, gameKey: 'other' }), /expired/);
  await assert.rejects(h.automation.move(h.sender, { ...request, move: 'a7a8q' }), /promotion/);
  await assert.rejects(h.automation.move(h.sender, { ...request, move: 'e2e5' }));
  assert.equal(h.commands.some(c => c.method), false); await h.automation.stop(1);
});
for (const flag of ['active', 'enabled', 'prepare', 'verify']) test(`auto stops and detaches when ${flag} check fails`, async () => {
  const h = harness(), request = await arm(h); h.state[flag] = false;
  await assert.rejects(h.automation.move(h.sender, request));
  assert.equal(h.automation.sessions.size, 0);
  assert.ok(h.commands.some(c => c.type === 'detach'));
  if (flag !== 'verify') assert.equal(h.commands.some(c => c.method), false);
});
test('turning off during a drag releases at the origin and prevents destination release', async () => {
  let resume, reached;
  const paused = new Promise(resolve => { reached = resolve; });
  const h = harness(() => { reached(); return new Promise(resolve => { resume = resolve; }); });
  const request = await arm(h), moving = h.automation.move(h.sender, request);
  await paused; await h.automation.stop(1); resume(); await assert.rejects(moving, /cancelled/);
  const releases = h.commands.filter(c => c.type === 'mouseReleased');
  assert.equal(releases.length, 1); assert.equal(releases[0].y, 100);
});
test('brief history lag pauses eligibility without marking the game as historical', () => {
  const { document } = parseHTML('<html><body></body></html>');
  const result = playState(document, 'lichess.org', { isPlaying: true, playerColor: 'w', initial: DEFAULT_POSITION, moves: [] }, replay(['e4']).at(-1));
  assert.equal(result.canMove, false); assert.equal(result.transient, true);
});
test('fresh DOM history recovers a delayed Lichess socket and ignores irrelevant FEN counters', () => {
  const { document } = parseHTML('<html><body><main class="round"><app><qzm>1</qzm><z7yx>e4</z7yx><z7yx class="a1t">e5</z7yx></app></main></body></html>');
  const fen = replay(['e4', 'e5']).at(-1).replace(/0 2$/, '4 2');
  const bridge = { isPlaying: true, playerColor: 'w', initial: DEFAULT_POSITION, moves: [] };
  assert.equal(playState(document, 'lichess.org', bridge, fen).canMove, true);
  document.querySelector('z7yx').classList.add('a1t'); document.querySelectorAll('z7yx')[1].classList.remove('a1t');
  const old = playState(document, 'lichess.org', bridge, replay(['e4']).at(-1));
  assert.equal(old.available, false); assert.equal(old.transient, false);
});
test('castled Lichess games remain eligible and rapid replies still confirm our move', () => {
  const { document } = parseHTML('<html><body></body></html>');
  const moves = ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Nf6', 'e1h1', 'Bc5'];
  const bridge = { isPlaying: true, playerColor: 'w', initial: DEFAULT_POSITION, moves };
  const fen = replay(moves).at(-1);
  assert.equal(playState(document, 'lichess.org', bridge, fen).canMove, true);
  const next = { ...bridge, moves: [...moves, 'd3', 'e8h8'] };
  const proof = { previous: fen, expected: expectedPosition(fen, 'd2d3'), ply: 8 };
  assert.equal(confirmsTransition(document, 'lichess.org', next, proof), true);
  assert.equal(confirmsTransition(document, 'lichess.org', bridge, proof), false);
  assert.equal(confirmsTransition(document, 'lichess.org', next, { ...proof, ply: 6 }), false);
});
test('retryable preparation keeps the session armed and sends no input before a fresh attempt', async () => {
  const h = harness(), request = await arm(h);
  const original = h.automation.api.tabs.sendMessage;
  h.automation.api.tabs.sendMessage = async (tab, message) => message.type === 'auto-prepare'
    ? { ok: false, retryable: true, error: 'Waiting for live data.' } : original(tab, message);
  assert.equal((await h.automation.move(h.sender, request)).retryable, true);
  assert.equal(h.automation.sessions.size, 1);
  assert.equal(h.commands.some(c => c.method), false);
  h.automation.api.tabs.sendMessage = original;
  assert.equal((await h.automation.move(h.sender, request)).ok, true);
  await h.automation.stop(1);
});
test('history navigation remains blocked when an older position later repeats', () => {
  const { document } = parseHTML('<html><body><main class="round"><app><qzm>1</qzm><z7yx class="a1t">Nf3</z7yx><z7yx>Nf6</z7yx><qzm>2</qzm><z7yx>Ng1</z7yx><z7yx>Ng8</z7yx><qzm>3</qzm><z7yx>Nf3</z7yx></app></main></body></html>');
  const moves = ['Nf3', 'Nf6', 'Ng1', 'Ng8', 'Nf3'];
  const bridge = { isPlaying: true, playerColor: 'w', initial: DEFAULT_POSITION, moves };
  const earlier = playState(document, 'lichess.org', bridge, replay(moves)[1]);
  assert.equal(earlier.available, false); assert.equal(earlier.transient, false);
});
test('native Chess.com cursor verification survives hidden or virtualized move lists', () => {
  const { document } = parseHTML('<html><body><div class="move-list"><div class="line"><span class="move-number">4.</span><span class="node selected">broken UI text</span></div></div></body></html>');
  const positions = replay(['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Nf6']);
  const fen = positions.at(-1), bridge = { isPlaying: true, playerColor: 'w', atLiveEnd: true, fen, historyFens: positions };
  assert.equal(playState(document, 'www.chess.com', bridge, fen).canMove, true);
  assert.equal(playState(document, 'www.chess.com', { ...bridge, atLiveEnd: false }, fen).available, false);
  assert.equal(playState(document, 'www.chess.com', bridge, positions.at(-2)).canMove, false);
  assert.equal(playState(document, 'www.chess.com', { ...bridge, playerColor: 'b' }, fen).canMove, false);
});
test('native Chess.com FEN history confirms a fast reply even when it excludes the initial FEN', () => {
  const { document } = parseHTML('<html><body></body></html>');
  const positions = replay(['e4', 'e5']);
  const proof = { previous: DEFAULT_POSITION, expected: positions[1], ply: 0 };
  assert.equal(confirmsTransition(document, 'www.chess.com', { historyFens: positions }, proof), true);
  assert.equal(confirmsTransition(document, 'www.chess.com', { historyFens: positions.slice(1) }, proof), true);
  assert.equal(confirmsTransition(document, 'www.chess.com', { historyFens: positions.slice(2) }, proof), false);
  assert.equal(confirmsTransition(document, 'www.chess.com', { historyFens: [positions[0], positions[2]] }, proof), false);
});
