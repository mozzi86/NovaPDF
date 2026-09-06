// Proves the two SW claims: (1) a stale cache from an older release is dropped,
// (2) app-shell files come from the network, not from a stale cache.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = process.argv[2];
const PW = process.argv[3];
const pw = await import(pathToFileURL(path.join(PW, 'index.js')).href);
const chromium = pw.chromium || pw.default?.chromium;

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf',
  '.webmanifest': 'application/manifest+json' };

let stamp = 'BUILD-A';
const server = http.createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '');
  const file = path.join(ROOT, rel);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404); res.end('not found'); return;
  }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream' });
  if (rel === 'renderer/styles.css') { // stand-in for "a file that changed in the new release"
    res.end(fs.readFileSync(file, 'utf8') + `\n/* ${stamp} */\n`); return;
  }
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch();
const ctx = await browser.newContext();
const page = await ctx.newPage();

// Seed a cache under the OLD name with poisoned shell content, like an install
// that has been sitting on v1.1.1 since June.
await page.goto(`${base}/renderer/index.html`, { waitUntil: 'load' });
await page.evaluate(async () => {
  const c = await caches.open('bit-nova-pdf-v2');
  await c.put(new Request('styles.css'), new Response('/* STALE-v1.1.1 */', { headers: { 'Content-Type': 'text/css' } }));
});
await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 30000 });
await page.reload({ waitUntil: 'load' });

const keys = await page.evaluate(() => caches.keys());
console.log('Cache-Namen nach activate:', JSON.stringify(keys));

const first = await page.evaluate(async (b) => (await fetch(b + '/renderer/styles.css')).text().then((t) => t.slice(-40)), base);
console.log('styles.css beim ersten Start  :', JSON.stringify(first.trim()));

// New release goes live on the server, client reloads.
stamp = 'BUILD-B-NEU';
await page.reload({ waitUntil: 'load' });
const second = await page.evaluate(async (b) => (await fetch(b + '/renderer/styles.css')).text().then((t) => t.slice(-40)), base);
console.log('styles.css nach neuem Build   :', JSON.stringify(second.trim()));

// Offline: the cache must still answer.
await ctx.setOffline(true);
const offline = await page.evaluate(async (b) => {
  try { return (await fetch(b + '/renderer/styles.css')).text().then((t) => t.slice(-40)); }
  catch (e) { return 'FEHLER ' + e.message; }
}, base);
console.log('styles.css offline            :', JSON.stringify(offline.trim()));
await ctx.setOffline(false);

const ok = keys.length === 1 && keys[0] === 'bit-nova-pdf-1.1.8'
  && !first.includes('STALE') && second.includes('BUILD-B-NEU') && offline.includes('BUILD-B-NEU');
console.log(ok ? 'ERGEBNIS: OK' : 'ERGEBNIS: FEHLGESCHLAGEN');
await browser.close(); server.close();
process.exit(ok ? 0 : 1);
