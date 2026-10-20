import test from 'node:test';
import assert from 'node:assert/strict';
import { Chess } from '../vendor/chess/chess.js';
import { validFen, replay, resolvePosition, describeMove, terminal, DEFAULT_POSITION } from '../src/position.js';

test('reject partial FEN and illegal boards', () => {
  assert.equal(validFen(DEFAULT_POSITION.split(' ')[0]), null);
  assert.equal(validFen('8/8/8/8/8/8/8/8 w - - 0 1'), null);
  assert.equal(replay(['e4', 'e5', 'impossible']).length, 0);
});
test('replay preserves castling rights, en passant, and promotions', () => {
  const line = replay(['e4', 'a6', 'e5', 'd5', 'exd6']);
  assert.equal(line.length, 6);
  assert.equal(line[4].split(' ')[3], 'd6');
  const castle = replay(['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Nf6', 'O-O']);
  assert.equal(castle.at(-1).split(' ')[2], 'kq');
  const promotion = replay(['a7a8q'], '7k/P7/8/8/8/8/8/7K w - - 0 1');
  assert.equal(promotion.length, 2);
  assert.match(describeMove('7k/P7/8/8/8/8/8/7K w - - 0 1', 'a7a8q').reason, /Promotes/);
});
test('require matching board and reject ambiguous repeated positions', () => {
  const placements = DEFAULT_POSITION.split(' ')[0];
  assert.equal(resolvePosition({ fen: DEFAULT_POSITION, placements }), DEFAULT_POSITION);
  assert.equal(resolvePosition({ fen: DEFAULT_POSITION, placements: '8/8/8/8/8/8/8/8' }), null);
  const history = { moves: ['Nf3', 'Nf6', 'Ng1', 'Ng8'] };
  assert.equal(resolvePosition({ placements, histories: [history] }), null);
  const selected = resolvePosition({ placements, histories: [{ ...history, index: 4 }] });
  assert.equal(selected.split(' ')[5], '3');
});
test('terminal position and factual explanations', () => {
  assert.match(terminal('7k/6Q1/5K2/8/8/8/8/8 b - - 0 1'), /Checkmate/);
  assert.match(terminal('7k/5Q2/5K2/8/8/8/8/8 b - - 0 1'), /Stalemate/);
  assert.equal(describeMove(DEFAULT_POSITION, 'g1f3').san, 'Nf3');
  const c = new Chess(); c.move('e4'); c.move('d5');
  assert.match(describeMove(c.fen(), 'e4d5').reason, /Captures a pawn/);
});
test('Lichess king-to-rook castling replays both sides and rejects missing rights', () => {
  const opening = ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1c4', 'g8f6', 'e1h1', 'f8c5', 'd2d3', 'e8h8'];
  const standard = [...opening]; standard[6] = 'e1g1'; standard[9] = 'e8g8';
  assert.equal(replay(opening).at(-1), replay(standard).at(-1));
  assert.equal(replay(opening).length, 11);
  const start = 'r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1';
  assert.equal(replay(['e1a1', 'e8a8'], start).at(-1), replay(['O-O-O', 'O-O-O'], start).at(-1));
  assert.deepEqual(replay(['e1h1'], 'r3k2r/8/8/8/8/8/8/R3K2R w - - 0 1'), []);
});
