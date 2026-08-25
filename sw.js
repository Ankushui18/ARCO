const CACHE = "penfig-app-v1";
const CORE = [
  "./",
  "./index.html",
  "./app.css",
  "./manifest.webmanifest",
  "./assets/figio.js",
  "./assets/jszip.min.js"
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(cache => cache.addAll(CORE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", event => {
  const req = event.request;
  if (req.method !== "GET") return;

  event.respondWith(
    caches.match(req).then(cached => {
      if (cached) return cached;
      return fetch(req).then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(cache => cache.put(req, copy));
        return res;
      }).catch(() => caches.match("./index.html"));
    })
  );
});
