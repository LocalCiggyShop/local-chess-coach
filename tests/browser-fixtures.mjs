import { Chess } from '../vendor/chess/chess.js';
import { DEFAULT_POSITION } from '../src/position.js';
const glyph = { k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟', K: '♔', Q: '♕', R: '♖', B: '♗', N: '♘', P: '♙' };
const roles = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };
export function pieces(fen, lichess) {
  return new Chess(fen).board().flat().filter(Boolean).map(p => {
    const x = p.square.charCodeAt(0) - 97, y = 8 - Number(p.square[1]);
    const cls = lichess ? `${p.color === 'w' ? 'white' : 'black'} ${roles[p.type]}` : `piece ${p.color}${p.type} square-${x + 1}${8 - y}`;
    const tag = lichess ? 'piece' : 'div';
    return `<${tag} class="${cls}" style="position:absolute;left:${x * 50}px;top:${y * 50}px;width:50px;height:50px">${glyph[p.color === 'w' ? p.type.toUpperCase() : p.type]}</${tag}>`;
  }).join('');
}
export function fixture(lichess, player = false) {
  const transitions = {};
  for (const move of new Chess().moves({ verbose: true })) {
    const c = new Chess(); c.move(move.san);
    transitions[move.from + move.to] = { fen: c.fen(), html: pieces(c.fen(), lichess), san: move.san };
  }
  const boot = { data: { game: { id: 'AbCd1234', variant: { key: 'standard' }, status: { id: 20 } },
    player: { color: 'white', spectator: !player }, steps: [{ ply: 0, fen: DEFAULT_POSITION }] } };
  return `<!doctype html><html><head><meta charset="utf-8"><style>body{background:#252a30;color:#eee;font:16px system-ui;padding:25px}wc-chess-board,cg-board{display:block;position:relative;width:400px;height:400px;background:repeating-conic-gradient(#97ad90 0% 25%,#ecebd5 0% 50%) 0/100px 100px;font-size:40px;text-align:center;line-height:50px}</style></head><body><h1>${lichess ? 'Lichess' : 'Chess.com'} ${player ? 'player' : 'spectator'} fixture</h1>${lichess ? `<main class="round"><div class="cg-wrap"><cg-board>${pieces(DEFAULT_POSITION, true)}</cg-board></div></main>` : `<wc-chess-board>${pieces(DEFAULT_POSITION, false)}</wc-chess-board><div class="move-list"><div class="line"></div></div>`}${lichess ? `<script type="application/json" id="page-init-data">${JSON.stringify(boot)}</script>` : ''}<script>
    window.fixtureFen=${JSON.stringify(DEFAULT_POSITION)}; window.fixtureMoves=[];
    ${lichess ? `document.getElementById('page-init-data').remove(); window.fixtureSocket=new WebSocket('wss://socket.lichess.org/${player ? 'play' : 'watch'}/AbCd1234/white/v6');` : `document.querySelector('wc-chess-board').game={getFEN:()=>window.fixtureFen,getPlayingAs:()=>${player ? '1' : 'null'},getMode:()=>({name:'${player ? 'playing' : 'observing'}'}),getResult:()=>'*',getPositionInfo:()=>({gameOver:false}),getGameId:()=>'123456'};`}
    const board=document.querySelector('wc-chess-board,cg-board'), transitions=${JSON.stringify(transitions)};
    let origin=null;
    function square(e){const r=board.getBoundingClientRect();const x=Math.floor((e.clientX-r.left)/(r.width/8)), y=Math.floor((e.clientY-r.top)/(r.height/8));return x>=0&&x<8&&y>=0&&y<8?String.fromCharCode(97+x)+(8-y):null;}
    board.addEventListener('mousedown',e=>{if(e.isTrusted)origin=square(e);});
    document.addEventListener('mouseup',e=>{
      if(!e.isTrusted||!origin)return;
      const dest=square(e),move=origin+dest;origin=null;
      const next=transitions[move];if(!next||window.fixtureMoves.length)return;
      window.fixtureFen=next.fen;board.innerHTML=next.html;
      const line=document.querySelector('.move-list .line');if(line)line.innerHTML='<span class="move-number">1.</span><span class="node selected">'+next.san+'</span>';
      window.fixtureMoves.push({move,trusted:e.isTrusted});
      window.reportFixtureMove?.({move,fen:next.fen,lichess:${lichess}});
    });
  </script></body></html>`;
}
