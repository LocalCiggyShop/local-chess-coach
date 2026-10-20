import { DEFAULT_POSITION, cleanSan, resolvePosition, validFen } from './position.js';
const positionCache = new WeakMap();

export const isLichess = host => host === 'lichess.org';
export function findBoard(doc, host) {
  const selector = isLichess(host)
    ? 'main.round cg-board, .analyse__board cg-board, .study__board cg-board, .cg-wrap cg-board'
    : 'wc-chess-board, chess-board, #board-single, .board';
  return [...doc.querySelectorAll(selector)].filter(b => {
    const r = b.getBoundingClientRect(); return r.width > 160 && r.height > 160;
  }).sort((a, b) => b.getBoundingClientRect().width - a.getBoundingClientRect().width)[0] || null;
}

export function piecesToPlacement(pieces) {
  const ranks = Array.from({ length: 8 }, () => Array(8).fill(null));
  for (const { square, piece } of pieces) {
    if (!/^[a-h][1-8]$/.test(square) || !/^[prnbqkPRNBQK]$/.test(piece)) return null;
    const row = 8 - Number(square[1]), col = square.charCodeAt(0) - 97;
    if (ranks[row][col]) return null;
    ranks[row][col] = piece;
  }
  if (pieces.filter(p => p.piece === 'K').length !== 1 || pieces.filter(p => p.piece === 'k').length !== 1) return null;
  return ranks.map(rank => {
    let s = '', empty = 0;
    for (const p of rank) { if (!p) empty++; else { if (empty) s += empty; empty = 0; s += p; } }
    return s + (empty || '');
  }).join('/');
}

export function boardPlacement(board, host) {
  const pieces = [], rect = board.getBoundingClientRect();
  const flipped = !!board.closest('.orientation-black, .flipped') || board.classList.contains('flipped');
  if (isLichess(host)) {
    const roles = { pawn: 'p', knight: 'n', bishop: 'b', rook: 'r', queen: 'q', king: 'k' };
    for (const el of board.querySelectorAll('piece:not(.ghost)')) {
      if (el.classList.contains('dragging')) return null;
      const role = Object.keys(roles).find(r => el.classList.contains(r));
      if (!role || !el.matches('.white, .black')) continue;
      const r = el.getBoundingClientRect();
      const x = (r.left - rect.left) / (rect.width / 8), y = (r.top - rect.top) / (rect.height / 8);
      // Reject animation frames; a later observation will retry.
      if (Math.abs(x - Math.round(x)) > 0.12 || Math.abs(y - Math.round(y)) > 0.12) return null;
      const col = Math.round(x), row = Math.round(y);
      if (col < 0 || col > 7 || row < 0 || row > 7) return null;
      pieces.push({ square: String.fromCharCode(97 + (flipped ? 7 - col : col)) + (flipped ? row + 1 : 8 - row),
        piece: el.classList.contains('white') ? roles[role].toUpperCase() : roles[role] });
    }
  } else {
    for (const el of board.querySelectorAll('.piece')) {
      if (el.classList.contains('dragging')) return null;
      const cls = el.getAttribute('class') || '';
      const colorRole = cls.match(/(?:^|\s)([wb])([prnbqk])(?:\s|$)/), sq = cls.match(/(?:^|\s)square-([1-8])([1-8])(?:\s|$)/);
      if (colorRole && sq) pieces.push({ square: String.fromCharCode(96 + Number(sq[1])) + sq[2],
        piece: colorRole[1] === 'w' ? colorRole[2].toUpperCase() : colorRole[2] });
    }
  }
  return piecesToPlacement(pieces);
}

export function readHistory(doc, host) {
  const selector = isLichess(host)
    ? 'main.round z7yx, main.round kwdb, main.round l4x move, .analyse__moves move'
    : '.move-list .node, .move-list .move-text-component, .vertical-move-list .node, .vertical-move-list .move-text-component, [data-cy="move-list"] .node';
  let elements = [...doc.querySelectorAll(selector)];
  // Some site versions wrap the SAN node in another selected node.
  elements = elements.filter(e => !elements.some(other => other !== e && e.contains(other)));
  const moves = elements.map(el => {
    const clone = el.cloneNode(true);
    clone.querySelectorAll('draw, .annotation, .clock, .time, time, .move-time, .clock-time-component').forEach(n => n.remove());
    // Chess.com renders piece letters through CSS on empty elements. Its
    // data-figurine values are lowercase, whereas SAN piece letters are uppercase.
    // Replace every icon, including an additional promotion icon, before reading text.
    const pieceLetter = value => {
      if (typeof value !== 'string') return '';
      const role = value.trim();
      if (/^[kqrbn]$/i.test(role)) return role.toUpperCase();
      if (/^p$/i.test(role)) return '';
      return cleanSan(role);
    };
    for (const icon of clone.querySelectorAll('[data-figurine]')) {
      icon.replaceWith(pieceLetter(icon.getAttribute('data-figurine')));
    }
    let san = cleanSan(clone.textContent);
    // Some layouts put the figurine attribute on the SAN node itself.
    const prefix = pieceLetter(clone.getAttribute('data-figurine'));
    if (prefix && !san.startsWith(prefix)) san = prefix + san;
    return san;
  });
  const selected = elements.findIndex(el => el.matches('.active, .selected, .a1t') || el.querySelector('.active, .selected'));
  // Require a move-one marker before assuming the normal starting position.
  const container = elements[0]?.parentElement?.parentElement;
  const firstIndex = container?.querySelector('qzm, index, .move-number, .move-number-component');
  const startsAtOne = firstIndex ? /^1\.?$/.test(firstIndex.textContent.trim())
    : elements[0]?.getAttribute('data-ply') === '1' || (!!container && /(?:^|\s)1\./.test(container.textContent.trim()));
  return { moves, index: selected < 0 ? undefined : selected + 1, startsAtOne };
}

export function extractPosition(doc, host, board, bridge = {}) {
  if (bridge.variant && !['standard', 'chess'].includes(bridge.variant)) return { error: 'Unsupported chess variant.' };
  const placements = boardPlacement(board, host);
  if (!placements) return { error: 'Waiting for a stable board…' };
  const history = readHistory(doc, host), histories = [];
  const initial = validFen(bridge.initial);
  if (history.moves.length && (initial || history.startsAtOne)) histories.push({
    initial: initial || DEFAULT_POSITION, moves: history.moves, index: history.index,
  });
  if (initial && Array.isArray(bridge.moves)) histories.push({ initial, moves: bridge.moves });
  const liveFen = validFen(bridge.liveFen);
  if (liveFen) histories.push({ initial: liveFen, moves: [], index: 0 });
  // The initial board itself is unambiguous; no move counters are inferred midgame.
  if (placements === DEFAULT_POSITION.split(' ')[0] && !history.moves.length) histories.push({ moves: [], index: 0 });
  const fenElement = doc.querySelector('input[name="fen"], input.fen, .copyable input[readonly]');
  const input = { fen: bridge.fen || board.getAttribute('data-fen') || fenElement?.value, placements, histories };
  const snapshot = JSON.stringify(input), previous = positionCache.get(board);
  const fen = previous?.snapshot === snapshot ? previous.fen : resolvePosition(input);
  positionCache.set(board, { snapshot, fen });
  return fen ? { fen, gameId: String(bridge.gameId || doc.location?.pathname || '').slice(0, 200) }
    : { error: 'Cannot verify the full position. Waiting for FEN or complete move history.' };
}
