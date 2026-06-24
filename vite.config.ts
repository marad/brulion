import { defineConfig } from "vitest/config"

// GitHub Pages serves this project site under /brulion/, so assets must be
// resolved relative to that sub-path rather than the domain root.
export default defineConfig({
  base: "/brulion/",
  build: {
    rollupOptions: {
      output: {
        // Mermaid (lazy-loaded, M28) otherwise splits into ~160 tiny per-diagram
        // chunks — and GitHub Pages' publish step has per-file overhead, so the
        // deploy ballooned from ~30s to ~6min. Collapse Mermaid's core + its many
        // light diagram definitions into one lazy `mermaid` chunk to cut the file
        // count, while leaving the genuinely-heavy, rarely-used deps as their own
        // on-demand chunks so a simple flowchart never downloads them.
        manualChunks(id) {
          if (!id.includes("node_modules")) return
          // Heavy diagram deps stay separate-lazy (only fetched when their diagram
          // type is actually used): cytoscape (mindmap/architecture) + its layouts,
          // katex (math), the Wardley map, ELK/dagre layout engines.
          if (/[\\/](cytoscape|cose-base|cose-bilkent|layout-base|katex|elkjs|@?dagre)/.test(id)) {
            return
          }
          if (/[\\/]wardley/.test(id)) return
          if (id.includes("mermaid")) return "mermaid"
        },
      },
    },
  },
  test: {
    environment: "happy-dom",
    include: ["src/**/*.test.ts"], // unit tests only; e2e/ is Playwright's
  },
})
