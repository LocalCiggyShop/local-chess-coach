// Runs in the page world. Read-only data bridge: no credentials, eval, or move submission.
(() => {
  const request = 'local-chess-coach:read', response = 'local-chess-coach:position';
  let cachedScripts = null, seed = null, seedPath = null;
  const liveMoves = new Map();
  const endedGames = new Set();
  function read(game, name, ...args) {
    try { return typeof game?.[name] === 'function' ? game[name](...args) : undefined; }
    catch { return undefined; }
  }
  function receive(id, message, depth = 0) {
    if (!message || typeof message !== 'object' || depth > 4) return;
    if (message.t === 'batch' && Array.isArray(message.d)) {
      for (const item of message.d.slice(0, 2000)) receive(id, item, depth + 1);
      return;
    }
    const d = message.d;
    if (message.t === 'endData' || d?.status?.id >= 25) endedGames.add(id);
    if (message.t !== 'move' || !Number.isInteger(d?.ply) || typeof d.uci !== 'string' || !/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(d.uci)) return;
    if (!liveMoves.has(id)) { if (liveMoves.size >= 4) liveMoves.delete(liveMoves.keys().next().value); liveMoves.set(id, new Map()); }
    const moves = liveMoves.get(id);
    moves.set(d.ply, { uci: d.uci, fen: typeof d.fen === 'string' && d.fen.length < 160 ? d.fen : null });
    if (moves.size > 2000) moves.delete(moves.keys().next().value);
  }
  // Observe messages already delivered to Lichess. This also handles preferences
  // that hide its move list during fast games. No extra socket or API requests.
  if (location.hostname === 'lichess.org' && window.WebSocket) {
    const NativeSocket = window.WebSocket;
    window.WebSocket = new Proxy(NativeSocket, {
      construct(Target, args) {
        const socket = new Target(...args);
        const id = String(args[0]).match(/\/(?:play|watch)\/([a-zA-Z0-9]{8})/)?.[1];
        if (id) socket.addEventListener('message', event => {
          if (typeof event.data !== 'string' || event.data.length > 1000000) return;
          try {
            receive(id, JSON.parse(event.data));
          } catch { /* Ignore non-move packets. */ }
        });
        return socket;
      },
    });
  }
  function jsonObjects(text) {
    const objects = [];
    // Site boot scripts contain JSON inside JavaScript calls. Parse JSON only, never execute it.
    for (let i = 0; i < text.length; i++) {
      if (text[i] !== '{' || !/^\{\s*"/.test(text.slice(i, i + 20))) continue;
      let depth = 0, quoted = false, escaped = false;
      for (let j = i; j < text.length; j++) {
        const c = text[j];
        if (quoted) { if (escaped) escaped = false; else if (c === '\\') escaped = true; else if (c === '"') quoted = false; }
        else if (c === '"') quoted = true;
        else if (c === '{') depth++;
        else if (c === '}' && --depth === 0) {
          try { objects.push(JSON.parse(text.slice(i, j + 1))); i = j; } catch { /* Try nested JSON next. */ }
          break;
        }
      }
    }
    return objects;
  }
  function captureSeed(text) {
    if (!text || text.length > 2000000 || !text.includes('"game"')) return;
    function walk(o, depth = 0, inheritedSteps) {
      if (!o || typeof o !== 'object' || depth > 5) return null;
      const steps = Array.isArray(o.steps) ? o.steps : inheritedSteps;
      if (o.game && o.player) return { ...o, steps: steps || [] };
      for (const v of Object.values(o)) { const found = walk(v, depth + 1, steps); if (found) return found; }
      return null;
    }
    for (const o of jsonObjects(text)) {
      const found = walk(o);
      if (!found || typeof found.game.id !== 'string') continue;
      // Retain only chess state, never the private player token or account data.
      seed = {
        game: { id: found.game.id, variant: { key: found.game.variant?.key },
          status: found.game.status, fen: found.game.fen, initialFen: found.game.initialFen },
        player: { color: found.player.color, spectator: found.player.spectator },
        steps: found.steps.slice(0, 2001).filter(s => s && typeof s === 'object')
          .map(s => ({ ply: s.ply, fen: s.fen, uci: s.uci, san: s.san })),
      };
      seedPath = location.pathname;
    }
  }
  function findSeed() {
    const scripts = [...document.scripts].filter(s => !s.src && s.textContent.length <= 2000000 &&
      s.textContent.includes('"game"')).map(s => s.textContent);
    const signature = scripts.join('\n');
    if (cachedScripts !== signature) {
      cachedScripts = signature;
      for (const text of scripts) captureSeed(text);
    }
    // Lichess rewrites /round-next URLs to the public game id after startup.
    const pathId = location.pathname.match(/^\/([a-zA-Z0-9]{8})(?:[a-zA-Z0-9]{4})?(?:\/|$)/)?.[1];
    return seedPath === location.pathname || (seed && pathId === seed.game.id) ? seed : null;
  }
  if (location.hostname === 'lichess.org') {
    // loadEsmPage removes #page-init-data before document_idle. Observe from
    // document_start, including removed nodes if creation and removal share a task.
    const captureNode = node => {
      if (node?.nodeType !== 1) return;
      if (node.tagName === 'SCRIPT') { if (!node.src) captureSeed(node.textContent); }
      else if (node.childElementCount) {
        for (const script of node.querySelectorAll('script:not([src])')) captureSeed(script.textContent);
      }
    };
    new MutationObserver(records => {
      for (const record of records) {
        if (record.type === 'characterData') captureNode(record.target.parentElement);
        else {
          if (record.target.tagName === 'SCRIPT') captureNode(record.target);
          for (const node of [...record.addedNodes, ...record.removedNodes]) captureNode(node);
        }
      }
    }).observe(document, { childList: true, subtree: true, characterData: true });
    findSeed();
  }
  window.addEventListener('message', event => {
    if (event.source !== window || event.origin !== location.origin || event.data?.type !== request ||
        typeof event.data.id !== 'string' || event.data.id.length > 80) return;
    const data = { fen: null, initial: null, liveFen: null, historyFens: [], atLiveEnd: null, moves: [], variant: null, gameId: location.pathname, playerColor: null, isPlaying: null };
    try {
      if (location.hostname.endsWith('chess.com')) {
        const board = document.querySelector('wc-chess-board, chess-board, .board');
        const game = board?.game;
        const fen = read(game, 'getFEN') || read(game, 'getFen');
        if (typeof fen === 'string') data.fen = fen;
        const color = read(game, 'getPlayingAs');
        data.playerColor = [1, '1', 'w', 'white'].includes(color) ? 'w' : [2, '2', 'b', 'black'].includes(color) ? 'b' : null;
        data.isPlaying = read(game, 'getMode')?.name === 'playing' && read(game, 'getResult') === '*' && !read(game, 'getPositionInfo')?.gameOver;
        const atEnd = read(game, 'isAtEndOfLine');
        if (typeof atEnd === 'boolean') data.atLiveEnd = atEnd;
        // Native FEN history avoids rebuilding game state from styled move text.
        // `true` requests the full line rather than stopping at the selected move.
        const fens = read(game, 'getHistoryFENs', true);
        if (Array.isArray(fens) && fens.length <= 2001 && fens.every(f => typeof f === 'string' && f.length < 160)) data.historyFens = fens;
        const gameId = read(game, 'getGameId') || read(game, 'getOptions')?.gameId || board?.getAttribute('data-game-id');
        if (typeof gameId === 'string' || typeof gameId === 'number') data.gameId = String(gameId);
      } else {
        const analysis = window.lichess?.analysis || window.site?.analysis;
        if (analysis?.node?.fen) data.fen = analysis.node.fen;
        const boot = findSeed();
        if (boot) {
          data.variant = boot.game.variant?.key || null;
          data.gameId = boot.game.id || data.gameId;
          data.playerColor = ['white', 'w'].includes(boot.player?.color) ? 'w' : ['black', 'b'].includes(boot.player?.color) ? 'b' : null;
          const status = boot.game.status, statusId = typeof status === 'number' ? status : status?.id;
          const statusName = typeof status === 'string' ? status : status?.name;
          if (boot.player?.spectator === true || endedGames.has(boot.game.id)) data.isPlaying = false;
          else if ([10, 20].includes(statusId) || ['created', 'started'].includes(statusName)) data.isPlaying = true;
          else if (Number.isFinite(statusId) || typeof statusName === 'string') data.isPlaying = false;
          data.initial = boot.steps[0]?.fen || boot.game.initialFen || null;
          if (boot.steps[0]?.ply === 0 && data.initial?.split(' ')[0] === 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR') {
            data.initial = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
          }
          data.moves = boot.steps.slice(1).map(s => s.uci || s.san).filter(Boolean).slice(0, 2000);
          const received = liveMoves.get(boot.game.id);
          let ply = boot.steps.at(-1)?.ply;
          data.liveFen = boot.steps.at(-1)?.fen || boot.game.fen || null;
          while (Number.isInteger(ply) && received?.has(ply + 1) && data.moves.length < 2000) {
            const next = received.get(++ply);
            data.moves.push(next.uci);
            if (next.fen?.trim().split(/\s+/).length === 6) data.liveFen = next.fen;
          }
        }
      }
    } catch { /* Site internals are optional; DOM history is the fallback. */ }
    window.postMessage({ type: response, id: event.data.id, data }, location.origin);
  });
})();
