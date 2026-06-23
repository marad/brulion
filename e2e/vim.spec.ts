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
const menu = (page: Page) => page.locator(".cm-tooltip-autocomplete")
const option = (page: Page, label: string) =>
  page.locator(".cm-tooltip-autocomplete li").filter({ hasText: label })

// The header Vim button was removed in M16 P2 (FEAT-0048): Vim is now toggled from
// the settings modal or the unchanged `Ctrl/Cmd+;` chord. These tests drive the
// chord (the keyboard path FEAT-0021 always owned) and read state from `.cm-vimMode`.
const toggleVimChord = (page: Page) => page.keyboard.press("Control+;")

/** Enable Vim and focus the editor (which lands in Vim normal mode). */
async function enableVimAndFocus(page: Page) {
  await toggleVimChord(page)
  await expect(page.locator(".cm-vimMode")).toBeVisible() // normal mode engaged
  await editor(page).click()
}

test.beforeEach(async ({ page }) => {
  await stubPicker(page)
  await page.goto("/brulion/")
  await page.locator("#open-folder").click()
  // Wait for the workspace to be shown before any `Ctrl/Cmd+;` chord — the chord
  // handler is gated on `workspaceShown`, so firing it too early is a no-op.
  await expect(page.locator("#open-settings")).toBeVisible()
})

test("Vim mode is off by default (AC-1)", async ({ page }) => {
  await editor(page).click()
  // With no Vim, j/k are literal characters, not motions.
  await page.keyboard.type("jk")
  await expect(editor(page)).toHaveText("jk")
  await expect(page.locator(".cm-vimMode")).toHaveCount(0)
})

test("the Ctrl/Cmd+; chord turns Vim on and off (AC-2)", async ({ page }) => {
  await enableVimAndFocus(page) // on: normal mode indicator present

  await toggleVimChord(page) // off
  await expect(page.locator(".cm-vimMode")).toHaveCount(0)
  await editor(page).click()
  await page.keyboard.type("j") // back to the default model — a literal char
  await expect(editor(page)).toHaveText("j")

  await toggleVimChord(page) // on again
  await expect(page.locator(".cm-vimMode")).toBeVisible()
})

test("the Vim choice persists across a reload (AC-3)", async ({ page }) => {
  await toggleVimChord(page)
  await expect(page.locator(".cm-vimMode")).toBeVisible()

  await page.reload()
  // The folder auto-restores on reload (handle still granted); no re-pick needed.
  await expect(page.locator("#welcome")).toBeHidden()
  await editor(page).click()
  await expect(page.locator(".cm-vimMode")).toBeVisible() // still in Vim (from .brulion.json)
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

test("toggling Vim never writes a note file (AC-8)", async ({ page }) => {
  await editor(page).click()
  await page.keyboard.type("untouched")
  await page.keyboard.press("Control+s")
  await expect.poll(() => readStartMd(page)).toBe("untouched")

  // Toggling Vim reconfigures the editor and persists the flag to the per-vault
  // settings file (`.brulion.json`, M16/FEAT-0047) — never a note's `.md` bytes.
  await toggleVimChord(page)
  await expect(page.locator(".cm-vimMode")).toBeVisible()
  expect(await readStartMd(page)).toBe("untouched") // the note is untouched (the moat)
})

// FEAT-0032: the Vim caret must never rest inside — or before — a hidden markup
// run. We prove *where* the block cursor landed by deleting the char under it
// (`x`) and reading the saved bytes — a deterministic proxy for the resting
// position. A line-start motion (`0`) must land on the first visible glyph (past
// the hidden `# `/`> `/`* ` run), so `x` deletes that glyph, not the markup.

/** In normal mode, type `text` (entering insert with `i`) and return to normal. */
async function seedLine(page: Page, text: string) {
  await page.keyboard.press("i")
  await page.keyboard.type(text)
  await page.keyboard.press("Escape")
}

test("Vim: a line-start motion skips a hidden heading marker (FEAT-0032 AC-1)", async ({
  page,
}) => {
  await enableVimAndFocus(page)
  await seedLine(page, "# Heading")
  await page.keyboard.press("0") // line start → must land on `H`, not the hidden `# `
  await page.keyboard.press("x") // delete the char under the cursor
  await page.keyboard.press("Control+s")
  await expect.poll(() => readStartMd(page)).toBe("# eading")
})

test("Vim: a blockquote marker is skipped (FEAT-0032 AC-3)", async ({ page }) => {
  await enableVimAndFocus(page)
  await seedLine(page, "> quote")
  await page.keyboard.press("0")
  await page.keyboard.press("x")
  await page.keyboard.press("Control+s")
  await expect.poll(() => readStartMd(page)).toBe("> uote")
})

test("Vim: a list marker is skipped (FEAT-0032 AC-4)", async ({ page }) => {
  await enableVimAndFocus(page)
  await seedLine(page, "* item")
  await page.keyboard.press("0")
  await page.keyboard.press("x")
  await page.keyboard.press("Control+s")
  await expect.poll(() => readStartMd(page)).toBe("* tem")
})

test("Vim: insert-at-line-start (Shift+I) inserts after the hidden marker (FEAT-0032 AC-2)", async ({
  page,
}) => {
  // The reported bug: on `# test`, Esc → Shift+I → typing landed *before* the
  // hidden `# ` (`foo# test`). It must insert at the first visible char.
  await enableVimAndFocus(page)
  await seedLine(page, "# test")
  await page.keyboard.press("Shift+I") // Vim `I`: insert at the first non-blank
  await page.keyboard.type("foo ")
  await page.keyboard.press("Escape")
  await page.keyboard.press("Control+s")
  await expect.poll(() => readStartMd(page)).toBe("# foo test")
})

test("with Vim on, the visual-mode selection is visible (AC-9)", async ({ page }) => {
  await enableVimAndFocus(page)
  await page.keyboard.press("i")
  await page.keyboard.type("hello world")
  await page.keyboard.press("Escape") // normal mode
  await page.keyboard.press("0") // line start
  await page.keyboard.press("v") // visual mode
  await page.keyboard.press("$") // extend to line end

  // drawSelection paints a highlight with real size — not an invisible selection.
  const bg = page.locator(".cm-selectionLayer .cm-selectionBackground").first()
  await expect(bg).toBeVisible()
  const box = await bg.boundingBox()
  expect(box?.width ?? 0).toBeGreaterThan(0)
})
