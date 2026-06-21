---
id: FEAT-0029
title: Service worker offline app shell
status: draft
depends_on: [FEAT-0028]
---

## Intent

Make Brulion's app shell load with no network, and tip it over the browser's
installability bar (manifest from FEAT-0028 + an offline-capable service worker).
After one online visit, opening the app offline still mounts the editor. The
service worker caches only the app's own static build output; the user's notes go
through the File System Access API (never `fetch`), so they are categorically
outside the cache — the moat (plain `.md` files the user owns) is untouched.

## Behavior

**A hand-rolled service worker** ships as `public/sw.js` (Vite copies it verbatim
to the build root, served at `${BASE_URL}sw.js` under the `/brulion/` Pages base).
No PWA build plugin / Workbox.

**Caching strategy, split by request type:**
- **Navigations (the HTML document) are network-first with a cache fallback.**
  Online, the latest document is fetched and cached, so a fresh deploy is picked
  up on the next online load; offline, the last-cached shell is served.
- **Same-origin GET static assets are cache-first.** The build's asset filenames
  are content-hashed (immutable), so serving from cache is always correct and a
  new deploy fetches new URLs. A cache miss falls through to network and is then
  cached.

**Cache versioning.** The cache name carries a version; the `activate` handler
deletes every other cache. `install` calls `skipWaiting()` and `activate` calls
`clients.claim()` so an updated worker takes control promptly.

**Pass-through.** Non-GET requests and cross-origin requests are not handled by
the worker (it doesn't call `respondWith`), so they hit the network normally.

**Registration** happens from the app (`main.ts` via a small `pwa.ts` helper)
**only in production builds** (`import.meta.env.PROD`). The Vite dev server serves
unbundled modules and an HMR client that the worker should not cache, and skipping
registration in dev keeps the existing dev-server e2e suite byte-identical to
pre-PWA behavior; the offline path is exercised against `vite preview` (a real
production build). Registration is guarded for browsers without
`navigator.serviceWorker` and a failed registration never breaks boot.

## Constraints

- **Moat untouched.** The worker caches only static app assets. The File System
  Access API does not use `fetch`, so the user's notes never enter the cache; no
  app-private copy of user data is created.
- **No M1–M8 regression.** Because registration is production-only, the dev-server
  e2e tests run with no worker at all — identical to before. The worker's
  network-first navigation keeps the app fresh online across deploys.
- **Lean.** A few dozen lines of plain JS, no build plugin, runtime caching (no
  build-time precache manifest to keep in sync with hashed filenames).
- **Base path.** The worker URL and its `scope` are `${BASE_URL}` (`/brulion/`),
  not the domain root.

## Out of scope

- The `beforeinstallprompt` capture / in-app Install button (FEAT-0030).
- Background sync, push, periodic updates, "new version available" toasts.
- Caching or syncing the user's notes (an app-private second copy — moat-forbidden).

## Acceptance criteria

**AC-1** — Registration is production-only and base-correct.
Given the `registerServiceWorker(navigator, base, enabled)` helper,
When called with `enabled = false`,
Then it does not call `navigator.serviceWorker.register`; and when called with
`enabled = true` on a navigator that has `serviceWorker`, it registers
`` `${base}sw.js` `` with `{ scope: base }`.

**AC-2** — Registration degrades safely without service-worker support.
Given a navigator with no `serviceWorker`,
When `registerServiceWorker(navigator, base, true)` is called,
Then it returns without throwing and registers nothing.

**AC-3** — The worker file ships under the base in the build output.
Given a completed `npm run build`,
When `dist/` is listed,
Then `dist/sw.js` exists (so it is served at `${BASE_URL}sw.js`).

**AC-4** — The app shell loads offline after one online visit.
Given the production build served by `vite preview`, visited once online so the
worker activates and caches the shell,
When the browser context goes offline and the page reloads,
Then the editor (`.cm-editor`) and the "Open folder" control still mount.

**AC-5** — User file paths are unaffected.
Given the existing dev-server e2e suite (open/switch/create/delete, autosave,
poller, links, tree, Vim),
When it runs after this change,
Then every spec still passes (the worker is not registered in dev, so behavior is
unchanged).
