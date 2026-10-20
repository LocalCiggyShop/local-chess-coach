export function boardFlipped(board) {
  return !!board.closest('.orientation-black, .flipped');
}

export function squareCenter(square, rect, flipped = false) {
  if (!/^[a-h][1-8]$/.test(square)) throw new Error('Invalid square.');
  const file = square.charCodeAt(0) - 97, rank = Number(square[1]) - 1;
  return { x: rect.left + (flipped ? 7.5 - file : file + 0.5) * rect.width / 8,
    y: rect.top + (flipped ? rank + 0.5 : 7.5 - rank) * rect.height / 8 };
}

export function createBoardOverlay() {
  const host = document.createElement('div');
  host.id = 'local-chess-coach-board'; host.setAttribute('aria-hidden', 'true');
  const root = host.attachShadow({ mode: 'closed' });
  root.innerHTML = `<style>:host{all:initial;position:fixed;display:none;pointer-events:none!important;z-index:2147483646}svg{display:block;width:100%;height:100%;overflow:hidden;pointer-events:none!important}</style><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 800"><rect class="from" width="92" height="92" rx="14" fill="#65e89a" fill-opacity=".24" stroke="#75f1a4" stroke-width="4"/><rect class="to" width="92" height="92" rx="14" fill="#f7d05d" fill-opacity=".3" stroke="#f7d05d" stroke-width="4"/><line stroke="#111a20" stroke-opacity=".8" stroke-width="20" stroke-linecap="round"/><line class="arrow" stroke="#79f4a7" stroke-width="12" stroke-linecap="round"/><polygon fill="#79f4a7" stroke="#15241b" stroke-width="2"/><text text-anchor="middle" font-family="system-ui,sans-serif" font-size="28" font-weight="bold" fill="#111a20" stroke="#f7d05d" stroke-width="1" paint-order="stroke"></text></svg>`;
  document.documentElement.append(host);
  let board, move, signature = '', enabled = true;
  const resize = new ResizeObserver(() => update());
  function hide() { if (host.style.display !== 'none') host.style.display = 'none'; }
  function update() {
    if (!enabled || !board?.isConnected || !move || document.hidden) { hide(); return; }
    const rect = board.getBoundingClientRect(), flipped = boardFlipped(board);
    if (!rect.width || !rect.height || rect.bottom < 0 || rect.top > innerHeight) { hide(); return; }
    const next = [rect.left, rect.top, rect.width, rect.height, flipped, move].join('|');
    if (signature !== next) {
      signature = next;
      for (const [key, value] of Object.entries({ left: rect.left, top: rect.top, width: rect.width, height: rect.height })) host.style[key] = `${value}px`;
      const from = squareCenter(move.slice(0, 2), { left: 0, top: 0, width: 800, height: 800 }, flipped);
      const to = squareCenter(move.slice(2, 4), { left: 0, top: 0, width: 800, height: 800 }, flipped);
      for (const [selector, point] of [['.from', from], ['.to', to]]) {
        const node = root.querySelector(selector); node.setAttribute('x', point.x - 46); node.setAttribute('y', point.y - 46);
      }
      const distance = Math.hypot(to.x - from.x, to.y - from.y), dx = (to.x - from.x) / distance, dy = (to.y - from.y) / distance;
      for (const line of root.querySelectorAll('line')) {
        for (const [key, value] of Object.entries({ x1: from.x, y1: from.y, x2: to.x - dx * 25, y2: to.y - dy * 25 })) line.setAttribute(key, value);
      }
      const back = { x: to.x - dx * 42, y: to.y - dy * 42 };
      root.querySelector('polygon').setAttribute('points', `${to.x},${to.y} ${back.x - dy * 23},${back.y + dx * 23} ${back.x + dy * 23},${back.y - dx * 23}`);
      const label = root.querySelector('text'); label.textContent = move[4]?.toUpperCase() || '';
      label.setAttribute('x', to.x); label.setAttribute('y', to.y - 28);
    }
    if (host.style.display !== 'block') host.style.display = 'block';
  }
  window.addEventListener('scroll', update, true);
  window.addEventListener('resize', update);
  document.addEventListener('visibilitychange', update);
  return {
    show(nextBoard, uci) {
      if (!/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(uci) || uci.slice(0, 2) === uci.slice(2, 4)) { this.clear(); return; }
      if (board !== nextBoard) { resize.disconnect(); board = nextBoard; resize.observe(board); signature = ''; }
      move = uci; update();
    },
    clear() { move = null; signature = ''; hide(); },
    setEnabled(value) { enabled = value; update(); },
    update,
  };
}
