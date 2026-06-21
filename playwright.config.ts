import { defineConfig, devices } from "@playwright/test"

// End-to-end tests run the real app in real Chromium. They cover everything the
// happy-dom unit tests can't: real CodeMirror, real IndexedDB, and — by stubbing
// window.showDirectoryPicker with an OPFS handle — the real File System Access
// read/write/list/save paths. The native OS picker + permission prompt remain
// the only manually-verified surface.
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  reporter: "list",
  use: {
    baseURL: "http://localhost:5173",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  // Two servers: the dev server for the bulk of the suite (fast feedback, no
  // service worker — registration is production-only, FEAT-0029), and a
  // production preview server for the offline PWA test, which needs the real
  // built shell + the worker. Specs that need preview navigate to its absolute
  // URL (http://localhost:4173/brulion/) rather than the dev baseURL.
  webServer: [
    {
      command: "npm run dev",
      url: "http://localhost:5173/brulion/",
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    {
      // Production build + preview for the offline PWA test. reuseExistingServer
      // is off on CI so the worker is always validated against a fresh build,
      // never a stale dist/ left running on 4173 (a false-green footgun).
      command: "npm run build && npm run preview -- --port 4173 --strictPort",
      url: "http://localhost:4173/brulion/",
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
})
