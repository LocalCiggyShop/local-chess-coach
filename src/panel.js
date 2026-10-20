export function createPanel(onRefresh, onSave, { onBoardMoves = () => {}, onAutoMoves = () => {} } = {}) {
  const host = document.createElement('div');
  host.id = 'local-chess-coach';
  const root = host.attachShadow({ mode: 'closed' });
  root.innerHTML = `<style>
    :host{all:initial;position:fixed;top:90px;right:20px;width:254px;max-width:calc(100vw - 24px);z-index:2147483647;color-scheme:dark;font:13px/1.5 system-ui,sans-serif;color:#e9edf1}
    *{box-sizing:border-box}section{background:#181c22;border:1px solid #39414c;border-radius:12px;box-shadow:0 8px 28px #0006;overflow:hidden}
    header{display:flex;align-items:center;gap:8px;padding:10px 12px;border-bottom:1px solid #2a3039;cursor:grab;touch-action:none;user-select:none}
    header span{flex:1;font-size:12px;font-weight:600;color:#b6c0cb;letter-spacing:.02em}header i{color:#9bdaaa;font-style:normal}
    button{font:inherit;color:#dfe6ec;background:#252c35;border:1px solid #424d5b;border-radius:6px;cursor:pointer;padding:5px 10px}
    button:hover{background:#354151}button:focus-visible{outline:2px solid #a8edbc;outline-offset:2px}
    button[aria-pressed="true"]{background:#234233;border-color:#69bb83;color:#b7f2c7}button:disabled{opacity:.5;cursor:default}.options{display:flex;gap:6px;margin:12px 0 0}.options button{flex:1;padding:6px 3px;font-size:11px}.auto-note{font-size:11px;color:#9eacba;margin:8px 0 0}.auto-note:empty{display:none}
    header button{padding:0 7px;font-size:17px}main{padding:14px}strong{display:block;color:#b7f2c7;font-size:30px;line-height:1.2;margin-bottom:8px;overflow-wrap:anywhere}
    p{margin:0 0 14px;color:#c0c8d2}small{display:block;color:#8e9baa;font-size:11px;margin-top:10px}
    .hidden{display:none}footer{display:flex;align-items:center;justify-content:space-between;gap:8px}footer span{font-size:11px;color:#92a1af}
    @media(prefers-reduced-motion:reduce){*{scroll-behavior:auto}}
  </style><section aria-label="Local Chess Coach"><header><i aria-hidden="true">♞</i><span>LOCAL CHESS COACH</span><button aria-label="Collapse panel" title="Collapse panel">−</button></header><main><div role="status" aria-live="polite"><strong class="hidden"></strong><p>Reading board…</p></div><footer><button class="refresh">Refresh</button><span>Stockfish · local</span></footer><div class="options"><button class="board-moves" aria-pressed="true">Board moves: On</button><button class="auto-moves" aria-pressed="false">Auto moves: Off</button></div><p class="auto-note" role="status" aria-live="polite"></p><small>300 ms search</small></main></section>`;
  const main = root.querySelector('main'), toggle = root.querySelector('header button');
  const move = root.querySelector('strong'), reason = root.querySelector('p'), details = root.querySelector('small');
  let collapsed = false, dragging = null;
  function collapse(value) {
    collapsed = value; main.classList.toggle('hidden', value); toggle.textContent = value ? '+' : '−';
    toggle.setAttribute('aria-label', value ? 'Expand panel' : 'Collapse panel');
    toggle.setAttribute('aria-expanded', String(!value));
  }
  toggle.onclick = () => { collapse(!collapsed); onSave({ collapsed }); };
  root.querySelector('.refresh').onclick = onRefresh;
  root.querySelector('.board-moves').onclick = onBoardMoves;
  root.querySelector('.auto-moves').onclick = event => { if (event.isTrusted) onAutoMoves(); };
  const header = root.querySelector('header');
  header.addEventListener('pointerdown', e => {
    if (e.target.closest('button') || e.button !== 0) return;
    const rect = host.getBoundingClientRect(); dragging = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    header.setPointerCapture(e.pointerId);
  });
  header.addEventListener('pointermove', e => {
    if (!dragging) return;
    host.style.right = 'auto';
    host.style.left = `${Math.max(0, Math.min(innerWidth - host.offsetWidth, e.clientX - dragging.x))}px`;
    host.style.top = `${Math.max(0, Math.min(innerHeight - header.offsetHeight, e.clientY - dragging.y))}px`;
  });
  header.addEventListener('pointerup', () => {
    if (!dragging) return; dragging = null;
    onSave({ panelPosition: { left: parseFloat(host.style.left), top: parseFloat(host.style.top) } });
  });
  header.addEventListener('pointercancel', () => { dragging = null; });
  document.documentElement.append(host);
  return {
    host,
    visible(value) { const display = value ? 'block' : 'none'; if (host.style.display !== display) host.style.display = display; },
    configure(settings) {
      collapse(settings.collapsed === true);
      const boardButton = root.querySelector('.board-moves'), show = settings.boardMoves !== false;
      boardButton.setAttribute('aria-pressed', String(show)); boardButton.textContent = `Board moves: ${show ? 'On' : 'Off'}`;
      const p = settings.panelPosition;
      if (Number.isFinite(p?.left) && Number.isFinite(p?.top)) {
        host.style.right = 'auto'; host.style.left = `${Math.max(0, Math.min(innerWidth - 254, p.left))}px`;
        host.style.top = `${Math.max(0, Math.min(innerHeight - 44, p.top))}px`;
      }
    },
    automation({ enabled = false, available = false, busy = false, reason = '' }) {
      const button = root.querySelector('.auto-moves');
      button.setAttribute('aria-pressed', String(enabled));
      button.textContent = `Auto moves: ${enabled ? 'On' : 'Off'}`;
      button.disabled = busy || (!enabled && !available); button.title = reason;
      root.querySelector('.auto-note').textContent = reason;
    },
    status(text) { move.textContent = ''; move.classList.add('hidden'); reason.textContent = text; details.textContent = '300 ms search'; },
    result({ san, reason: text }, score, side) {
      move.textContent = san; move.classList.remove('hidden'); reason.textContent = text;
      const evaluation = score ? (score[0] === 'mate' ? `Mate score ${score[1]}` : `${(Number(score[1]) / 100).toFixed(2)} pawns`) : '';
      details.textContent = `${side === 'w' ? 'White' : 'Black'} to move · 300 ms${evaluation ? ` · ${evaluation} (side to move)` : ''}`;
    },
  };
}
