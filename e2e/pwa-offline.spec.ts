import { test, expect } from "@playwright/test"

// FEAT-0029 AC-4 — the offline app shell. Runs against the PRODUCTION preview
// server (port 4173), not the dev server: the service worker is registered only
// in production builds, and only a real built shell (single hashed JS/CSS bundle)
// can be cached and replayed offline. Each Playwright test gets its own context,
// so going offline here never leaks into the rest of the suite.
const PREVIEW = "http://localhost:4173/brulion/"

test("app shell loads offline after one online visit", async ({ page, context }) => {
  // 1. First online visit — the worker registers and activates.
  await page.goto(PREVIEW)
  await expect(page.locator(".cm-editor")).toBeVisible()
  // Wait for activation without returning the (non-serializable) registration.
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready
  })

  // 2. Reload while online so the now-controlling worker caches the navigation
  //    document and the hashed assets it serves.
  await page.reload()
  await expect(page.locator(".cm-editor")).toBeVisible()
  expect(await page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true)

  // 3. Go offline and reload — the shell must come entirely from the cache.
  await context.setOffline(true)
  await page.reload()

  await expect(page.locator("#open-folder")).toBeVisible()
  await expect(page.locator(".cm-editor")).toBeVisible()

  await context.setOffline(false)
})
