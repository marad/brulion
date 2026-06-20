import { test, expect, type Page } from "@playwright/test"

const FOLDER = "e2e-continuation-folder"

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
      const handle = await dir.getFileHandle("start.md")
      return await (await handle.getFile()).text()
    } catch {
      return null
    }
  }, FOLDER)
}

const editor = (page: Page) => page.locator(".cm-content")
const menu = (page: Page) => page.locator(".cm-tooltip-autocomplete")

test.beforeEach(async ({ page }) => {
  await stubPicker(page)
  await page.goto("/brulion/")
  await page.locator("#open-folder").click()
  await editor(page).click()
})

test("Enter continues an unordered list (AC-1)", async ({ page }) => {
  await page.keyboard.type("* a")
  await page.keyboard.press("Enter")
  await page.keyboard.type("b")
  await page.keyboard.press("Control+s")
  await expect.poll(() => readStartMd(page)).toBe("* a\n* b")
})

test("Enter continues a blockquote (AC-2)", async ({ page }) => {
  await page.keyboard.type("> a")
  await page.keyboard.press("Enter")
  await page.keyboard.type("b")
  await page.keyboard.press("Control+s")
  await expect.poll(() => readStartMd(page)).toBe("> a\n> b")
})

test("Enter on an empty list item exits the list (AC-3)", async ({ page }) => {
  await page.keyboard.type("* a")
  await page.keyboard.press("Enter") // continues to "* "
  await page.keyboard.press("Enter") // empty item -> exit
  await page.keyboard.type("b")
  await page.keyboard.press("Control+s")
  // The empty marker is removed; "b" lands on a plain line, no stray "* ".
  await expect.poll(() => readStartMd(page)).toBe("* a\nb")
})

test("Enter on an empty blockquote line exits the quote (AC-4)", async ({ page }) => {
  await page.keyboard.type("> a")
  await page.keyboard.press("Enter") // continues to "> "
  await page.keyboard.press("Enter") // empty -> exit
  await page.keyboard.type("b")
  await page.keyboard.press("Control+s")
  await expect.poll(() => readStartMd(page)).toBe("> a\nb")
})

test("Enter on a plain line is unchanged (AC-5)", async ({ page }) => {
  await page.keyboard.type("a")
  await page.keyboard.press("Enter")
  await page.keyboard.type("b")
  await page.keyboard.press("Control+s")
  await expect.poll(() => readStartMd(page)).toBe("a\nb")
})

test("the slash menu still accepts on Enter, not a newline (AC-6)", async ({ page }) => {
  await page.keyboard.type("/h1")
  await expect(menu(page)).toBeVisible()
  // Wait until an option is actually highlighted — Enter only accepts once the
  // completion is selected; pressing it before that races into a newline (the
  // autocomplete's async activation, the same race slash.spec.ts dodges by
  // clicking). The brief settle lets the selection state commit under load.
  await expect(menu(page).locator("li[aria-selected='true']")).toBeVisible()
  await page.waitForTimeout(150)
  await page.keyboard.press("Enter") // accept the completion
  await expect(menu(page)).toBeHidden()
  await page.keyboard.type("Heading")
  await page.keyboard.press("Control+s")
  await expect.poll(() => readStartMd(page)).toBe("# Heading")
})
