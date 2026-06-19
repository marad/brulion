import { test, expect } from "@playwright/test"

test("app shell loads with the editor and Open folder button", async ({ page }) => {
  await page.goto("/brulion/")

  await expect(page.locator("#open-folder")).toBeVisible()
  await expect(page.locator("#resume-access")).toBeHidden()
  await expect(page.locator(".cm-editor")).toBeVisible()
})
