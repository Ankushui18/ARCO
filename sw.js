/* sw.js — Penfig service worker
 *
 * Strategy:
 *   - Disabled entirely on localhost / 127.0.0.1 / .local / vercel.app previews
 *     (hostname contains "vercel.app" AND the URL has a "preview" branch
 *      convention? we treat all non-prod hosts as dev and skip SW).
 *   - Network-first for navigations (HTML) so new deploys always win.
 *   - Stale-while-revalidate for static assets: instant load from cache,
 *     background update so the next navigation gets fresh code.
 *   - Bumped cache name = old caches deleted on activate.
 */

const CACHE = 'penfig-app-v9';
const STATIC_ASSETS = [
  './',
  './index.html',
  './app.css',
  './manifest.webmanifest',
  './src/import-worker.js',
  './src/export-worker.js',
];

// Disable on localhost and preview hosts so we don't cache-stale during dev.
const isDevHost = (() => {
  if (typeof self === 'undefined') return false;
  const host = (self.location && self.location.hostname) || '';
  return (
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '0.0.0.0' ||
    host.endsWith('.local') ||
    // Vercel preview deployments: <branch>-<slug>.vercel.app vs penfig.app (prod)
    // Heuristic: anything with a hyphen+hex segment or "penfig-git-" = preview.
    /penfig-git-/i.test(host) ||
    // Vercel gives preview URLs a hostname like project-*.vercel.app
    /-.*-.*\.vercel\.app$/i.test(host)
  );
})();

self.addEventListener('install', (event) => {
  if (isDevHost) return;
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(STATIC_ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Dev/preview: never intercept — let the browser go straight to network.
  if (isDevHost) return;

  // Navigation requests (HTML) — network first, fall back to cache (offline).
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
          return res;
        })
        .catch(() => caches.match(req).then((r) => r || caches.match('./index.html')))
    );
    return;
  }

  // Static assets — stale-while-revalidate: serve cache, update in background.
  if (req.destination === 'script' || req.destination === 'style' ||
      req.destination === 'image' || req.destination === 'font') {
    event.respondWith(
      caches.match(req).then((cached) => {
        const network = fetch(req).then((res) => {
          if (res && res.status === 200) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        }).catch(() => cached);
        return cached || network;
      })
    );
    return;
  }

  // Default: cache-first with network fallback.
  event.respondWith(
    caches.match(req).then((cached) => {
      return cached || fetch(req).then((res) => {
        if (res && res.status === 200) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      });
    })
  );
});
