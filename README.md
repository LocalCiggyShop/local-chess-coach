# Local Chess Coach

A browser extension for **Chrome and Brave** that adds a small, dark chess-coaching panel to **Chess.com and Lichess**. It runs the bundled **Stockfish 19 WASM engine locally** and shows a suggested move, a short explanation, and an arrow directly on the board.

**[Download the latest release](https://github.com/LocalCiggyShop/local-chess-coach/releases/latest)** · [Release notes](CHANGELOG.md)

## What it does

- Reads supported standard-chess positions automatically, preferring full FEN and checking the visible board.
- Shows the suggested move in bold, followed by one short reason.
- Draws an optional arrow and square highlights that follow board flips, scrolling, and resizing.
- Updates as the position changes; **Refresh** requests another analysis.
- Provides a movable, collapsible dark panel and popup settings.
- Offers an **Auto moves** button for your side in a verified player game. It starts off and must be enabled separately for each game.
- Analyzes positions on your device with a 300 ms search budget. No extension account, API key, cloud analysis, or build step is required.

The engine can analyze an available position offline. Loading the chess websites and receiving live game updates still need an internet connection. Use the extension where the site's rules permit assistance; see [Fair play](#fair-play).

## Install in Chrome or Brave

1. Open the **[latest release](https://github.com/LocalCiggyShop/local-chess-coach/releases/latest)** and download **`Local-Chess-Coach.zip`** under **Assets**.
2. **Extract the ZIP** into a permanent folder. Keep that folder after installation, because the browser loads the extension from it.
3. Open the extension-management page:
   - Chrome: enter `chrome://extensions` in the address bar.
   - Brave: enter `brave://extensions` in the address bar.
4. Turn on **Developer mode** in the upper-right corner.
5. Click **Load unpacked**, then select the extracted folder containing **`manifest.json`**. Select the folder, not the ZIP or an individual file.
6. Refresh any Chess.com or Lichess tabs that are already open.
7. Open a supported standard-chess board. The panel appears automatically. You can pin **Local Chess Coach** through the browser's Extensions menu to access its popup settings.

**No Node.js, npm, or terminal commands are needed to install or use the extension.** It is installed manually as an unpacked extension, rather than through the Chrome Web Store.

Alternatively, use this repository's **Code → Download ZIP**, extract it, and select the extracted repository folder containing `manifest.json` in step 5.

Requires desktop Chrome or Brave based on Chromium 116 or newer. Mobile browsers and Firefox are not supported.

## Update or remove

To update, download a newer release and replace the files inside the folder you originally loaded. Open `chrome://extensions` or `brave://extensions`, click **Reload** on Local Chess Coach, then refresh all chess tabs. The extension card shows the installed version. Automatic moves must be enabled again after reloading.

To uninstall, click **Remove** on the extension card. You can then delete the extracted folder.

## Use

- The large green move is SAN notation, for example **Nf3**, **O-O**, or **exd8=Q+**. The suggestion is for whichever side is to move on the displayed board.
- The panel updates automatically as the displayed position changes. Browsing earlier moves analyzes the displayed position, rather than silently following the latest move.
- **Refresh** reanalyzes the position without using the small in-memory result cache. The first suggestion can take longer while WASM initializes; later searches normally finish shortly after the 300 ms search budget.
- Drag the header to move the panel; use **−** to collapse it. Placement and collapse state persist locally. The extension popup toggles the coach and panel visibility.
- **Board moves: On/Off** shows or hides a green arrow from the suggested source square to the destination, with both squares highlighted. It follows board flips, scrolling, and resizing, and allows clicks and drags to pass through. This preference persists locally; board moves start on.
- **Auto moves: Off/On** enables automatic execution of the suggested move for **your side only** in the current verified player game. Enable it by clicking the button yourself. Spectator pages, analysis boards, unknown player colors, and unverified live positions cannot enable it. You may enable it while waiting for the opponent; it acts when your turn arrives.
- Automatic moves use browser-generated drag input through Chrome's debugger API. The browser shows its standard debugging banner while enabled. Click **Auto moves: On** again, or cancel the browser banner, to stop. Only one tab can have automatic moves enabled at a time.
- Auto moves reset after navigation, reload, a rematch, switching tabs, losing window focus, or disabling the coach. They pause if the board is obscured, a move is not confirmed, or you browse game history. They never persist as an enabled setting. Promotions pause automatic play so you can choose the promotion piece manually; the arrow labels the suggested piece.
- **Waiting for live move data to catch up** means automatic play remains enabled but sends no moves until the position is verified again. A short synchronization delay does not require clicking the toggle again. Explicitly browsing an earlier move still turns automatic play off.
- Only visible tabs analyze. Multiple visible chess tabs share one engine, with searches processed in order and superseded positions cancelled. CPU scheduling and initialization can make total latency exceed 300 ms.
- Evaluation is from the side-to-move perspective. A move is the engine's best within this short search, not a proof of the objectively best move. Reasons describe verifiable move properties; quiet moves use a neutral engine-preference explanation.

## Supported pages and position accuracy

The adapters target standard-chess live player and spectator pages, including public, rated, and casual games, plus completed-game and analysis pages where the displayed position can be verified. The extension does not filter out ongoing human games.

It prefers full FEN from accessible board state or FEN fields. Otherwise it legally replays a complete move history from a verified starting position. Lichess's boot data and already-delivered live move messages also support pages with hidden move lists. The extension creates no additional game connections. It interacts with the game's board only while you have explicitly enabled automatic moves.

Automatic moves require stricter verification than suggestions: your player color, an ongoing game, a matching position, and confirmation that you are viewing the latest move. Chess.com's native board state is preferred and works independently of move-list visibility. If that interface is unavailable, the fallback requires the complete move list. If the site does not expose enough information, the automatic-move button is disabled with an explanation. Board arrows remain available wherever a suggestion can be verified.

Visible pieces are cross-checked against the reconstructed position. Piece placement alone cannot reveal side to move, castling rights, or en passant. If full state cannot be verified, the panel explains that instead of inventing a FEN. Unavailable or truncated history, changed site markup, private page internals, and unusual page layouts can therefore prevent a suggestion. Variants other than standard chess are outside the supported scope. Not every variant can be reliably identified from third-party page markup.

Offline means **analysis** works without network access after the position is available. Loading the websites and receiving live moves still require internet access. Explanations are local rules, not AI-generated text. Repetition draw claims cannot always be established from a standalone FEN.

## Fair play

Chess.com and Lichess prohibit engine assistance during ongoing human games, including rated and casual play. Using this extension in those games can lead to account penalties. Use it for spectating, analysis, post-game review, and practice where the site's rules permit assistance. See [Chess.com Fair Play](https://www.chess.com/legal/fair-play) and [Lichess Fair Play](https://lichess.org/page/fair-play).

## Privacy and permissions

- Site access is limited to `https://www.chess.com/*`, `https://chess.com/*`, and `https://lichess.org/*`.
- `storage` saves preferences on this device. No credentials, game history, or analytics are stored.
- `offscreen` hosts the worker in an extension document so it can use the extension's WASM content security policy independently of site CSP.
- `debugger` supplies browser-generated board input for the automatic-move option. It is a powerful browser permission and is required in the manifest because [Chrome does not support it as an optional permission](https://developer.chrome.com/docs/extensions/reference/api/permissions). The extension attaches only to a supported game tab after you enable automatic moves, sends mouse input for a validated legal suggestion, and detaches when automatic play stops. It does not use debugger network interception or script evaluation.
- No `tabs`, cookies, browsing history, broad host, or remote-code permission is requested.
- The page-world bridge reads position data and passively observes Lichess move messages. Its messages are untrusted and are validated before analysis. Vendor engine files are not exposed to websites as web-accessible resources.

## Troubleshooting

- **No panel:** enable the coach and panel in the popup, reload the game tab, and check that it is a supported standard-chess main board. Miniature boards are ignored.
- **Cannot verify the full position:** open the complete move list or the site's analysis view. Reloading the game may restore complete boot data. The extension deliberately avoids partial or guessed FENs.
- **Engine error:** click Refresh. If it persists, reload the extension on the Extensions page, then reload the game tab. Ensure the `.wasm` and matching engine `.js` are both present in `vendor/stockfish/`.
- **Extension reloaded:** already-injected scripts need a page reload after updating or reloading the extension.
- **Auto moves disabled:** check that you are a player in an ongoing standard-chess game and are viewing its latest position. If Chess.com's native board interface is unavailable, open the complete move list for fallback verification. The panel explains when live state or player identity cannot be verified.
- **Browser input disconnected:** close the tab's DevTools if they conflict with the extension's debugger connection, then explicitly enable auto moves again. Cancelling the browser's debugging banner stops the feature.
- **Auto move not confirmed:** inspect the board and any promotion or move-confirmation dialog. Resolve it manually; the extension stops rather than repeatedly attempting the same position. Use normal 2D boards for automatic input; unusual 3D geometry is outside the supported scope.
- **Brave:** ensure the extension has site access to the page. Site rendering or script blocking can prevent either the website or adapter from exposing a usable board.

## Development and checks

Loading the extension does not require Node or npm. Development checks require Node 22+:

```sh
npm ci
npm test
npm run check
npx playwright install chromium
npm run test:browser
python3 tools/package.py
```

Tests include position validation, special moves, both board orientations, adapter fixtures, engine cancellation and cache behavior, failed startup recovery, a real bundled-WASM UCI search, board coordinates, auto-session validation, duplicate prevention, and cancellation during a drag. Regression tests cover Lichess bootstrap formats, startup removal before the first read, retained black-player identity, route changes, spectator and finished-game guards, batched packets, castling, temporary history lag, repeated-position history browsing, confirmation after fast replies, Chess.com lowercase piece icons, and native FEN/cursor verification. The browser smoke test loads the extension into Chromium and uses intercepted, representative game pages at the supported origins. It checks arrows, both panel toggles, trusted automatic board gestures, opponent-turn protection, reload reset, offline analysis, eight consecutive automatic moves per site after both sides castle, and two Chess.com runs of twelve automatic moves from the starting position: lowercase-icon DOM fallback and native history with a truncated move list. Lichess fixtures remove the bootstrap script before automatic play is enabled, matching the current site loader. Opponent replies are immediate and move-list updates are delayed. These fixtures do not certify compatibility with every authenticated live site deployment. Chrome and Brave should also be checked manually against current game pages after installation.

The service worker routes engine messages and owns explicitly armed automatic-input sessions; an offscreen document owns one Stockfish worker. Content scripts render an isolated Shadow DOM panel and a separate click-through SVG overlay. The MAIN-world bridge remains read-only and reads site state without `eval`. Extension scripts and WASM are packaged locally. Third-party versions, checksums, source, and license notices are in `THIRD_PARTY_NOTICES.md` and `vendor/`.

## License

The extension is distributed under [GPL-3.0](LICENSE). The bundled Stockfish engine and chess.js library retain their respective licenses. See [third-party notices and source](THIRD_PARTY_NOTICES.md) for versions, attribution, checksums, and the included Stockfish source archive.
