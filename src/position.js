import { Chess, DEFAULT_POSITION } from '../vendor/chess/chess.js';

export { DEFAULT_POSITION };
export function validFen(fen) {
  if (typeof fen !== 'string' || fen.length > 150 || fen.trim().split(/\s+/).length !== 6) return null;
  try { const c = new Chess(fen); return c.fen(); } catch { return null; }
}

export function cleanSan(text) {
  return String(text).replace(/[♔♚]/g, 'K').replace(/[♕♛]/g, 'Q').replace(/[♖♜]/g, 'R')
    .replace(/[♗♝]/g, 'B').replace(/[♘♞]/g, 'N').replace(/[♙♟]/g, '')
    .replace(/\d+\.(\.\.)?/g, '').replace(/[!?]/g, '').replace(/½\?/g, '').trim();
}

// Lichess uses king-to-rook UCI for castling; Stockfish/chess.js use king-to-destination.
// Convert only a king targeting its own corner rook. Legality is still checked by chess.js.
export function applyUci(chess, uci) {
  if (!/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(uci)) throw new Error('Invalid UCI move.');
  const from = uci.slice(0, 2); let to = uci.slice(2, 4);
  const piece = chess.get(from), target = chess.get(to);
  if (piece?.type === 'k' && target?.type === 'r' && piece.color === target.color &&
      /^e[18]$/.test(from) && from[1] === to[1] && /^[ah][18]$/.test(to)) to = (to[0] === 'h' ? 'g' : 'c') + from[1];
  return chess.move({ from, to, promotion: uci[4] });
}

export function positionKey(fen) {
  return validFen(fen)?.split(' ').slice(0, 4).join(' ') || null;
}

export function samePosition(a, b) {
  const key = positionKey(a); return !!key && key === positionKey(b);
}

export function fenPly(fen) {
  const valid = validFen(fen);
  if (!valid) return null;
  const fields = valid.split(' ');
  return (Number(fields[5]) - 1) * 2 + (fields[1] === 'b' ? 1 : 0);
}

export function replay(moves, initial = DEFAULT_POSITION) {
  if (!validFen(initial) || !Array.isArray(moves) || moves.length > 2000) return [];
  const c = new Chess(initial), positions = [c.fen()];
  try {
    for (const raw of moves) {
      const move = cleanSan(raw);
      if (/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(move)) {
        applyUci(c, move);
      } else c.move(move);
      positions.push(c.fen());
    }
    return positions;
  } catch { return []; }
}

// A partial FEN never becomes an engine input. Only verified, complete positions qualify.
export function resolvePosition({ fen, placements, histories = [] }) {
  if (!placements) return null;
  const direct = validFen(fen);
  if (direct && direct.split(' ')[0] === placements) return direct;
  const candidates = new Set();
  for (const history of histories) {
    const positions = replay(history.moves, history.initial || DEFAULT_POSITION);
    const selected = Number.isInteger(history.index) ? [positions[history.index]] : positions;
    for (const p of selected) if (p && p.split(' ')[0] === placements) {
      if (Number.isInteger(history.index)) return p;
      candidates.add(p);
    }
  }
  // Repeated positions may have different rights/turns. Do not guess which was displayed.
  return candidates.size === 1 ? [...candidates][0] : null;
}

export function describeMove(fen, uci) {
  const c = new Chess(fen);
  const move = c.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
  let reason = 'Stockfish prefers this continuation within the short search.';
  if (c.isCheckmate()) reason = 'Delivers checkmate.';
  else if (move.promotion) reason = `Promotes the pawn to a ${names[move.promotion]}.`;
  else if (move.captured) reason = `Captures a ${names[move.captured]}${c.isCheck() ? ' with check' : ''}.`;
  else if (c.isCheck()) reason = 'Checks the king, forcing a response.';
  else if (move.isKingsideCastle() || move.isQueensideCastle()) reason = 'Castles to move the king and activate the rook.';
  return { san: move.san, reason };
}
const names = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };

export function terminal(fen) {
  const c = new Chess(fen);
  if (c.isCheckmate()) return 'Checkmate — no legal move.';
  if (c.isStalemate()) return 'Stalemate — no legal move.';
  if (c.isInsufficientMaterial()) return 'Draw — insufficient material.';
  if (c.isDrawByFiftyMoves()) return 'Draw position — fifty-move rule.';
  return null;
}
