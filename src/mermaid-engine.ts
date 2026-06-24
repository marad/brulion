/**
 * Lazy Mermaid loader (FEAT-0056). Imports the Mermaid library on first use and
 * initializes it once, then renders a diagram source to an SVG string. Kept in its
 * own module so Vite splits Mermaid into a separate chunk, absent from the main
 * bundle — the runtime-caching service worker (FEAT-0029) caches that chunk for
 * offline use after it's first fetched.
 */

/**
 * Render a Mermaid diagram `source` to an SVG string.
 *
 * Loads + initializes Mermaid on the first call (a single cached promise shared by
 * concurrent callers). The load promise is cached on success (load-once) and cleared
 * on failure, so a diagram first viewed while briefly offline can retry the import
 * once the chunk is reachable. Rejects if `source` fails to parse/render, or if the
 * engine import fails.
 */
export function renderMermaid(source: string): Promise<string> {
  void source
  throw new Error("stub")
}
