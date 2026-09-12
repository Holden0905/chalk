// Offline shell only. Board data is private and server rendered, so nothing
// with numbers in it is ever cached; a cold offline load gets the shell page
// and an honest message.
//
// The cache name comes from the ?v= on the script URL, which the app stamps
// with the build id. A deploy therefore changes this script's URL, the browser
// fetches it, sees a new worker, and the install/activate pair below takes over
// immediately rather than waiting for every tab to close. An installed PWA is
// rarely "closed", which is how a stale build survives otherwise.
const BUILD = new URL(self.location.href).searchParams.get("v") || "dev";
const VERSION = `chalk-${BUILD}`;
const SHELL = ["/offline", "/manifest.webmanifest", "/icons/icon-192.png", "/icons/icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(VERSION)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Let the page ask for an immediate takeover.
self.addEventListener("message", (event) => {
  if (event.data === "skip-waiting") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Pages and RSC payloads always go to the network, and are never written to
  // a cache, so a page can never be served from a previous build. The only
  // fallback is the offline shell.
  if (request.mode === "navigate" || request.headers.get("RSC") === "1") {
    event.respondWith(
      fetch(request).catch(() => caches.match("/offline").then((r) => r || Response.error())),
    );
    return;
  }

  // Static assets can come from cache. Next fingerprints its own chunks, so a
  // new build asks for new URLs and never collides with these entries.
  if (url.pathname.startsWith("/icons/") || url.pathname === "/manifest.webmanifest") {
    event.respondWith(
      caches.match(request).then(
        (hit) =>
          hit ||
          fetch(request).then((response) => {
            const copy = response.clone();
            caches.open(VERSION).then((cache) => cache.put(request, copy));
            return response;
          }),
      ),
    );
  }
});
