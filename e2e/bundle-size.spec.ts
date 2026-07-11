import { test, expect } from "@playwright/test"

// Guards against a regression this repo already hit once: a manualChunks
// grouping (or any future chunking change) accidentally forcing a heavy,
// meant-to-be-lazy dependency (Mermaid/KaTeX/Cytoscape/Wardley — each in the
// hundreds of kB) into the code path the browser fetches unconditionally on
// every cold load. `vite.config.ts`'s `modulePreload.resolveDependencies`
// filters those out of the HTML `<link rel=modulepreload>` list by package
// name, but that's a filename-pattern guard — it can't see a future dependency
// bump or refactor that folds the same code into a generically-named chunk. A
// byte-budget check on what actually downloads is a filename-agnostic backstop:
// whatever the build shapes chunks into, a folder-less cold load must stay
// small. Runs against the PRODUCTION preview server (port 4173) — chunking is
// a build-only concern, invisible on the unbundled dev server.
const PREVIEW = "http://localhost:4173/brulion/"

// Generous relative to the current main entry (~860kB uncompressed, ~291kB
// gzip): enough headroom for normal growth, nowhere near enough to hide an
// accidental multi-hundred-kB heavy dependency (Mermaid alone is ~2.8MB
// uncompressed / ~765kB gzip).
const MAX_COLD_LOAD_JS_BYTES = 1_500_000

test("a folder-less cold load never downloads a heavy lazy dependency by accident", async ({ page }) => {
  let totalBytes = 0
  page.on("response", async (res) => {
    if (!res.url().endsWith(".js")) return
    const body = await res.body().catch(() => null) // a failed/aborted request contributes nothing
    if (body) totalBytes += body.length
  })

  await page.goto(PREVIEW, { waitUntil: "networkidle" })
  await expect(page.locator(".cm-editor")).toBeVisible()

  expect(totalBytes).toBeLessThan(MAX_COLD_LOAD_JS_BYTES)
})
