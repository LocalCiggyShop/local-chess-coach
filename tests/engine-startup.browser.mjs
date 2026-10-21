import { chromium } from 'playwright';
import { fixture } from './browser-fixtures.mjs';
import { mkdtemp, cp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';

const root = await mkdtemp(join(tmpdir(), 'chess-startup-'));
const extension = join(root, 'extension');
let context;
try {
  for (const file of ['manifest.json', 'offscreen.html', 'popup.html', 'popup.css', 'src', 'assets', 'vendor']) {
    await cp(resolve(file), join(extension, file), { recursive: true });
  }
  const offscreen = join(extension, 'src/offscreen.js');
  await writeFile(offscreen, (await readFile(offscreen, 'utf8')).replace('const queue =',
    'await new Promise(resolve => setTimeout(resolve, 1500));\nconst queue ='));
  context = await chromium.launchPersistentContext(join(root, 'profile'), {
    channel: 'chromium', headless: true,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, '--no-sandbox'],
  });
  const errors = [];
  context.on('weberror', error => errors.push(error.error().message));
  await context.route('https://www.chess.com/**', route => route.fulfill({ contentType: 'text/html', body: fixture(false) }));
  await context.route('https://lichess.org/**', route => route.fulfill({ contentType: 'text/html', body: fixture(true) }));
  await context.routeWebSocket('wss://socket.lichess.org/**', () => {});
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${new URL(worker.url()).hostname}/popup.html`);
  for (const url of ['https://www.chess.com/game/live/123456', 'https://lichess.org/AbCd1234']) {
    // Reproduce a context discovered while another caller is still creating it.
    await worker.evaluate(async () => {
      chrome.offscreen.createDocument({ url: 'offscreen.html', reasons: ['WORKERS'], justification: 'Test delayed engine startup.' });
      while (!(await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] })).length) {
        await new Promise(resolve => setTimeout(resolve, 10));
      }
    });
    const ready = await worker.evaluate(() => chrome.runtime.sendMessage({ target: 'engine', type: 'ping' }).catch(() => null));
    assert.notEqual(ready?.ready, true, 'The regression must begin before the engine listener exists');
    const page = await context.newPage();
    await page.goto(url); await page.bringToFront();
    let status;
    for (let attempt = 0; attempt < 150; attempt++) {
      status = await popup.evaluate(async () => {
        for (const tab of await chrome.tabs.query({})) {
          try { const result = await chrome.tabs.sendMessage(tab.id, { type: 'status' }); if (result) return result.status; } catch {}
        }
      });
      assert.ok(!/Receiving end does not exist|could not connect/i.test(status || ''), status);
      if (status?.includes(' — ')) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.ok(status?.includes(' — '), `No suggestion on ${url}: ${status}`);
    console.log(`${new URL(url).hostname}: delayed engine startup recovered; ${status}`);
    await page.close();
    await worker.evaluate(() => chrome.offscreen.closeDocument());
  }
  assert.deepEqual(errors, []);
} finally {
  await context?.close();
  await rm(root, { recursive: true, force: true });
}
