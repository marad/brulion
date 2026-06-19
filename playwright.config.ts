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
  webServer: {
    command: "npm run dev",
    url: "http://localhost:5173/brulion/",
    reuseExistingServer: true,
    timeout: 60_000,
  },
})
