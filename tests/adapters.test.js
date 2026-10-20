import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';
import { Chess } from '../vendor/chess/chess.js';
import { DEFAULT_POSITION } from '../src/position.js';
import { findBoard, extractPosition, readHistory } from '../src/adapters.js';
import { playState } from '../src/play-state.js';
import { replay } from '../src/position.js';

function fixture(host, moves = [], flipped = false) {
  const c = new Chess(); for (const move of moves) c.move(move);
  const lichess = host === 'lichess.org';
  const { document } = parseHTML(`<html><body>${lichess ? '<main class="round"><div class="cg-wrap"></div><app></app></main>' : '<wc-chess-board></wc-chess-board><div class="move-list"><div class="line"></div></div>'}</body></html>`);
  let board;
  if (lichess) { board = document.createElement('cg-board'); document.querySelector('.cg-wrap').append(board); }
  else board = document.querySelector('wc-chess-board');
  if (flipped) board.parentElement.classList.add('orientation-black');
  board.getBoundingClientRect = () => ({ left: 20, top: 40, width: 400, height: 400 });
  const roles = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };
  for (const rank of c.board()) for (const p of rank) if (p) {
    const piece = document.createElement(lichess ? 'piece' : 'div');
    piece.className = lichess ? `${p.color === 'w' ? 'white' : 'black'} ${roles[p.type]}`
      : `piece ${p.color}${p.type} square-${p.square.charCodeAt(0) - 96}${p.square[1]}`;
    const col = p.square.charCodeAt(0) - 97, row = 8 - Number(p.square[1]);
    piece.getBoundingClientRect = () => ({ left: 20 + 50 * (flipped ? 7 - col : col), top: 40 + 50 * (flipped ? 7 - row : row), width: 50, height: 50 });
    board.append(piece);
  }
  const container = document.querySelector(lichess ? 'app' : '.line');
  moves.forEach((move, i) => {
    if (i % 2 === 0) { const index = document.createElement(lichess ? 'qzm' : 'span'); index.className = 'move-number'; index.textContent = String(i / 2 + 1); container.append(index); }
    const node = document.createElement(lichess ? 'z7yx' : 'span'); node.className = lichess ? '' : 'node'; node.textContent = move;
    if (i === moves.length - 1) node.classList.add(lichess ? 'a1t' : 'selected');
    container.append(node);
  });
  return { document, board, fen: c.fen() };
}
test('Chess.com lowercase figurines keep automatic play eligible after the third ply', () => {
  const { document } = parseHTML(`<html><body><div class="move-list"><div class="line">
    <span class="move-number">1.</span><span class="node">e4</span><span class="node">e5</span>
    <span class="move-number">2.</span><span class="node selected"><span data-figurine="n"></span>f3<span class="clock-time-component">0:03</span></span>
    </div></div></body></html>`);
  assert.deepEqual(readHistory(document, 'www.chess.com').moves, ['e4', 'e5', 'Nf3']);
  const fen = replay(['e4', 'e5', 'Nf3']).at(-1);
  assert.equal(playState(document, 'www.chess.com', { isPlaying: true, playerColor: 'b' }, fen).canMove, true);
});
test('Chess.com bishop icons preserve pawn-file letters and promotion icons are normalized', () => {
  const { document } = parseHTML(`<html><body><div class="move-list"><div class="line">
    <span class="move-number">1.</span><span class="node">b4</span><span class="node">e5</span>
    <span class="move-number">2.</span><span class="node" data-figurine="b">b2</span>
    <span class="node"><span data-figurine="n"></span>c6</span>
    <span class="node">e8=<span data-figurine="q"></span>+</span>
    </div></div></body></html>`);
  assert.deepEqual(readHistory(document, 'www.chess.com').moves, ['b4', 'e5', 'Bb2', 'Nc6', 'e8=Q+']);
});
for (const host of ['www.chess.com', 'lichess.org']) {
  for (const flipped of [false, true]) test(`${host} live midgame ${flipped ? 'black' : 'white'} orientation`, () => {
    const f = fixture(host, ['e4', 'e5', 'Nf3', 'Nc6'], flipped);
    assert.equal(findBoard(f.document, host), f.board);
    assert.equal(readHistory(f.document, host).startsAtOne, true);
    assert.equal(extractPosition(f.document, host, f.board, { gameId: 'test' }).fen, f.fen);
  });
  test(`${host} FEN, new game, unsupported variant, and missing history`, () => {
    const f = fixture(host, ['e4', 'e5']);
    f.document.querySelector(host === 'lichess.org' ? 'app' : '.move-list').remove();
    assert.match(extractPosition(f.document, host, f.board).error, /Cannot verify/);
    assert.equal(extractPosition(f.document, host, f.board, { fen: f.fen, gameId: 'x' }).fen, f.fen);
    assert.match(extractPosition(f.document, host, f.board, { variant: 'crazyhouse' }).error, /Unsupported/);
    const start = fixture(host);
    assert.equal(extractPosition(start.document, host, start.board, { gameId: 'new' }).fen, DEFAULT_POSITION);
  });
}
