import { test, expect } from "@playwright/test"

// FEAT-0030 AC-5 — the Install button is hidden until the app is installable.
// `beforeinstallprompt` won't fire naturally in a test (no real install heuristic),
// so we synthesize one on window: a plain Event with the two methods the handler
// uses. Runs on the dev server — the install wiring is not production-gated.
test("the Install button is hidden until beforeinstallprompt fires", async ({ page }) => {
  await page.goto("/brulion/")
  await expect(page.locator(".cm-editor")).toBeVisible()

  await expect(page.locator("#install-app")).toBeHidden()

  await page.evaluate(() => {
    const event = new Event("beforeinstallprompt") as Event & {
      prompt?: () => void
    }
    event.preventDefault = () => {}
    event.prompt = () => {}
    window.dispatchEvent(event)
  })

  await expect(page.locator("#install-app")).toBeVisible()
})
