import { Chess } from '../vendor/chess/chess.js';
import { DEFAULT_POSITION } from '../src/position.js';
import { pieces } from './browser-fixtures.mjs';

// Deliberately let board updates outrun history/socket updates. Opponent replies
// happen in the same event handler, so verification cannot depend on seeing an
// intermediate board for one polling interval.
export function multiGameFixture(lichess, rounds = 8, { fromStart = false, nativeHistory = false, clipHistory = false } = {}) {
  const opening = fromStart ? [] : ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Nf6', 'O-O', 'Bc5', 'd3', 'O-O'];
  const chess = new Chess(), steps = [{ ply: 0, fen: DEFAULT_POSITION }];
  for (const san of opening) {
    const move = chess.move(san);
    steps.push({ ply: steps.length, fen: chess.fen(), san: move.san, uci: wireMove(move) });
  }
  const data = { game: { id: 'Long1234', variant: { key: 'standard' }, status: { id: 20, name: 'started' }, fen: chess.fen() },
    player: { id: 'mock', color: 'white' } };
  const boot = { data, steps };
  return `<!doctype html><html><head><meta charset="utf-8"><style>body{background:#252a30;color:#eee;font:16px system-ui;padding:25px}wc-chess-board,cg-board{display:block;position:relative;width:400px;height:400px;background:repeating-conic-gradient(#97ad90 0% 25%,#ecebd5 0% 50%) 0/100px 100px;font-size:40px;text-align:center;line-height:50px}</style></head><body><h1>Multi-turn ${lichess ? 'Lichess' : 'Chess.com'} regression</h1>${lichess ? `<main class="round"><div class="cg-wrap"><cg-board>${pieces(chess.fen(), true)}</cg-board></div><div class="history"><app></app></div></main>` : `<wc-chess-board>${pieces(chess.fen(), false)}</wc-chess-board><div class="move-list"><div class="line"></div></div>`}<script id="page-init-data" type="application/json">${JSON.stringify(boot)}</script><script src="/fixture-chess.js"></script><script>(${setupLongGame.toString()})(${JSON.stringify({ lichess, rounds, opening, steps, nativeHistory, clipHistory })});</script></body></html>`;
}
function wireMove(move) {
  return move.from + (move.isKingsideCastle() ? 'h' + move.from[1] : move.isQueensideCastle() ? 'a' + move.from[1] : move.to) + (move.promotion || '');
}
function setupLongGame({ lichess, rounds, opening, steps, nativeHistory, clipHistory }) {
  // Match Lichess loadEsmPage: bootstrap disappears before the content script runs.
  if (lichess) document.getElementById('page-init-data').remove();
  const chess = new window.FixtureChess(); for (const san of opening) chess.move(san);
  const board = document.querySelector('wc-chess-board,cg-board');
  const history = document.querySelector(lichess ? 'app' : '.line');
  window.fixtureMoves = []; window.fixtureSteps = steps; window.fixtureFen = chess.fen();
  if (lichess) window.fixtureSocket = new WebSocket('wss://socket.lichess.org/play/Long1234mock/v6');
  else board.game = { getFEN: () => chess.fen(), getPlayingAs: () => 1, getMode: () => ({ name: 'playing' }),
    getResult: () => '*', getPositionInfo: () => ({ gameOver: false }), getGameId: () => 'long-game' };
  if (!lichess && nativeHistory) {
    board.game.isAtEndOfLine = () => window.fixtureAtLiveEnd !== false;
    board.game.getHistoryFENs = () => steps.map(step => step.fen);
  }
  const glyphs = { p: '♟', n: '♞', b: '♝', r: '♜', q: '♛', k: '♚', P: '♙', N: '♘', B: '♗', R: '♖', Q: '♕', K: '♔' };
  const roles = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };
  function render() {
    board.innerHTML = chess.board().flat().filter(Boolean).map(p => {
      const x = p.square.charCodeAt(0) - 97, y = 8 - Number(p.square[1]), tag = lichess ? 'piece' : 'div';
      const cls = lichess ? `${p.color === 'w' ? 'white' : 'black'} ${roles[p.type]}` : `piece ${p.color}${p.type} square-${x + 1}${8 - y}`;
      return `<${tag} class="${cls}" style="position:absolute;left:${x * 50}px;top:${y * 50}px;width:50px;height:50px">${glyphs[p.color === 'w' ? p.type.toUpperCase() : p.type]}</${tag}>`;
    }).join('');
    window.fixtureFen = chess.fen();
  }
  function renderHistory() {
    const first = clipHistory && steps.length > 7 ? steps.length - 4 : 1;
    history.innerHTML = steps.slice(first).map((step, offset) => {
      const i = first + offset - 1;
      const san = lichess ? step.san : step.san.replace(/[KQRBN]/g, piece => `<span data-figurine="${piece.toLowerCase()}"></span>`);
      return `${i % 2 === 0 ? `<${lichess ? 'qzm' : 'span class="move-number"'}>${i / 2 + 1}.</${lichess ? 'qzm' : 'span'}>` : ''}<${lichess ? 'z7yx' : 'span'} class="${lichess ? '' : 'node '}${i === steps.length - 2 ? lichess ? 'a1t' : 'selected' : ''}">${san}${lichess ? '' : '<span class="clock-time-component">0:03</span>'}</${lichess ? 'z7yx' : 'span'}>`;
    }).join('');
  }
  function add(move) {
    const uci = move.from + (move.isKingsideCastle() ? 'h' + move.from[1] : move.isQueensideCastle() ? 'a' + move.from[1] : move.to) + (move.promotion || '');
    const step = { ply: steps.length, uci, san: move.san, fen: chess.fen() }; steps.push(step); return { t: 'move', d: step };
  }
  function reply() {
    const values = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
    let best = null, bestScore = -Infinity;
    for (const candidate of chess.moves({ verbose: true })) {
      chess.move(candidate);
      const material = chess.board().flat().filter(Boolean).reduce((score, p) => score + (p.color === 'b' ? 1 : -1) * values[p.type], 0);
      const responses = chess.moves({ verbose: true });
      const danger = responses.some(move => move.san.endsWith('#')) ? 10000 : Math.max(0, ...responses.map(move => values[move.captured] || 0));
      const center = 3.5 - Math.abs(candidate.to.charCodeAt(0) - 100.5);
      const score = material - danger + (['n', 'b'].includes(candidate.piece) ? 0.05 : 0) + center * 0.005;
      chess.undo();
      if (score > bestScore) { bestScore = score; best = candidate; }
    }
    return best ? chess.move(best) : null;
  }
  let origin;
  function square(event) {
    const rect = board.getBoundingClientRect(), x = Math.floor((event.clientX - rect.left) / (rect.width / 8)), y = Math.floor((event.clientY - rect.top) / (rect.height / 8));
    return x >= 0 && x < 8 && y >= 0 && y < 8 ? String.fromCharCode(97 + x) + (8 - y) : null;
  }
  board.addEventListener('mousedown', event => { if (event.isTrusted) origin = square(event); });
  document.addEventListener('mouseup', event => {
    if (!event.isTrusted || !origin || chess.turn() !== 'w' || window.fixtureMoves.length >= rounds) return;
    const from = origin, to = square(event); origin = null;
    let move; try { move = chess.move({ from, to }); } catch { return; }
    const packets = [add(move)];
    window.fixtureMoves.push({ move: move.from + move.to, trusted: true });
    if (window.fixtureMoves.length < rounds) { const answer = reply(); if (answer) packets.push(add(answer)); }
    render();
    // History lags both the board and batched socket delivery.
    setTimeout(renderHistory, 650);
    if (lichess) window.reportMultiPacket?.({ t: 'batch', d: packets });
  });
  renderHistory();
}
