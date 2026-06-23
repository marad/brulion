import { test, expect, type Page } from "@playwright/test"

// FEAT-0045: copy/cut re-serialize the selection to valid markdown. The default
// CodeMirror copy returns only the raw source *inside* the selection, dropping the
// hidden boundary markup (a heading's `# `, a bold span's `**`). These tests drive
// the real copy/cut path in real Chromium — real atomic-range selection snapping,
// real ClipboardEvent — and read the system clipboard back to confirm the markdown.
// The precise boundary-repair semantics are unit-tested in src/copy-markdown.test.ts;
// here we prove the end-to-end wiring through the browser.

const FOLDER = "e2e-copy-folder"

async function stubPicker(page: Page) {
  await page.addInitScript((folder) => {
    window.showDirectoryPicker = async () => {
      const root = await navigator.storage.getDirectory()
      return await root.getDirectoryHandle(folder, { create: true })
    }
  }, FOLDER)
}

const editor = (page: Page) => page.locator(".cm-content")
const readClipboard = (page: Page) => page.evaluate(() => navigator.clipboard.readText())

test.beforeEach(async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"])
  await stubPicker(page)
  await page.goto("/brulion/")
  await page.locator("#open-folder").click()
  await editor(page).click()
})

test("copying a heading's visible text keeps the '# ' marker", async ({ page }) => {
  await page.keyboard.type("# Hello world")
  // Select the visible heading text. Home/End snap around the atomic hidden `# `,
  // so the selection starts from the rendered text — the case that used to drop it.
  await page.keyboard.press("Shift+Home")
  await page.keyboard.press("Control+c")
  expect(await readClipboard(page)).toBe("# Hello world")
})

test("copying a bold word keeps its '**' delimiters", async ({ page }) => {
  await page.keyboard.type("x **bold** y")
  // The rendered bold text carries the cm-strong class; double-click selects the
  // word "bold" (the hidden `**` sit outside the selection).
  await page.locator(".cm-strong").dblclick()
  await page.keyboard.press("Control+c")
  expect(await readClipboard(page)).toBe("**bold**")
})

test("cutting a bold word copies valid markdown and removes the text", async ({ page }) => {
  await page.keyboard.type("x **bold** y")
  await page.locator(".cm-strong").dblclick()
  await page.keyboard.press("Control+x")
  expect(await readClipboard(page)).toBe("**bold**")
  // The selected word is gone from the document; the `**` it sat between remain
  // (they were never selected), so the file stays well-formed.
  await expect(editor(page)).not.toContainText("bold")
})
