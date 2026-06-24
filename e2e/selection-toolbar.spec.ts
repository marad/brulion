import { test, expect, type Page } from "@playwright/test"

// M17 P2 (FEAT-0052): a floating formatting toolbar over a non-empty selection in a
// touch/narrow context, reusing the FEAT-0007 transforms; absent on desktop mouse.

const FOLDER = "e2e-selection-toolbar"

async function stubPicker(page: Page) {
  await page.addInitScript((folder) => {
    window.showDirectoryPicker = async () => {
      const root = await navigator.storage.getDirectory()
      return await root.getDirectoryHandle(folder, { create: true })
    }
  }, FOLDER)
}

async function readStartMd(page: Page): Promise<string | null> {
  return await page.evaluate(async (folder) => {
    const root = await navigator.storage.getDirectory()
    const dir = await root.getDirectoryHandle(folder, { create: true })
    try {
      return await (await (await dir.getFileHandle("start.md")).getFile()).text()
    } catch {
      return null
    }
  }, FOLDER)
}

const editor = (page: Page) => page.locator(".cm-content")
const toolbar = (page: Page) => page.locator(".cm-selection-toolbar")

async function openAndType(page: Page, text: string) {
  await stubPicker(page)
  await page.goto("/brulion/")
  await page.locator("#open-folder").click()
  await expect(page.locator("#open-settings")).toBeVisible() // workspace shown (folder open)
  // The narrow drawer starts closed (M17 review), so the editor is unobstructed and
  // freely interactive without collapsing anything.
  await editor(page).click()
  await page.keyboard.type(text)
}

test.describe("touch / narrow context", () => {
  test.use({ viewport: { width: 375, height: 700 } })

  test("a non-empty selection shows the toolbar; collapsing hides it (AC-1)", async ({ page }) => {
    await openAndType(page, "word")
    await page.keyboard.press("Shift+Home") // select "word"
    await expect(toolbar(page)).toBeVisible()

    await page.keyboard.press("End") // collapse the selection
    await expect(toolbar(page)).not.toBeVisible()
  })

  test("tapping Bold wraps the selection in ** (AC-2)", async ({ page }) => {
    await openAndType(page, "word")
    await page.keyboard.press("Shift+Home")
    await expect(toolbar(page)).toBeVisible()

    await toolbar(page).locator('button[aria-label="Bold"]').click()
    await page.keyboard.press("Control+s")
    await expect.poll(() => readStartMd(page)).toBe("**word**")
  })

  test("tapping H2 sets the line to a level-2 heading (AC-3)", async ({ page }) => {
    await openAndType(page, "Title")
    await page.keyboard.press("Shift+Home")
    await expect(toolbar(page)).toBeVisible()

    await toolbar(page).locator('button[aria-label="Heading 2"]').click()
    await page.keyboard.press("Control+s")
    await expect.poll(() => readStartMd(page)).toBe("## Title")
  })
})

test.describe("desktop mouse (wide viewport)", () => {
  test.use({ viewport: { width: 1280, height: 800 } })

  test("the toolbar never appears (AC-4)", async ({ page }) => {
    await openAndType(page, "word")
    await page.keyboard.press("Shift+Home") // a real selection
    await expect(editor(page)).toBeFocused()
    // No floating toolbar on a fine-pointer wide viewport — right-click/shortcuts stay.
    await expect(toolbar(page)).toHaveCount(0)
  })
})
