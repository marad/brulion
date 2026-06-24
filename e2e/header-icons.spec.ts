import { test, expect, type Page } from "@playwright/test"

// FEAT-0055 (M27 P2): the header icons come from Lucide (class "header-icon"),
// replacing the hand-authored gear SVG and the ☰ glyph, and the two icon buttons
// share one height and one icon size. Each test uses its own OPFS folder.

async function openFolder(page: Page, folder: string) {
  await page.addInitScript((f) => {
    window.showDirectoryPicker = async () => {
      const root = await navigator.storage.getDirectory()
      return await root.getDirectoryHandle(f, { create: true })
    }
  }, folder)
  await page.goto("/brulion/")
  await page.locator("#open-folder").click()
  await expect(page.locator("#note-identity")).toBeVisible()
}

test("the gear and the sidebar toggle are Lucide icons (AC-1, AC-2)", async ({ page }) => {
  await openFolder(page, "e2e-hdr-icons")

  await expect(page.locator("#open-settings svg.header-icon")).toBeVisible()
  await expect(page.locator("#toggle-sidebar svg.header-icon")).toBeVisible()
  // The ☰ glyph is gone (the toggle now renders an icon, not text).
  await expect(page.locator("#toggle-sidebar")).not.toContainText("☰")
})

test("the two icon buttons share one height and icon size (AC-3, AC-4)", async ({ page }) => {
  await openFolder(page, "e2e-hdr-size")

  const gearBtn = (await page.locator("#open-settings").boundingBox())!
  const toggleBtn = (await page.locator("#toggle-sidebar").boundingBox())!
  expect(Math.abs(gearBtn.height - toggleBtn.height)).toBeLessThanOrEqual(0.5)

  const gearIcon = (await page.locator("#open-settings svg").boundingBox())!
  const toggleIcon = (await page.locator("#toggle-sidebar svg").boundingBox())!
  expect(Math.abs(gearIcon.width - toggleIcon.width)).toBeLessThanOrEqual(0.5)
  expect(Math.abs(gearIcon.height - toggleIcon.height)).toBeLessThanOrEqual(0.5)
})

test("the icon buttons keep their behavior (AC-5)", async ({ page }) => {
  await openFolder(page, "e2e-hdr-behavior")

  // The gear still opens the settings modal.
  await page.locator("#open-settings").click()
  await expect(page.locator("#settings-backdrop")).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(page.locator("#settings-backdrop")).toBeHidden()

  // The toggle still flips its aria-pressed state.
  const toggle = page.locator("#toggle-sidebar")
  const before = await toggle.getAttribute("aria-pressed")
  await toggle.click()
  expect(await toggle.getAttribute("aria-pressed")).not.toBe(before)
})
