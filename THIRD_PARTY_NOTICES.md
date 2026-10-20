# Third-party notices and source

## Stockfish.js 19.0.1 / Stockfish 19

- Upstream: https://github.com/nmrugg/stockfish.js/tree/v19.0.1
- Package: https://registry.npmjs.org/stockfish/-/stockfish-19.0.1.tgz
- Source archive: `vendor/stockfish/stockfish.js-19.0.1-source.tar.gz`, downloaded from https://github.com/nmrugg/stockfish.js/archive/refs/tags/v19.0.1.tar.gz
- Bundled unmodified files: `stockfish-19-lite-single.js` and `stockfish-19-lite-single.wasm` from the package's `bin/` directory. Keep their basenames and directory relationship intact.
- Copyright 2026 Chess.com, LLC; based on Stockfish by T. Romstad, M. Costalba, J. Kiiski, G. Linscott, and other contributors. Neural nets by Chris Bao (sscg13), as identified in the upstream loader notice.
- License: GNU General Public License v3. See `vendor/stockfish/COPYING.txt` and the repository `LICENSE`.
- Corresponding source and build scripts are supplied in the archive. Upstream's build script specifies Emscripten 6.0.9 and downloads/verifies the required neural networks. Consult its README and `build.js`; the single-threaded lite target is `node build.js --lite --single-threaded -f`. The distributed binary was obtained from npm, not rebuilt or modified here.

## chess.js 1.4.0

- Upstream: https://github.com/jhlywa/chess.js/tree/v1.4.0
- Package: https://registry.npmjs.org/chess.js/-/chess.js-1.4.0.tgz
- Bundled file: unmodified `dist/esm/chess.js`, stored as `vendor/chess/chess.js`.
- Copyright Jeff Hlywa and other contributors; BSD-2-Clause license in `vendor/chess/LICENSE`.

`vendor/SHA256SUMS.json` records SHA-256 checksums for the vendored engine, rules library, licenses, and source archive. New extension code is distributed under GPL-3.0. Development-only npm dependencies retain their respective licenses; they are excluded from the loadable ZIP.
