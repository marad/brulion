import { test, expect, type Page } from "@playwright/test"

const FOLDER = "e2e-context-menu-folder"

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
const cmenu = (page: Page) => page.locator(".cm-context-menu")
const item = (page: Page, label: string) =>
  page.locator(".cm-context-menu button", { hasText: label })

async function openMenu(page: Page) {
  await editor(page).click({ button: "right" })
  await expect(cmenu(page)).toBeVisible()
}

test.beforeEach(async ({ page }) => {
  await stubPicker(page)
  await page.goto("/brulion/")
  await page.locator("#open-folder").click()
  await editor(page).click()
})

test("right-click opens the custom formatting menu (AC-1)", async ({ page }) => {
  await page.keyboard.type("hello")
  await openMenu(page)
  await expect(page.locator(".cm-context-menu button")).toHaveText([
    "Bold",
    "Italic",
    "Code",
    "Heading 1",
    "Heading 2",
    "Heading 3",
    "Clear formatting",
  ])
})

test("Heading 2 applies to every line of a multi-line selection (AC-2)", async ({
  page,
}) => {
  await page.keyboard.type("a\nb\nc")
  await page.keyboard.press("Control+a")
  await openMenu(page)
  await item(page, "Heading 2").click()

  await page.keyboard.press("Control+s")
  await expect.poll(() => readStartMd(page)).toBe("## a\n## b\n## c")
})

test("Bold wraps the selection (AC-3)", async ({ page }) => {
  await page.keyboard.type("word")
  await page.keyboard.press("Control+a")
  await openMenu(page)
  await item(page, "Bold").click()

  await page.keyboard.press("Control+s")
  await expect.poll(() => readStartMd(page)).toBe("**word**")
})

test("Bold across multiple lines stays valid markdown (per-line)", async ({
  page,
}) => {
  // Wrapping the whole span would write `**a\nb**` (straddles block boundaries,
  // invalid CommonMark). Each line must be wrapped on its own.
  await page.keyboard.type("a\nb")
  await page.keyboard.press("Control+a")
  await openMenu(page)
  await item(page, "Bold").click()

  await page.keyboard.press("Control+s")
  await expect.poll(() => readStartMd(page)).toBe("**a**\n**b**")
})

test("Clear formatting strips headings across the selection (AC-4)", async ({
  page,
}) => {
  await page.keyboard.type("# one\n## two")
  await page.keyboard.press("Control+a")
  await openMenu(page)
  await item(page, "Clear formatting").click()

  await page.keyboard.press("Control+s")
  await expect.poll(() => readStartMd(page)).toBe("one\ntwo")
})

test("Esc dismisses the menu without changing the document (AC-5)", async ({
  page,
}) => {
  await page.keyboard.type("keep me")
  await openMenu(page)
  await page.keyboard.press("Escape")
  await expect(cmenu(page)).toBeHidden()

  await page.keyboard.press("Control+s")
  await expect.poll(() => readStartMd(page)).toBe("keep me")
})

test("clicking outside dismisses the menu (AC-5)", async ({ page }) => {
  await page.keyboard.type("text")
  await openMenu(page)
  await page.locator("header").click()
  await expect(cmenu(page)).toBeHidden()
})
