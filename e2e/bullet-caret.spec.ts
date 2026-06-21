import { test, expect, type Page } from "@playwright/test"

// FEAT-0019: the list marker is rendered by a widget that replaces the `* `/`- `
// run (not a hidden run with a `::before` glyph drawn over it), and a bare marker
// stays visible until a trailing space completes it. Together that keeps the caret
// and the bullet glyph in sync as the marker is typed. These tests exercise the
// real CodeMirror rendering and the genuine FSA save path (an OPFS handle), which
// happy-dom can't.

const FOLDER = "e2e-bullet-caret-folder"

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
const renderedText = (page: Page) => editor(page).innerText()

async function type(page: Page, text: string) {
  await editor(page).click()
  await page.keyboard.type(text)
}

test.beforeEach(async ({ page }) => {
  await stubPicker(page)
  await page.goto("/brulion/")
  // A folder must be open for the editor to be reachable (the welcome screen,
  // FEAT-0031, covers it until then).
  await page.locator("#open-folder").click()
})

test("a bare marker stays visible, then a space turns it into a bullet (AC-2)", async ({
  page,
}) => {
  await type(page, "*")
  // No trailing space yet: the `*` is a literal visible char and no bullet widget
  // is drawn. (The old hide-plus-`::before` rendering hid the bare `*` and showed
  // a `•` here — the exact source of the caret/glyph drift.)
  expect(await renderedText(page)).toContain("*")
  await expect(page.locator(".cm-bullet")).toHaveCount(0)

  // The completing space replaces the `* ` run with the bullet widget; the literal
  // `*` is gone and a single disc bullet is drawn.
  await page.keyboard.type(" ")
  await expect(page.locator(".cm-bullet-disc")).toHaveCount(1)
  expect(await renderedText(page)).not.toContain("*")
})

test("typing at the item-text start inserts into the text, after the marker (AC-4)", async ({
  page,
}) => {
  await type(page, "* item")
  // Move the caret to the start of the item text (offset after the `* ` run):
  // four lefts from the end of "item". Typing there inserts into the item, and the
  // marker stays put — it does not pop back to the line start.
  for (let i = 0; i < 4; i++) await page.keyboard.press("ArrowLeft")
  await page.keyboard.type("X")
  await page.keyboard.press("Control+s")

  await expect.poll(() => readStartMd(page)).toBe("* Xitem")
})

test("rendering a bullet does not alter the saved bytes (AC-5)", async ({ page }) => {
  await type(page, "* item")
  await page.keyboard.press("Control+s")

  await expect.poll(() => readStartMd(page)).toBe("* item")
})

test("Backspace after a completed bullet removes only the space, leaving the marker (AC-6)", async ({
  page,
}) => {
  await type(page, "- ")
  await page.keyboard.press("Backspace") // deletes the trailing space, not the dash
  await page.keyboard.press("Control+s")
  await expect.poll(() => readStartMd(page)).toBe("-")

  // A second Backspace then removes the bare marker itself.
  await page.keyboard.press("Backspace")
  await page.keyboard.press("Control+s")
  await expect.poll(() => readStartMd(page)).toBe("")
})

test("Backspace symmetry leaves a bullet marker before its content (AC-6)", async ({
  page,
}) => {
  await type(page, "- x")
  await page.keyboard.press("ArrowLeft") // caret between the marker run and "x"
  await page.keyboard.press("Backspace")
  await page.keyboard.press("Control+s")
  await expect.poll(() => readStartMd(page)).toBe("-x")
})

test("Backspace symmetry applies to heading and blockquote markers (AC-7)", async ({
  page,
}) => {
  await type(page, "# ")
  await page.keyboard.press("Backspace")
  await page.keyboard.press("Control+s")
  await expect.poll(() => readStartMd(page)).toBe("#")

  // Clear the line, then a blockquote marker.
  await page.keyboard.press("Backspace") // remove the "#"
  await type(page, "> ")
  await page.keyboard.press("Backspace")
  await page.keyboard.press("Control+s")
  await expect.poll(() => readStartMd(page)).toBe(">")
})
