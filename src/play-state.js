import { Chess } from '../vendor/chess/chess.js';
import { DEFAULT_POSITION, replay, validFen, samePosition, fenPly } from './position.js';
import { readHistory } from './adapters.js';

export function positionTimelines(doc, host, bridge) {
  const history = readHistory(doc, host), timelines = [];
  function add(moves, initial, selected, source) {
    const positions = replay(moves, initial);
    if (!positions.length) return;
    const startPly = fenPly(positions[0]);
    timelines.push({ positions, startPly, tipPly: startPly + positions.length - 1, selected, source });
  }
  if (host === 'lichess.org' && validFen(bridge.initial)) add(bridge.moves, bridge.initial, undefined, 'bridge');
  if (history.startsAtOne || (host === 'lichess.org' && validFen(bridge.initial) && history.moves.length)) {
    add(history.moves, history.startsAtOne ? DEFAULT_POSITION : bridge.initial, history.index, 'history');
  }
  if (host !== 'lichess.org' && Array.isArray(bridge.historyFens) && bridge.historyFens.length && bridge.historyFens.length <= 2001) {
    const positions = bridge.historyFens.map(validFen);
    const startPly = fenPly(positions[0]);
    if (positions.every((fen, i) => fen && fenPly(fen) === startPly + i)) {
      timelines.push({ positions, startPly, tipPly: startPly + positions.length - 1, source: 'native' });
    }
  }
  const liveFen = validFen(bridge.liveFen);
  if (liveFen) timelines.push({ positions: [liveFen], startPly: fenPly(liveFen), tipPly: fenPly(liveFen), source: 'live' });
  return { history, timelines };
}

export function playState(doc, host, bridge, fen) {
  if (bridge.isPlaying === false) {
    return { available: false, canMove: false, transient: false, reason: 'Auto moves require an ongoing player game.' };
  }
  if (bridge.isPlaying !== true || !['w', 'b'].includes(bridge.playerColor)) {
    return { available: false, canMove: false, transient: true, reason: 'Waiting for player game information…' };
  }
  // Chess.com's own cursor state follows history navigation and remains usable
  // when the move list uses icons, is hidden, or virtualizes older rows.
  if (host !== 'lichess.org' && typeof bridge.atLiveEnd === 'boolean') {
    if (!bridge.atLiveEnd) return { available: false, canMove: false, transient: false,
      reason: 'Viewing an earlier move. Return to the latest position.' };
    if (samePosition(bridge.fen, fen)) {
      const canMove = fen.split(' ')[1] === bridge.playerColor;
      return { available: true, canMove, transient: false, livePly: fenPly(bridge.fen),
        reason: canMove ? 'Ready on your turn.' : 'Waiting for your turn.' };
    }
    return { available: false, canMove: false, transient: true, reason: 'Waiting for the board position to settle…' };
  }
  const { history, timelines } = positionTimelines(doc, host, bridge);
  const newestPly = timelines.length ? Math.max(...timelines.map(t => t.tipPly)) : -1;
  const newest = timelines.filter(t => t.tipPly === newestPly);
  const browsing = timelines.some(t => t.source === 'history' && Number.isInteger(t.selected) &&
    t.selected < t.positions.length - 1 && samePosition(t.positions[t.selected], fen) &&
    (!samePosition(t.positions.at(-1), fen) || validFen(t.positions[t.selected]) === validFen(fen)));
  if (browsing) return { available: false, canMove: false, transient: false,
    reason: 'Viewing an earlier move. Return to the latest position.' };
  const verified = newest.some(t => samePosition(t.positions.at(-1), fen)) ||
    (!timelines.length && !history.moves.length && fen === DEFAULT_POSITION);
  if (!verified) {
    return { available: false, canMove: false, transient: true,
      reason: 'Waiting for live move data to catch up…' };
  }
  const canMove = fen.split(' ')[1] === bridge.playerColor;
  return { available: true, canMove, transient: false, livePly: newestPly >= 0 ? newestPly : fenPly(fen),
    reason: canMove ? 'Ready on your turn.' : 'Waiting for your turn.' };
}

// A quick opponent reply can replace the expected board before the next poll.
// Confirm the exact transition at the captured ply instead of requiring it to remain on screen.
export function confirmsTransition(doc, host, bridge, { previous, expected, ply }) {
  if (!Number.isInteger(ply) || ply < 0) return false;
  return positionTimelines(doc, host, bridge).timelines.some(timeline => {
    const index = ply - timeline.startPly;
    const previousMatches = index >= 0 ? samePosition(timeline.positions[index], previous)
      : timeline.source === 'native' && index === -1 && fenPly(previous) === ply;
    return previousMatches &&
      samePosition(timeline.positions[index + 1], expected);
  });
}

export function expectedPosition(fen, uci) {
  const c = new Chess(fen);
  c.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
  return c.fen();
}
