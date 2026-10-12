// SetuSync service worker: keeps the APP itself usable with no connection.
// (Search results live in IndexedDB; this only caches the app shell.)
// Never caches /v1/* (live data) or config.js (deployment settings).
const SHELL = "setusync-shell-v4";
// Background Sync: finishes queued searches even after the tab is closed.
try { importScripts("/bg-sync.js"); } catch (error) { /* absent in dev builds */ }

const CORE = ["/", "/index.html", "/manifest.webmanifest", "/icon.svg", "/icon-192.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL)
      .then((cache) => cache.addAll(CORE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== SHELL).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  );
});

// The page tells us which hashed bundles it loaded, so the very first
// visit is already enough to work offline afterwards.
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "CACHE_URLS" && Array.isArray(event.data.urls)) {
    event.waitUntil(
      caches.open(SHELL).then((cache) =>
        Promise.all(
          event.data.urls
            .filter((u) => new URL(u, self.location.origin).origin === self.location.origin)
            .map((u) => cache.add(u).catch(() => undefined)),
        ),
      ),
    );
  }
});

self.addEventListener("fetch", (event) => {
  const request = event.request;

  if (request.method !== "GET") return;

  const url = new URL(request.url);

  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/v1/") || url.pathname === "/config.js" || url.pathname === "/sw.js" || url.pathname === "/bg-sync.js") return;

  // Page loads: network first, fall back to the cached shell.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          void caches.open(SHELL).then((cache) => cache.put("/index.html", copy));
          return response;
        })
        .catch(() => caches.match("/index.html").then((r) => r || caches.match("/"))),
    );
    return;
  }

  // Hashed assets and icons: cache first.
  event.respondWith(
    caches.match(request).then(
      (cached) =>
        cached ||
        fetch(request).then((response) => {
          // Never cache the HTML fallback under a script/wasm URL (it would stick forever).
          const type = response.headers.get("content-type") || "";
          if (response.ok && !type.includes("text/html")) {
            const copy = response.clone();
            void caches.open(SHELL).then((cache) => cache.put(request, copy));
          }
          return response;
        }),
    ),
  );
});
