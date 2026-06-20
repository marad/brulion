import { test, expect, type Page } from "@playwright/test"

const FOLDER = "e2e-slash-folder"

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
const options = (page: Page) => page.locator(".cm-tooltip-autocomplete li")

/** Accept a slash command by clicking its menu entry. (Clicking applies the
 * completion directly via CodeMirror's tooltip handler, so it's deterministic —
 * unlike pressing Enter, whose accept-vs-newline outcome can race the menu's
 * selection state under heavy parallel load.) */
async function accept(page: Page, label: string) {
  await options(page).filter({ hasText: label }).click()
  await expect(menu(page)).toBeHidden()
}

test.beforeEach(async ({ page }) => {
  await stubPicker(page)
  await page.goto("/brulion/")
  await page.locator("#open-folder").click()
  await editor(page).click()
})

test("typing '/' at line start opens the slash menu (AC-1)", async ({ page }) => {
  await page.keyboard.type("/")
  await expect(menu(page)).toBeVisible()
  await expect(options(page)).toHaveCount(4)
})

test("the menu filters as you type (AC-2)", async ({ page }) => {
  await page.keyboard.type("/h")
  await expect(menu(page)).toBeVisible()
  await expect(options(page)).toHaveCount(3) // h1, h2, h3 — not /clear
  await expect(options(page)).toContainText(["/h1", "/h2", "/h3"])
})

test("accepting /h2 makes the line an H2 and drops the token (AC-3)", async ({
  page,
}) => {
  await page.keyboard.type("/h2")
  await expect(menu(page)).toBeVisible()
  await accept(page, "/h2")

  await page.keyboard.type("Title")
  await page.keyboard.press("Control+s")
  await expect.poll(() => readStartMd(page)).toBe("## Title")
})

test("/clear strips the heading back to a paragraph (AC-4)", async ({ page }) => {
  // Build a heading first via /h1.
  await page.keyboard.type("/h1")
  await expect(menu(page)).toBeVisible()
  await accept(page, "/h1")
  await page.keyboard.type("Heading")
  await page.keyboard.press("Control+s")
  await expect.poll(() => readStartMd(page)).toBe("# Heading")

  // Go to the true line start (before the hidden, atomic "# ") and run /clear.
  await page.keyboard.press("Home")
  await page.keyboard.press("ArrowLeft")
  await page.keyboard.type("/clear")
  await expect(menu(page)).toBeVisible()
  await accept(page, "/clear")

  await page.keyboard.press("Control+s")
  await expect.poll(() => readStartMd(page)).toBe("Heading")
})

test("Esc dismisses the menu and leaves the typed text (AC-5)", async ({
  page,
}) => {
  await page.keyboard.type("/h")
  await expect(menu(page)).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(menu(page)).toBeHidden()

  await page.keyboard.press("Control+s")
  await expect.poll(() => readStartMd(page)).toBe("/h") // text stays, no reshape
})

test("a slash after a space opens the menu; inside a word/URL it does not (AC-6)", async ({
  page,
}) => {
  // Inside a word: no menu.
  await page.keyboard.type("and/")
  await expect(menu(page)).toBeHidden()

  // After a space: the menu opens.
  await page.keyboard.press("End")
  await page.keyboard.type(" /h")
  await expect(menu(page)).toBeVisible()
})

test("accepting a command preserves the rest of the line (AC-7)", async ({
  page,
}) => {
  await page.keyboard.type("note /h2")
  await expect(menu(page)).toBeVisible()
  await accept(page, "/h2")

  await page.keyboard.press("Control+s")
  await expect.poll(() => readStartMd(page)).toBe("## note ") // 'note' not wiped
})
