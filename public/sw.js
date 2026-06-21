// Brulion service worker (FEAT-0029) — offline app shell.
//
// Scope is the GitHub Pages base (/brulion/); registered from src/pwa.ts only in
// production builds. Caches ONLY the app's own static build output. The user's
// notes are read/written via the File System Access API, never through `fetch`,
// so they are categorically outside this cache — the file-fidelity moat is
// untouched.
//
// Strategy:
//   - navigations (the HTML document): network-first, cache fallback — a fresh
//     deploy is picked up online, the last-cached shell opens offline.
//   - same-origin GET static assets: cache-first — their filenames are
//     content-hashed (immutable), so cache is always correct and a new deploy
//     simply fetches new URLs.

const VERSION = "brulion-cache-v1"

self.addEventListener("install", () => {
  // Take over as soon as installed; nothing to precache (runtime caching).
  self.skipWaiting()
})

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys()
      await Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))
      await self.clients.claim()
    })(),
  )
})

self.addEventListener("fetch", (event) => {
  const { request } = event
  // Only same-origin GETs are cacheable app assets; everything else (POST,
  // cross-origin) passes straight through to the network.
  if (request.method !== "GET") return
  if (new URL(request.url).origin !== self.location.origin) return

  if (request.mode === "navigate") {
    event.respondWith(networkFirst(event))
  } else {
    event.respondWith(cacheFirst(event))
  }
})

async function networkFirst(event) {
  const { request } = event
  const cache = await caches.open(VERSION)
  try {
    const response = await fetch(request)
    // waitUntil (not a bare put) so the cache write completes even if the page
    // is closed right after first paint — otherwise an immediate offline reload
    // could find nothing cached.
    if (response && response.ok) event.waitUntil(cache.put(request, response.clone()))
    return response
  } catch (err) {
    const cached = await cache.match(request)
    if (cached) return cached
    // Fall back to the cached app shell at the worker's scope root; ignoreSearch
    // so a navigation carrying a query string still resolves to the shell.
    const shell = await cache.match(self.registration.scope, { ignoreSearch: true })
    if (shell) return shell
    throw err
  }
}

async function cacheFirst(event) {
  const { request } = event
  const cache = await caches.open(VERSION)
  const cached = await cache.match(request)
  if (cached) return cached
  const response = await fetch(request)
  if (response && response.ok) event.waitUntil(cache.put(request, response.clone()))
  return response
}
