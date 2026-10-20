import { chromium } from 'playwright';
import { fixture, pieces } from './browser-fixtures.mjs';
import { multiGameFixture } from './multi-game-fixture.mjs';
import { Chess } from '../vendor/chess/chess.js';
import { DEFAULT_POSITION } from '../src/position.js';
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';

const extension = resolve('.'), profile = await mkdtemp(join(tmpdir(), 'chess-browser-'));
const context = await chromium.launchPersistentContext(profile, {
  channel: 'chromium', headless: true,
  args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, '--no-sandbox'],
});
const errors = [], external = [];
context.on('weberror', error => errors.push(error.error().message));
context.on('request', request => { if (/^https?:/.test(request.url())) external.push(request.url()); });
await mkdir('artifacts', { recursive: true });
try {
  const rules = (await readFile('vendor/chess/chess.js', 'utf8')).replace(/^export \{.*\};$/m, 'window.FixtureChess=Chess;');
  const routeSite = lichess => route => route.request().url().endsWith('/fixture-chess.js')
    ? route.fulfill({ contentType: 'application/javascript', body: rules })
    : route.fulfill({ contentType: 'text/html', body: route.request().url().includes('long=1') ? multiGameFixture(lichess) :
      route.request().url().includes('fromStart=1') ? multiGameFixture(false, 12, { fromStart: true,
        nativeHistory: route.request().url().includes('native=1'), clipHistory: route.request().url().includes('native=1') }) :
      fixture(lichess, route.request().url().includes('player=1')),
      headers: { 'Content-Security-Policy': "script-src 'self' 'unsafe-inline'; worker-src 'none'" } });
  await context.route('https://www.chess.com/**', routeSite(false));
  await context.route('https://lichess.org/**', routeSite(true));
  let socket;
  await context.routeWebSocket('wss://socket.lichess.org/**', ws => { socket = ws; });
  await context.exposeFunction('reportFixtureMove', ({ move, fen, lichess }) => {
    if (lichess) socket?.send(JSON.stringify({ t: 'move', d: { ply: 1, uci: move, fen: fen.split(' ')[0] } }));
  });
  await context.exposeFunction('reportMultiPacket', async packet => {
    await new Promise(resolve => setTimeout(resolve, 450));
    socket?.send(JSON.stringify(packet));
  });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const extensionId = new URL(worker.url()).hostname;
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  async function status(tab) {
    return popup.evaluate(async url => {
      const tabs = await chrome.tabs.query({}); const t = tabs.find(t => t.url === url);
      // tabs.url is unavailable without a tabs permission; find the tab by probing content scripts instead.
      if (t) return chrome.tabs.sendMessage(t.id, { type: 'status' });
      for (const candidate of tabs) {
        try { const state = await chrome.tabs.sendMessage(candidate.id, { type: 'status' }); if (state) return state; } catch {}
      }
      return null;
    }, tab.url());
  }
  async function waitSuggestion(page) {
    for (let attempt = 0; attempt < 100; attempt++) {
      const state = await status(page);
      if (state?.status?.includes(' — ')) return state.status;
      if (attempt === 99) throw new Error(`No suggestion: ${JSON.stringify(state)}; browser errors: ${errors.join('; ')}`);
      await new Promise(r => setTimeout(r, 100));
    }
  }
  async function panelNodes(page) {
    const client = await context.newCDPSession(page);
    const tree = await client.send('DOM.getDocument', { depth: -1, pierce: true });
    const all = [];
    function walk(node) { all.push(node); for (const child of [...(node.children || []), ...(node.shadowRoots || [])]) walk(child); }
    walk(tree.root); return { client, all };
  }
  async function panelButton(page, className, trusted = false) {
    const { client, all } = await panelNodes(page);
    const button = all.find(n => n.nodeName === 'BUTTON' && n.attributes?.includes(className));
    assert.ok(button, `Panel button ${className}`);
    if (trusted) {
      const { model } = await client.send('DOM.getBoxModel', { nodeId: button.nodeId });
      await client.detach();
      await page.mouse.click((model.content[0] + model.content[4]) / 2, (model.content[1] + model.content[5]) / 2);
    } else {
      const obj = await client.send('DOM.resolveNode', { nodeId: button.nodeId });
      await client.send('Runtime.callFunctionOn', { objectId: obj.object.objectId, functionDeclaration: 'function(){this.click()}' });
      await client.detach();
    }
  }
  async function waitAuto(page, enabled) {
    for (let attempt = 0; attempt < 100; attempt++) {
      const current = await status(page);
      if (current?.autoMoves === enabled) return;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.equal((await status(page)).autoMoves, enabled, JSON.stringify(await status(page)));
  }
  for (const lichess of [false, true]) {
    const page = await context.newPage();
    await page.goto(lichess ? 'https://lichess.org/AbCd1234' : 'https://www.chess.com/game/live/123456');
    await page.bringToFront();
    console.log(`${lichess ? 'Lichess' : 'Chess.com'} initial: ${await waitSuggestion(page)}`);
    await page.waitForFunction(() => getComputedStyle(document.getElementById('local-chess-coach-board')).display === 'block');
    assert.equal(await page.locator('#local-chess-coach-board').evaluate(el => getComputedStyle(el).pointerEvents), 'none');
    await panelButton(page, 'board-moves');
    await page.waitForFunction(() => getComputedStyle(document.getElementById('local-chess-coach-board')).display === 'none');
    await panelButton(page, 'board-moves');
    await page.waitForFunction(() => getComputedStyle(document.getElementById('local-chess-coach-board')).display === 'block');
    const { client, all } = await panelNodes(page);
    const strong = all.find(n => n.nodeName === 'STRONG');
    assert.ok(strong?.children?.some(n => n.nodeValue), 'Move appears in a bold element');
    const refresh = all.find(n => n.nodeName === 'BUTTON' && n.attributes?.includes('refresh'));
    assert.ok(refresh);
    const object = await client.send('DOM.resolveNode', { nodeId: refresh.nodeId });
    await client.send('Runtime.callFunctionOn', { objectId: object.object.objectId, functionDeclaration: 'function(){this.click()}' });
    await client.detach();
    await new Promise(r => setTimeout(r, 650));
    await waitSuggestion(page);
    const c = new Chess(); c.move('e4');
    const after = c.fen();
    await page.evaluate(({ html, fen, lichess }) => {
      document.querySelector(lichess ? 'cg-board' : 'wc-chess-board').innerHTML = html;
      window.fixtureFen = fen;
    }, { html: pieces(after, lichess), fen: after, lichess });
    if (lichess) {
      assert.ok(socket, 'Page socket was observed');
      socket.send(JSON.stringify({ t: 'move', d: { ply: 1, uci: 'e2e4', fen: after.split(' ')[0] } }));
    }
    await new Promise(r => setTimeout(r, 1000));
    console.log(`After e4: ${await waitSuggestion(page)}`);
    await page.screenshot({ path: `artifacts/${lichess ? 'lichess' : 'chesscom'}-panel.png` });
    // Block external network and force a fresh engine search from the panel.
    await context.setOffline(true);
    const panel = await panelNodes(page);
    const button = panel.all.find(n => n.nodeName === 'BUTTON' && n.attributes?.includes('refresh'));
    const obj = await panel.client.send('DOM.resolveNode', { nodeId: button.nodeId });
    await panel.client.send('Runtime.callFunctionOn', { objectId: obj.object.objectId, functionDeclaration: 'function(){this.click()}' });
    await panel.client.detach();
    await new Promise(r => setTimeout(r, 650));
    await waitSuggestion(page); await context.setOffline(false);
    await page.close();
  }
  for (const native of [false, true]) {
    const page = await context.newPage();
    await page.goto(`https://www.chess.com/game/live/7654321?fromStart=1&native=${native ? '1' : '0'}`);
    await page.bringToFront(); await waitSuggestion(page);
    await panelButton(page, 'auto-moves', true);
    try {
      await page.waitForFunction(() => window.fixtureMoves.length >= 12, null, { timeout: 60000 });
    } catch (error) {
      throw new Error(`Chess.com icon-list regression (${native ? 'native history with truncated DOM' : 'DOM fallback'}): ${JSON.stringify(await status(page))}; completed ${await page.evaluate(() => window.fixtureMoves.length)} moves`, { cause: error });
    }
    await new Promise(resolve => setTimeout(resolve, 900));
    assert.equal((await status(page)).autoMoves, true, JSON.stringify(await status(page)));
    assert.ok(await page.evaluate(() => window.fixtureSteps.some(step => /^[KQRBN]/.test(step.san || ''))), 'Regression includes piece moves');
    if (native) assert.ok(await page.locator('.move-list .node').count() <= 4, 'Visible history is intentionally truncated');
    console.log(`Chess.com regression: 12 automatic moves from move one with lowercase piece icons (${native ? 'native history, truncated DOM' : 'DOM fallback'}).`);
    if (native) {
      await page.evaluate(() => { window.fixtureAtLiveEnd = false; });
      await waitAuto(page, false);
    } else { await panelButton(page, 'auto-moves', true); await waitAuto(page, false); }
    await page.close();
  }
  for (const lichess of [false, true]) {
    const page = await context.newPage();
    await page.goto(lichess ? 'https://lichess.org/Long1234mock?long=1' : 'https://www.chess.com/game/live/7654321?long=1');
    await page.bringToFront(); await waitSuggestion(page);
    if (lichess) assert.equal(await page.locator('#page-init-data').count(), 0, 'Lichess loader removed bootstrap before auto arming');
    await panelButton(page, 'auto-moves', true);
    try {
      await page.waitForFunction(() => window.fixtureMoves.length >= 8, null, { timeout: 45000 });
    } catch (error) {
      throw new Error(`Multi-turn auto failed (${lichess ? 'Lichess' : 'Chess.com'}): ${JSON.stringify(await status(page))}; completed ${await page.evaluate(() => window.fixtureMoves.length)} moves`, { cause: error });
    }
    await new Promise(resolve => setTimeout(resolve, 900));
    assert.equal((await status(page)).autoMoves, true, JSON.stringify(await status(page)));
    console.log(`${lichess ? 'Lichess' : 'Chess.com'} regression: 8 automatic moves after castling, with immediate opponent replies and delayed history.`);
    await panelButton(page, 'auto-moves', true); await waitAuto(page, false);
    await page.close();
  }
  for (const lichess of [false, true]) {
    const page = await context.newPage();
    await page.goto(lichess ? 'https://lichess.org/AbCd1234?player=1' : 'https://www.chess.com/game/live/123456?player=1');
    await page.bringToFront(); await waitSuggestion(page);
    assert.equal((await status(page)).autoMoves, false);
    if (lichess) assert.equal(await page.locator('#page-init-data').count(), 0, 'Player metadata was removed during startup');
    // Untrusted page-world/script clicks must never arm the privileged input controller.
    await panelButton(page, 'auto-moves');
    assert.equal((await status(page)).autoMoves, false);
    await panelButton(page, 'auto-moves', true);
    try {
      await page.waitForFunction(() => window.fixtureMoves.length === 1, null, { timeout: 10000 });
    } catch (error) { throw new Error(`Auto move failed (${lichess ? 'Lichess' : 'Chess.com'}): ${JSON.stringify(await status(page))}`, { cause: error }); }
    assert.equal(await page.evaluate(() => window.fixtureMoves[0].trusted), true);
    await new Promise(resolve => setTimeout(resolve, 1200));
    assert.equal(await page.evaluate(() => window.fixtureMoves.length), 1, 'Never play the opponent’s turn');
    const active = await status(page);
    assert.equal(active.autoMoves, true, JSON.stringify(active));
    console.log(`${lichess ? 'Lichess' : 'Chess.com'} auto: ${await page.evaluate(() => window.fixtureMoves[0].move)}`);
    await page.screenshot({ path: `artifacts/${lichess ? 'lichess' : 'chesscom'}-auto.png` });
    await panelButton(page, 'auto-moves', true);
    await waitAuto(page, false);
    await panelButton(page, 'auto-moves', true);
    await waitAuto(page, true);
    const other = await context.newPage(); await other.bringToFront();
    await waitAuto(page, false);
    await other.close(); await page.bringToFront();
    await page.reload(); await waitSuggestion(page);
    assert.equal((await status(page)).autoMoves, false, 'Reload never resumes automatic play');
    assert.equal(await page.evaluate(() => window.fixtureMoves.length), 0);
    await page.close();
  }
  assert.deepEqual(errors, []);
  await writeFile('artifacts/browser-results.json', JSON.stringify({ browser: 'Chromium', extensionId,
    passed: ['MV3 load', 'CSP and WASM worker', 'both site fixtures', 'live position updates', 'bold panel move', 'refresh', 'offline refresh', 'click-through board arrows', 'board toggle', 'trusted auto moves on both player fixtures', 'opponent-turn guard', 'auto stops on tab switch', 'auto defaults off after reload', '8 consecutive auto moves per site after castling with instant replies, batched sockets, and delayed history', '12 Chess.com auto moves from start with lowercase icons using DOM fallback', '12 Chess.com auto moves from start using native FEN history with truncated DOM', 'native history navigation guard', 'Lichess player detection after startup removes bootstrap'], errors, external }, null, 2));
  console.log('Browser smoke checks passed. Screenshots and results are in artifacts/.');
} finally { await context.close(); await rm(profile, { recursive: true, force: true }); }
