import { test, expect, type Page } from "@playwright/test"

// FEAT-0046: Vim's yank stores text in its own register (no DOM copy event), so
// the FEAT-0045 clipboard fix didn't reach it — visual-mode `y` dropped the hidden
// boundary markup. These tests drive real Vim in real Chromium: yank a visible
// fragment, paste it back, and assert the pasted bytes carry the repaired markdown.
// The serializer itself is unit-tested in src/copy-markdown.test.ts.

const FOLDER = "e2e-vim-yank-folder"

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
const vimToggle = (page: Page) => page.locator("#toggle-vim")

async function enableVimAndFocus(page: Page) {
  await vimToggle(page).click()
  await expect(vimToggle(page)).toHaveAttribute("aria-pressed", "true")
  await editor(page).click()
  await expect(page.locator(".cm-vimMode")).toBeVisible()
}

/** In normal mode, type `text` (entering insert with `i`) and return to normal. */
async function seedLine(page: Page, text: string) {
  await page.keyboard.press("i")
  await page.keyboard.type(text)
  await page.keyboard.press("Escape")
}

test.beforeEach(async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"])
  await stubPicker(page)
  await page.goto("/brulion/")
  await page.locator("#open-folder").click()
})

test("visual yank of a heading's visible text pastes a heading (AC-1)", async ({ page }) => {
  await enableVimAndFocus(page)
  await seedLine(page, "# Heading")
  // Select the visible heading text: `0` lands on `H` (past the hidden `# `), `v$`
  // extends to the line end.
  await page.keyboard.press("0")
  await page.keyboard.press("v")
  await page.keyboard.press("$")
  await page.keyboard.press("y") // yank → register holds the serialized markdown
  // Paste onto a fresh line below and read the saved bytes.
  await page.keyboard.press("o")
  await page.keyboard.press("Escape")
  await page.keyboard.press("p")
  await page.keyboard.press("Control+s")
  await expect.poll(() => readStartMd(page)).toBe("# Heading\n# Heading")
})

test("visual yank of a bold fragment pastes it wrapped in '**' (AC-2)", async ({ page }) => {
  await enableVimAndFocus(page)
  await seedLine(page, "x **bold** y")
  await page.keyboard.press("0")
  await page.keyboard.press("f") // move to the 'b' of "bold"
  await page.keyboard.press("b")
  await page.keyboard.press("v")
  await page.keyboard.press("i")
  await page.keyboard.press("w") // `viw` → select inner word "bold"
  await page.keyboard.press("y")
  await page.keyboard.press("o")
  await page.keyboard.press("Escape")
  await page.keyboard.press("p")
  await page.keyboard.press("Control+s")
  await expect.poll(() => readStartMd(page)).toBe("x **bold** y\n**bold**")
})

test("yank to the clipboard register puts serialized markdown on the system clipboard (AC-3)", async ({
  page,
}) => {
  await enableVimAndFocus(page)
  await seedLine(page, "# Heading")
  await page.keyboard.press("0")
  await page.keyboard.press("v")
  await page.keyboard.press("$")
  await page.keyboard.type('"+y') // yank to the `+` (clipboard) register
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(
    "# Heading",
  )
})
