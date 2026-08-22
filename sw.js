// BIT-Nova PDF service worker — precache the whole app so it runs fully offline.
// Lives at project root; scope covers renderer/ and vendor/. Relative URLs keep
// it host-agnostic (works under GitHub Pages sub-paths too).
//
// CACHE bei jeder Änderung an ASSETS hochzählen — 'activate' löscht alle Caches
// mit abweichendem Namen, sonst liefert der SW installierten Nutzern ewig den
// alten Stand aus (v2: Umbenennung BIT-Nova PDF + neue Icons).
const CACHE = 'bit-nova-pdf-v2';
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
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'icons/apple-touch-icon-180.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // Cache individually so one 404 doesn't abort the whole install.
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

// Cache-first, fall back to network and cache the result. Navigations fall back
// to the cached app shell when offline.
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  e.respondWith((async () => {
    const cached = await caches.match(req, { ignoreSearch: true });
    if (cached) return cached;
    try {
      const res = await fetch(req);
      if (res && res.ok && new URL(req.url).origin === self.location.origin) {
        const cache = await caches.open(CACHE); cache.put(req, res.clone());
      }
      return res;
    } catch (err) {
      if (req.mode === 'navigate') { const shell = await caches.match('renderer/index.html'); if (shell) return shell; }
      throw err;
    }
  })());
});
