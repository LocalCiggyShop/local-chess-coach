# Changelog

## 1.0.1 — Connection fix

- Fix “Could not establish connection. Receiving end does not exist.” when opening Chess.com or Lichess games.
- Wait for the local engine's message listener before requesting analysis, including when its offscreen page is still loading.
- Reconnect once if the engine disappears before receiving a request, with a clear Refresh prompt if startup fails.
- Add delayed-startup and concurrent-request regression checks.

## 1.0.0 — First GitHub release

- Manifest V3 extension for desktop Chrome and Brave on Chess.com and Lichess.
- Bundled Stockfish 19 WASM analysis with no remote engine or API key.
- Automatic position updates, a bold suggested move, one short reason, and manual refresh.
- Movable, collapsible dark panel and optional board arrows and square highlights.
- Optional automatic moves for the verified player's side, enabled explicitly for each game.
- Verification of live positions and move confirmation, including fast opponent replies and delayed history updates.
- Chess.com native FEN history and cursor detection, with move-list parsing as a fallback.
- Lichess startup-state capture, batched move updates, and castling notation support.
- Offline analysis of available positions, popup settings, installation instructions, and troubleshooting.
- Unit tests, real bundled-WASM checks, and Chromium tests using representative game fixtures.

This is the first published release. It includes the fixes developed and tested before the repository was created.
