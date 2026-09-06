// Headless runner for test/e2e.html. Playwright is not a dependency of this
// project; pass the path to an existing playwright package as the 2nd argument.
// Usage: node test/run-e2e.mjs <projectRoot> <pathToPlaywrightPackage>
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = process.argv[2];
const PW = process.argv[3]; // path to playwright package
const pw = await import(pathToFileURL(path.join(PW, 'index.js')).href);
const chromium = (pw.chromium || pw.default?.chromium);

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf',
  '.webmanifest': 'application/manifest+json', '.pdf': 'application/pdf' };

const server = http.createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '');
  const file = path.join(ROOT, rel);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404); res.end('not found'); return;
  }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

const browser = await chromium.launch();
const page = await browser.newPage();
page.on('console', (m) => { if (m.type() === 'error') console.error('[console]', m.text()); });
page.on('pageerror', (e) => console.error('[pageerror]', e.message));
await page.goto(`http://127.0.0.1:${port}/test/e2e.html`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__RESULTS && window.__RESULTS.done, null, { timeout: 180000 });
const r = await page.evaluate(() => window.__RESULTS);
const pass = r.tests.filter((t) => t.pass).length;
for (const t of r.tests) if (!t.pass) console.log('FAIL:', t.name, '-', t.detail || '');
console.log(`RESULT ${pass}/${r.tests.length} PASS`);
await browser.close();
server.close();
process.exit(pass === r.tests.length ? 0 : 1);
