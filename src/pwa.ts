/**
 * Register the offline service worker (FEAT-0029).
 *
 * Production-only by design: the caller passes `enabled = import.meta.env.PROD`.
 * The Vite dev server serves unbundled modules and an HMR client that the worker
 * should not cache, and skipping registration in dev keeps the existing
 * dev-server e2e suite byte-identical to pre-PWA behavior. The offline path is
 * exercised against `vite preview` (a real production build).
 *
 * The user's notes go through the File System Access API, never `fetch`, so they
 * are categorically outside the worker's cache — the moat is untouched.
 */
export function registerServiceWorker(nav: Navigator, base: string, enabled: boolean): void {
  if (!enabled) return
  if (!("serviceWorker" in nav)) return
  // Best-effort: a failed registration must not break boot.
  void nav.serviceWorker.register(`${base}sw.js`, { scope: base }).catch(() => {})
}
