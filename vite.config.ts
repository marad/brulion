import { defineConfig } from "vitest/config"

/** Keep the declaration artifact a text response in local/preview HTTP checks.
 * Vite's MIME table classifies `.d.ts` as video/mp2t; the artifact is a text
 * editor/type-hint surface, so intercept only this one generated file and leave
 * the rest of the static server untouched. GitHub Pages still serves the same
 * immutable bytes; this keeps the production-preview contract honest. */
const declarationTextPlugin = {
  name: "brulion-declaration-text",
  configureServer(server: any) {
    server.middlewares.use((req: any, res: any, next: () => void) => {
      if ((req.url?.split("?", 1)[0] ?? "").endsWith("/brulion-extension.d.ts")) {
        res.setHeader("Content-Type", "text/plain; charset=utf-8")
      }
      next()
    })
  },
  configurePreviewServer(server: any) {
    server.middlewares.use((req: any, res: any, next: () => void) => {
      if ((req.url?.split("?", 1)[0] ?? "").endsWith("/brulion-extension.d.ts")) {
        res.setHeader("Content-Type", "text/plain; charset=utf-8")
      }
      next()
    })
  },
}

// GitHub Pages serves this project site under /brulion/, so assets must be
// resolved relative to that sub-path rather than the domain root.
export default defineConfig({
  plugins: [declarationTextPlugin],
  base: "/brulion/",
  build: {
    modulePreload: {
      // Vite's default modulePreload polyfill eagerly fetches the direct
      // dynamic-import dependencies of the entry graph — which included the
      // "mermaid" chunk below (764kB gzip) on *every* cold load, diagram or not,
      // silently undoing the on-demand intent the manualChunks split below states.
      // Only strip the chunks meant to stay on-demand; anything else keeps Vite's
      // default preloading.
      resolveDependencies: (_filename, deps) =>
        deps.filter((dep) => !/[\\/](mermaid|cytoscape|cose-|layout-base|katex|elkjs|dagre|wardley)/.test(dep)),
    },
    rollupOptions: {
      input: {
        main: "index.html",
        workbench: "workbench.html",
        api: "api.html",
      },
      output: {
        // Heavy diagram deps stay separate-lazy chunks (only fetched when their
        // diagram type is actually used): cytoscape (mindmap/architecture) + its
        // layouts, katex (math), the Wardley map, ELK/dagre layout engines. A prior
        // version of this also forced Mermaid's ~160 tiny internal per-diagram
        // chunks into one big manual "mermaid" bucket to cut GitHub Pages' per-file
        // deploy overhead (~30s → ~6min) — but that grouping made Rollup hoist a
        // shared binding out of Mermaid's own code into a STATIC top-level import
        // in the main entry chunk, so the whole 764kB-gzip bundle loaded on every
        // page view regardless of whether any note used a diagram (found via a CDP
        // initiator trace on a folder-less cold load). `experimentalMinChunkSize`
        // gets the same few-small-files win by merging small chunks by size, not by
        // forcing unrelated modules to share one chunk — so it can't manufacture
        // that kind of cross-chunk static dependency.
        experimentalMinChunkSize: 20_000,
        manualChunks(id) {
          if (!id.includes("node_modules")) return
          if (/[\\/](cytoscape|cose-base|cose-bilkent|layout-base|katex|elkjs|@?dagre)/.test(id)) {
            return
          }
          if (/[\\/]wardley/.test(id)) return
        },
      },
    },
  },
  test: {
    environment: "happy-dom",
    include: ["src/**/*.test.ts"], // unit tests only; e2e/ is Playwright's
    // A couple of syntax-tree-dependent tests (mermaid/clearFormatting) build a
    // CodeMirror state and force an incremental parse; under heavy parallel-suite CPU
    // contention that parse can occasionally come back short, flaking the assertion.
    // The product is unaffected (its decoration fields rebuild as the parser
    // progresses). Retry absorbs the environmental flake without masking real bugs —
    // a genuine failure still fails all attempts.
    retry: 2,
  },
})
