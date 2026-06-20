import { test, expect, type Page } from "@playwright/test"

// FEAT-0021: opt-in Vim mode must not break the editor's own commands. These
// tests need the real @replit/codemirror-vim plugin and real key handling —
// happy-dom can't exercise Vim's mode machine or the keymap precedence.

const FOLDER = "e2e-vim-folder"

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
const menu = (page: Page) => page.locator(".cm-tooltip-autocomplete")
const option = (page: Page, label: string) =>
  page.locator(".cm-tooltip-autocomplete li").filter({ hasText: label })

/** Enable Vim and focus the editor (which lands in Vim normal mode). */
async function enableVimAndFocus(page: Page) {
  await vimToggle(page).click()
  await expect(vimToggle(page)).toHaveAttribute("aria-pressed", "true")
  await editor(page).click()
  await expect(page.locator(".cm-vimMode")).toBeVisible() // normal mode engaged
}

test.beforeEach(async ({ page }) => {
  await stubPicker(page)
  await page.goto("/brulion/")
  await page.locator("#open-folder").click()
})

test("Vim mode is off by default (AC-1)", async ({ page }) => {
  await editor(page).click()
  // With no Vim, j/k are literal characters, not motions.
  await page.keyboard.type("jk")
  await expect(editor(page)).toHaveText("jk")
  await expect(page.locator(".cm-vimMode")).toHaveCount(0)
})

test("the toggle turns Vim on and off (AC-2)", async ({ page }) => {
  await enableVimAndFocus(page) // on: normal mode indicator present

  await vimToggle(page).click() // off
  await expect(vimToggle(page)).toHaveAttribute("aria-pressed", "false")
  await expect(page.locator(".cm-vimMode")).toHaveCount(0)
  await editor(page).click()
  await page.keyboard.type("j") // back to the default model — a literal char
  await expect(editor(page)).toHaveText("j")
})

test("the Vim choice persists across a reload (AC-3)", async ({ page }) => {
  await vimToggle(page).click()
  await expect(vimToggle(page)).toHaveAttribute("aria-pressed", "true")

  await page.reload()
  await page.locator("#open-folder").click() // OPFS doesn't auto-resume

  await expect(vimToggle(page)).toHaveAttribute("aria-pressed", "true")
  await editor(page).click()
  await expect(page.locator(".cm-vimMode")).toBeVisible() // still in Vim
})

test("with Vim on, the slash menu still works (AC-4)", async ({ page }) => {
  await enableVimAndFocus(page)
  await page.keyboard.press("i") // insert mode

  await page.keyboard.type("/h2")
  await expect(menu(page)).toBeVisible()
  await option(page, "/h2").click() // accept (deterministic; Enter is AC-6's job)
  await expect(menu(page)).toBeHidden()

  await page.keyboard.type("Heading")
  await page.keyboard.press("Control+s")
  await expect.poll(() => readStartMd(page)).toBe("## Heading")
})

test("with Vim on, the bold shortcut still works (AC-5)", async ({ page }) => {
  await enableVimAndFocus(page)
  await page.keyboard.press("i") // insert mode

  await page.keyboard.type("word")
  await page.keyboard.press("Control+a") // select the line
  await page.keyboard.press("Control+b") // bold — must not be swallowed by Vim
  await page.keyboard.press("Control+s")
  await expect.poll(() => readStartMd(page)).toBe("**word**")
})

test("with Vim on, the markdown-aware Enter still continues a list (AC-6)", async ({
  page,
}) => {
  await enableVimAndFocus(page)
  await page.keyboard.press("i") // insert mode

  // Enter is bound by Vim only in normal mode, so in insert mode it falls through
  // to continueOrExitMarkup (FEAT-0018) — it continues the bullet list.
  await page.keyboard.type("* a")
  await page.keyboard.press("Enter")
  await page.keyboard.type("b")
  await page.keyboard.press("Control+s")
  await expect.poll(() => readStartMd(page)).toBe("* a\n* b")
})

test("with Vim on, normal-mode motions/edits are active (AC-7)", async ({ page }) => {
  await enableVimAndFocus(page)

  await page.keyboard.press("i")
  await page.keyboard.type("hello")
  await page.keyboard.press("Escape") // back to normal mode
  await page.keyboard.press("0") // start of line
  await page.keyboard.press("x") // delete the char under the cursor
  await expect(editor(page)).toHaveText("ello")
})

test("toggling Vim does not write to the user's folder (AC-8)", async ({ page }) => {
  await editor(page).click()
  await page.keyboard.type("untouched")
  await page.keyboard.press("Control+s")
  await expect.poll(() => readStartMd(page)).toBe("untouched")

  await vimToggle(page).click() // reconfigures the editor only — no folder write
  await expect(vimToggle(page)).toHaveAttribute("aria-pressed", "true")
  expect(await readStartMd(page)).toBe("untouched")
})
