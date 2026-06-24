/**
 * Lazy Mermaid loader (FEAT-0056). Imports the Mermaid library on first use and
 * initializes it once, then renders a diagram source to an SVG string. Kept in its
 * own module so Vite splits Mermaid into a separate chunk, absent from the main
 * bundle — the runtime-caching service worker (FEAT-0029) caches that chunk for
 * offline use after it's first fetched.
 */

type Mermaid = (typeof import("mermaid"))["default"]

// The load-once singleton: assigned on first call, awaited by concurrent callers.
// Cleared on a failed import so a diagram first viewed while briefly offline can
// retry once the chunk is reachable (see DECISIONS.md → M28).
let engine: Promise<Mermaid> | null = null

// Mints unique element ids for `mermaid.render` (it needs a unique id per call).
let counter = 0

function loadEngine(): Promise<Mermaid> {
  if (!engine) {
    engine = import("mermaid")
      .then((mod) => {
        const mermaid = mod.default
        // startOnLoad: we render manually. suppressErrorRendering: make `render`
        // REJECT on invalid input instead of painting Mermaid's own "bomb" error SVG,
        // so the widget shows our in-place error box (FEAT-0056 AC-5).
        mermaid.initialize({ startOnLoad: false, suppressErrorRendering: true })
        return mermaid
      })
      .catch((err) => {
        engine = null // clear so a later call retries the import
        throw err
      })
  }
  return engine
}

/**
 * Render a Mermaid diagram `source` to an SVG string.
 *
 * Loads + initializes Mermaid on the first call (a single cached promise shared by
 * concurrent callers). The load promise is cached on success (load-once) and cleared
 * on failure. Rejects if `source` fails to parse/render, or if the engine import
 * fails.
 */
export async function renderMermaid(source: string): Promise<string> {
  const mermaid = await loadEngine()
  // Validate first: `parse` rejects on invalid syntax (deterministically, unlike
  // `render`, which can paint an error graphic), so the widget's catch fires its
  // in-place error box (FEAT-0056 AC-5).
  await mermaid.parse(source)
  const { svg } = await mermaid.render(`brulion-mermaid-${counter++}`, source)
  return svg
}
