const CACHE_NAME = "cloudflare-one-warp-shell-v5";
const SHELL_ASSETS = [
  "/",
  "/index.html",
  "/styles.css?clientRevision=8",
  "/app.js?clientRevision=8",
  "/api-client.js?clientRevision=8",
  "/log-widget.js?clientRevision=8",
  "/i18n.js?clientRevision=8",
  "/locales/en.json",
  "/manifest.webmanifest",
  "/icon.svg"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(SHELL_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith("cloudflare-one-warp-shell-") && key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  // Never store account state, third-party responses, or arbitrary documents.
  if (url.origin !== self.location.origin || !SHELL_ASSETS.includes(`${url.pathname}${url.search}`)) return;
  if (event.request.method !== "GET") return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok && response.type === "basic") {
          const copy = response.clone();
          event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy)).catch(() => {}));
        }
        return response;
      })
      .catch(() => caches.match(event.request).then((cached) => cached || (event.request.mode === "navigate" ? caches.match("/index.html") : Response.error())))
  );
});
