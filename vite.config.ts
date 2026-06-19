import { defineConfig } from "vitest/config"

// GitHub Pages serves this project site under /brulion/, so assets must be
// resolved relative to that sub-path rather than the domain root.
export default defineConfig({
  base: "/brulion/",
  test: {
    environment: "happy-dom",
    include: ["src/**/*.test.ts"], // unit tests only; e2e/ is Playwright's
  },
})
