(() => {
  if (globalThis.__localChessCoach) return;
  globalThis.__localChessCoach = true;
  Promise.all(['position', 'adapters', 'panel', 'board-ui', 'play-state'].map(name => import(chrome.runtime.getURL(`src/${name}.js`))))
    .then(async ([position, adapters, ui, boardUI, play]) => {
      let settings = await chrome.storage.local.get({ enabled: true, panelVisible: true, collapsed: false, boardMoves: true });
      let panel, current = '', sequence = 0, timer, running = false, state = 'Looking for a game board.', stopped = false;
      const overlay = boardUI.createBoardOverlay();
      overlay.setEnabled(settings.boardMoves !== false);
      let gameKey = '', latestFen = '', recommendation = null, autoSession = null, autoArming = false, autoExecuting = false, autoReason = '', autoGeneration = 0;
      let eligibility = { available: false, canMove: false, reason: 'Reading player game…' };
      const pending = new Map();
      function updateAuto() {
        panel?.automation({ enabled: !!autoSession, available: eligibility.available, busy: autoArming,
          reason: autoArming ? 'Enabling browser input…' : autoReason || (autoSession ? eligibility.reason : eligibility.available ? 'Auto moves start off for each game.' : eligibility.reason) });
      }
      function stopAuto(reason = 'Auto moves off.') {
        autoGeneration++; autoSession = null; autoReason = reason; updateAuto();
        try { chrome.runtime.sendMessage({ target: 'background', type: 'auto-disable', reason }).catch(() => {}); } catch {}
      }
      async function toggleAuto() {
        if (autoSession) { stopAuto(); return; }
        if (autoArming || !eligibility.available || !gameKey || document.hidden || !document.hasFocus()) return;
        autoArming = true; autoReason = ''; updateAuto();
        const armedGame = gameKey, generation = ++autoGeneration;
        try {
          const result = await chrome.runtime.sendMessage({ target: 'background', type: 'auto-enable', gameKey });
          if (result?.error || !result?.sessionId) throw new Error(result?.error || 'Could not enable browser input.');
          if (generation !== autoGeneration || gameKey !== armedGame || document.hidden || !settings.enabled) { stopAuto('Auto moves reset.'); return; }
          autoSession = result.sessionId; autoReason = '';
        } catch (error) { autoReason = error.message; }
        finally { autoArming = false; updateAuto(); }
        maybeAuto();
      }
      async function maybeAuto() {
        if (!autoSession || autoExecuting || !eligibility.canMove || !recommendation || document.hidden || !document.hasFocus() || !settings.enabled) return;
        const suggestion = recommendation, session = autoSession;
        if (suggestion.move.length === 5) { stopAuto('Choose the promotion manually; auto moves paused.'); return; }
        autoExecuting = true; autoReason = 'Playing the suggested move…'; updateAuto();
        try {
          const result = await chrome.runtime.sendMessage({ target: 'background', type: 'auto-move',
            sessionId: session, gameKey, fen: suggestion.fen, move: suggestion.move });
          if (result?.retryable) {
            if (autoSession === session) autoReason = result.error || 'Waiting for live move data…';
            return;
          }
          if (!result?.ok) throw new Error(result?.error || 'The site did not confirm the move.');
          if (autoSession === session) autoReason = '';
        } catch (error) { if (autoSession === session) stopAuto(error.message); }
        finally { autoExecuting = false; updateAuto(); schedule(); }
      }
      function status(text) { state = text; panel?.status(text); }
      function cancel() {
        sequence++; current = ''; recommendation = null; overlay.clear();
        try { chrome.runtime.sendMessage({ target: 'background', type: 'cancel' }).catch(() => {}); } catch { /* Extension may have reloaded. */ }
      }
      function readBridge() {
        return new Promise(resolve => {
          const id = crypto.randomUUID();
          const timeout = setTimeout(() => { pending.delete(id); resolve({}); }, 350);
          pending.set(id, data => { clearTimeout(timeout); resolve(data); });
          window.postMessage({ type: 'local-chess-coach:read', id }, location.origin);
        });
      }
      async function suggest(result, key, refresh) {
        const ticket = sequence, id = `${ticket}:${crypto.randomUUID()}`;
        try {
          const answer = await chrome.runtime.sendMessage({ target: 'background', type: 'analyze', id, fen: result.fen, refresh });
          if (ticket !== sequence || stopped || document.hidden || !settings.enabled || current !== key) return;
          const board = adapters.findBoard(document, location.hostname);
          if (!board || adapters.boardPlacement(board, location.hostname) !== result.fen.split(' ')[0] || !key.startsWith(`${location.pathname}|`)) {
            cancel(); status('Position changed. Reading board…'); schedule(); return;
          }
          if (answer?.cancelled) { status('Analysis cancelled. Refresh to retry.'); return; }
          if (answer?.error) throw new Error(answer.error);
          if (answer?.id !== id || answer?.fen !== result.fen) throw new Error('Position changed. Refresh to retry.');
          if (!/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(answer.move)) { status('No legal next move.'); return; }
          const explanation = position.describeMove(result.fen, answer.move);
          state = `${explanation.san} — ${explanation.reason}`;
          panel.result(explanation, answer.score, result.fen.split(' ')[1]);
          recommendation = { fen: result.fen, move: answer.move, key };
          overlay.show(board, answer.move); maybeAuto();
        } catch (error) {
          if (ticket !== sequence || stopped) return;
          if (/Extension context invalidated/i.test(error.message)) {
            stopped = true; panel?.status('Extension reloaded. Reload this page.');
          } else status(error.message || 'Analysis failed. Refresh to retry.');
        }
      }
      window.addEventListener('message', event => {
        const msg = event.data;
        if (event.source !== window || event.origin !== location.origin || msg?.type !== 'local-chess-coach:position' || !pending.has(msg.id)) return;
        const raw = msg.data;
        const data = raw && typeof raw === 'object' ? {
          fen: typeof raw.fen === 'string' && raw.fen.length < 160 ? raw.fen : null,
          initial: typeof raw.initial === 'string' && raw.initial.length < 160 ? raw.initial : null,
          liveFen: typeof raw.liveFen === 'string' && raw.liveFen.length < 160 ? raw.liveFen : null,
          atLiveEnd: typeof raw.atLiveEnd === 'boolean' ? raw.atLiveEnd : null,
          historyFens: Array.isArray(raw.historyFens) && raw.historyFens.length <= 2001 && raw.historyFens.every(f => typeof f === 'string' && f.length < 160) ? raw.historyFens : [],
          gameId: typeof raw.gameId === 'string' ? raw.gameId.slice(0, 200) : null,
          variant: typeof raw.variant === 'string' ? raw.variant.slice(0, 40) : null,
          playerColor: ['w', 'b'].includes(raw.playerColor) ? raw.playerColor : null,
          isPlaying: typeof raw.isPlaying === 'boolean' ? raw.isPlaying : null,
          moves: Array.isArray(raw.moves) ? raw.moves.slice(0, 2000).filter(m => typeof m === 'string' && m.length < 30) : [],
        } : {};
        const resolve = pending.get(msg.id); pending.delete(msg.id); resolve(data);
      });
      async function scan(refresh = false) {
        if (running || stopped) return;
        if (!settings.enabled || document.hidden) { if (current) cancel(); panel?.visible(false); return; }
        const board = adapters.findBoard(document, location.hostname);
        if (!board) { if (current) cancel(); if (autoSession) stopAuto('Auto moves paused: board unavailable.'); panel?.visible(false); state = 'No supported game board detected.'; return; }
        if (!panel) {
          panel = ui.createPanel(() => scan(true), patch => chrome.storage.local.set(patch), {
            onBoardMoves: () => {
              settings.boardMoves = settings.boardMoves === false; overlay.setEnabled(settings.boardMoves);
              panel.configure(settings); chrome.storage.local.set({ boardMoves: settings.boardMoves });
            }, onAutoMoves: toggleAuto,
          });
          panel.configure(settings);
        }
        panel.visible(settings.panelVisible !== false);
        running = true;
        try {
          const bridge = await readBridge();
          if (!board.isConnected || !settings.enabled || document.hidden) return;
          const result = adapters.extractPosition(document, location.hostname, board, bridge);
          if (!result.fen) {
            if (current) cancel();
            eligibility = { available: false, canMove: false, transient: true, reason: 'Waiting for a stable, verified board…' };
            updateAuto(); status(result.error); return;
          }
          const nextGame = `${location.pathname}|${result.gameId}`;
          if (nextGame !== gameKey || (result.fen === position.DEFAULT_POSITION && latestFen && latestFen !== result.fen)) {
            if (autoSession || autoArming) stopAuto('Auto moves reset for this game.');
            gameKey = nextGame; autoReason = '';
          }
          latestFen = result.fen;
          eligibility = play.playState(document, location.hostname, bridge, result.fen);
          if (autoSession && !eligibility.available && !eligibility.transient) stopAuto(eligibility.reason);
          updateAuto(); overlay.update();
          const key = `${location.pathname}|${result.gameId}|${result.fen}`;
          if (key === current && !refresh) { maybeAuto(); return; }
          cancel(); current = key;
          const ended = position.terminal(result.fen);
          if (ended) { if (autoSession) stopAuto('Game over. Auto moves off.'); status(ended); return; }
          status('Analyzing locally…');
          suggest(result, key, refresh);
        } catch (error) {
          if (/Extension context invalidated/i.test(error.message)) {
            stopped = true; panel?.status('Extension reloaded. Reload this page.');
          } else { current = ''; status(error.message || 'Analysis failed. Refresh to retry.'); }
        } finally { running = false; }
      }
      function schedule() { if (!timer && !stopped) timer = setTimeout(() => { timer = null; scan(); }, 100); }
      const observer = new MutationObserver(schedule);
      const observe = () => observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true,
        attributes: true, attributeFilter: ['class', 'style', 'data-fen'] });
      observe();
      let poll = setInterval(schedule, 750);
      document.addEventListener('visibilitychange', () => {
        if (document.hidden) { cancel(); if (autoSession || autoArming) stopAuto('Auto moves paused: game tab is inactive.'); panel?.visible(false); } else schedule();
      });
      window.addEventListener('blur', () => { if (autoSession || autoArming) stopAuto('Auto moves paused: game window lost focus.'); });
      window.addEventListener('pagehide', () => { cancel(); if (autoSession || autoArming) stopAuto('Auto moves reset after navigation.'); observer.disconnect(); clearInterval(poll); clearTimeout(timer); stopped = true; });
      window.addEventListener('pageshow', event => {
        if (!event.persisted) return;
        stopped = false; timer = null; observe(); poll = setInterval(schedule, 750); schedule();
      });
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'local') return;
        for (const [key, value] of Object.entries(changes)) settings[key] = value.newValue;
        panel?.configure(settings);
        overlay.setEnabled(settings.boardMoves !== false);
        if (!settings.enabled) { cancel(); if (autoSession || autoArming) stopAuto('Coach disabled.'); state = 'Coach disabled.'; panel?.visible(false); }
        schedule();
      });
      async function prepareMove(message) {
        if (!autoSession || message.sessionId !== autoSession || message.gameKey !== gameKey || document.hidden || !document.hasFocus() || !settings.enabled) throw new Error('Auto moves paused: game is inactive.');
        const board = adapters.findBoard(document, location.hostname), bridge = await readBridge();
        const transient = text => { throw Object.assign(new Error(text), { retryable: true }); };
        if (!board?.isConnected || message.fen !== recommendation?.fen || message.move !== recommendation?.move) transient('Waiting for the current suggestion…');
        if (!autoSession || message.sessionId !== autoSession || document.hidden || !document.hasFocus()) throw new Error('Auto moves stopped.');
        const result = adapters.extractPosition(document, location.hostname, board, bridge);
        if (!result.fen || !position.samePosition(result.fen, message.fen)) transient('Waiting for the live position to settle…');
        if (`${location.pathname}|${result.gameId}` !== gameKey) throw new Error('Game changed. Auto moves reset.');
        const currentPlay = play.playState(document, location.hostname, bridge, result.fen);
        if (!currentPlay.canMove) {
          if (currentPlay.transient || currentPlay.available) transient(currentPlay.reason);
          throw new Error(currentPlay.reason);
        }
        play.expectedPosition(result.fen, message.move);
        const rect = board.getBoundingClientRect(), flipped = boardUI.boardFlipped(board);
        const from = boardUI.squareCenter(message.move.slice(0, 2), rect, flipped), to = boardUI.squareCenter(message.move.slice(2, 4), rect, flipped);
        for (const point of [from, to]) {
          const target = document.elementFromPoint(point.x, point.y);
          if (point.x < 0 || point.y < 0 || point.x >= innerWidth || point.y >= innerHeight || !target || !board.contains(target)) throw new Error('Board is obscured or outside the viewport.');
        }
        return { ok: true, from, to, ply: currentPlay.livePly };
      }
      async function verifyMove(message) {
        for (let attempt = 0; attempt < 50; attempt++) {
          if (!autoSession || message.sessionId !== autoSession || message.gameKey !== gameKey || document.hidden) throw new Error('Auto moves stopped.');
          const board = adapters.findBoard(document, location.hostname);
          if (board && adapters.boardPlacement(board, location.hostname) === message.expected.split(' ')[0]) return { ok: true };
          const bridge = await readBridge();
          if (bridge.gameId && `${location.pathname}|${bridge.gameId}` !== gameKey) throw new Error('Game changed. Auto moves reset.');
          if (play.confirmsTransition(document, location.hostname, bridge, message)) return { ok: true };
          await new Promise(resolve => setTimeout(resolve, 100));
        }
        throw new Error('Move not confirmed. Check the board; auto moves paused.');
      }
      chrome.runtime.onMessage.addListener((message, sender, respond) => {
        if (sender.id !== chrome.runtime.id) return;
        if (message?.type === 'status') respond({ status: state, board: !!adapters.findBoard(document, location.hostname), boardMoves: settings.boardMoves !== false, autoMoves: !!autoSession, autoReason: autoReason || eligibility.reason });
        if (message?.type === 'auto-stopped' && (message.sessionId === autoSession || (!autoSession && !autoArming))) {
          autoSession = null; autoReason = message.reason; updateAuto();
        }
        if (message?.type === 'auto-prepare' || message?.type === 'auto-verify') {
          (message.type === 'auto-prepare' ? prepareMove(message) : verifyMove(message))
            .then(respond, error => respond({ ok: false, retryable: error.retryable === true, error: error.message }));
          return true;
        }
      });
      window.addEventListener('resize', () => { panel?.configure(settings); schedule(); });
      scan();
    }).catch(error => console.error('Local Chess Coach:', error));
})();
