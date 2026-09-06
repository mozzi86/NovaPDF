// BIT-Nova PDF service worker — precache the whole app so it runs fully offline.
// Lives at project root; scope covers renderer/ and vendor/. Relative URLs keep
// it host-agnostic (works under GitHub Pages sub-paths too).
//
// Cache strategy, and why it is split:
//   * app shell (renderer/*, manifest, logo) -> NETWORK FIRST. These files change
//     with every release. Cache-first served installed users the v1.1.1 build for
//     six releases in a row, because the cache name had not been bumped. Network
//     first means a stale cache heals itself on the next online start, even if
//     someone forgets the bump below.
//   * vendor/* and icon bitmaps -> CACHE FIRST. Multi-MB, content-stable, and the
//     whole point of the offline install.
//
// VERSION is stamped into the cache name; 'activate' deletes every cache with a
// different name. Bump it together with package.json on each release.
const VERSION = '1.1.10';
const CACHE = 'bit-nova-pdf-' + VERSION;

const ASSETS = [
  'renderer/index.html',
  'renderer/styles.css',
  'renderer/app.js',
  'renderer/nova-web.js',
  'vendor/pdf.mjs',
  'vendor/pdf.worker.mjs',
  'vendor/pdf-lib.min.js',
  'vendor/phosphor/style.css',
  'vendor/phosphor/Phosphor.woff2',
  'vendor/phosphor/Phosphor.woff',
  'vendor/phosphor/Phosphor.ttf',
  'manifest.webmanifest',
  'icons/logo.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'icons/apple-touch-icon-180.png'
];

// Files that ship a new build on every release. Matched against the pathname.
const SHELL = /(?:\/renderer\/[^/]+|\/manifest\.webmanifest|\/icons\/logo\.svg)$/;
const isShell = (url) => SHELL.test(url.pathname) || url.pathname.endsWith('/');

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // Cache individually so one 404 doesn't abort the whole install, and bypass
    // the HTTP cache so a fresh install never picks up a stale CDN copy.
    await Promise.all(ASSETS.map((u) => cache.add(new Request(u, { cache: 'reload' })).catch(() => null)));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

async function putIfOk(req, res) {
  if (res && res.ok && new URL(req.url).origin === self.location.origin) {
    const cache = await caches.open(CACHE);
    await cache.put(req, res.clone());
  }
  return res;
}

// Network first: newest build wins, cache is the offline fallback.
async function networkFirst(req) {
  try {
    return await putIfOk(req, await fetch(req));
  } catch (err) {
    const cached = await caches.match(req, { ignoreSearch: true });
    if (cached) return cached;
    if (req.mode === 'navigate') {
      const shell = await caches.match('renderer/index.html');
      if (shell) return shell;
    }
    throw err;
  }
}

// Cache first: for the large, content-stable libraries and icon bitmaps.
async function cacheFirst(req) {
  const cached = await caches.match(req, { ignoreSearch: true });
  if (cached) return cached;
  return putIfOk(req, await fetch(req));
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  let url;
  try { url = new URL(req.url); } catch { return; }
  e.respondWith(req.mode === 'navigate' || isShell(url) ? networkFirst(req) : cacheFirst(req));
});
