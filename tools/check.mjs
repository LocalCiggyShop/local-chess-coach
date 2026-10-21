import { readFile, access, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
const manifest = JSON.parse(await readFile('manifest.json', 'utf8'));
assert.equal(manifest.manifest_version, 3);
assert.equal(manifest.version, JSON.parse(await readFile('package.json', 'utf8')).version);
assert.deepEqual([...manifest.permissions].sort(), ['debugger', 'offscreen', 'storage']);
assert.ok(manifest.content_security_policy.extension_pages.includes("'wasm-unsafe-eval'"));
assert.ok(!manifest.content_security_policy.extension_pages.includes("'unsafe-eval'"));
const files = [manifest.background.service_worker, manifest.action.default_popup,
  ...Object.values(manifest.icons), ...manifest.content_scripts.flatMap(c => c.js),
  ...manifest.web_accessible_resources.flatMap(r => r.resources), 'offscreen.html', 'src/offscreen.js', 'src/engine.js', 'src/engine-connection.js', 'src/automation.js'];
for (const file of files) await access(file);
for (const [file, hash] of Object.entries(JSON.parse(await readFile('vendor/SHA256SUMS.json', 'utf8')))) {
  assert.equal(createHash('sha256').update(await readFile(file)).digest('hex'), hash, `Vendor checksum: ${file}`);
}
const wasm = await readFile('vendor/stockfish/stockfish-19-lite-single.wasm');
assert.equal(wasm.subarray(0, 4).toString('hex'), '0061736d');
for (const file of ['popup.html', 'offscreen.html']) {
  const html = await readFile(file, 'utf8');
  for (const match of html.matchAll(/(?:src|href)="([^"#]+)"/g)) await access(match[1]);
}
for (const file of await readdir('src')) {
  if (!file.endsWith('.js')) continue;
  const text = await readFile(`src/${file}`, 'utf8');
  assert.ok(!/\beval\s*\(|new\s+Function\s*\(/.test(text), `No dynamic code: ${file}`);
}
console.log(`Package checks passed; local WASM ${(wasm.length / 1024 / 1024).toFixed(2)} MiB.`);
