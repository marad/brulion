import { test, expect, type Page } from "@playwright/test"

// FEAT-0020: the note sidebar can be collapsed to an editor-only view and the
// choice persists. Real browser: a CSS-class layout change, a window-level
// Ctrl+\ shortcut that must not disturb the editor, and idb-keyval persistence
// across a reload — none of which happy-dom can exercise faithfully.

const FOLDER = "e2e-sidebar-folder"

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
const sidebar = (page: Page) => page.locator("#sidebar")
const toggle = (page: Page) => page.locator("#toggle-sidebar")
const resizer = (page: Page) => page.locator("#sidebar-resizer")

async function sidebarWidth(page: Page): Promise<number> {
  return (await sidebar(page).boundingBox())!.width
}

async function editorWidth(page: Page): Promise<number> {
  return (await page.locator("#editor").boundingBox())!.width
}

test.beforeEach(async ({ page }) => {
  await stubPicker(page)
  await page.goto("/brulion/")
})

test("the toggle collapses and restores the sidebar (AC-1)", async ({ page }) => {
  await page.locator("#open-folder").click()
  await expect(sidebar(page)).toBeVisible()

  await toggle(page).click()
  await expect(sidebar(page)).not.toBeVisible()

  await toggle(page).click()
  await expect(sidebar(page)).toBeVisible()
})

test("the toggle stays reachable while the sidebar is collapsed (AC-2)", async ({
  page,
}) => {
  await page.locator("#open-folder").click()
  await toggle(page).click()

  await expect(sidebar(page)).not.toBeVisible()
  await expect(toggle(page)).toBeVisible() // the way back is still there
})

test("Ctrl+\\ toggles from editor focus without disturbing the editor (AC-3)", async ({
  page,
}) => {
  await page.locator("#open-folder").click()
  await editor(page).click()
  await page.keyboard.type("hello")

  // The shortcut fires while the editor has focus and collapses the sidebar — and
  // it does not leak into the document (no stray backslash inserted).
  await page.keyboard.press("Control+\\")
  await expect(sidebar(page)).not.toBeVisible()
  await expect(editor(page)).toContainText("hello")
  await expect(editor(page)).not.toContainText("\\")

  // The existing bold shortcut is unaffected by the new binding.
  await page.keyboard.press("Control+a")
  await page.keyboard.press("Control+b")
  await page.keyboard.press("Control+s")
  await expect.poll(() => readStartMd(page)).toBe("**hello**")
})

test("the collapsed state persists across a reload (AC-4)", async ({ page }) => {
  await page.locator("#open-folder").click()
  await toggle(page).click()
  await expect(sidebar(page)).not.toBeVisible()

  await page.reload()
  // The folder auto-restores on reload (handle still granted), so the workspace
  // comes back without a re-pick; the saved preference keeps the sidebar collapsed.
  await expect(page.locator("#welcome")).toBeHidden()
  await expect(toggle(page)).toBeVisible()
  await expect(sidebar(page)).not.toBeVisible()
})

test("collapsing the sidebar writes nothing to the folder (AC-5)", async ({ page }) => {
  await page.locator("#open-folder").click()
  await editor(page).click()
  await page.keyboard.type("untouched")
  await page.keyboard.press("Control+s")
  await expect.poll(() => readStartMd(page)).toBe("untouched")

  await toggle(page).click() // collapse — a browser-local preference only
  await expect(sidebar(page)).not.toBeVisible()
  expect(await readStartMd(page)).toBe("untouched") // bytes unchanged
})

test("dragging the resize handle widens the sidebar, persists it, and writes nothing (FEAT-0044 AC-4, AC-5, AC-7)", async ({
  page,
}) => {
  await page.locator("#open-folder").click()
  await expect(sidebar(page)).toBeVisible()
  await editor(page).click()
  await page.keyboard.type("keep")
  await page.keyboard.press("Control+s")
  await expect.poll(() => readStartMd(page)).toBe("keep")

  const before = await sidebarWidth(page)
  const box = (await resizer(page).boundingBox())!
  const cx = box.x + box.width / 2
  const cy = box.y + box.height / 2
  await page.mouse.move(cx, cy)
  await page.mouse.down()
  await page.mouse.move(cx + 120, cy, { steps: 8 }) // drag right → wider
  await page.mouse.up()

  const after = await sidebarWidth(page)
  expect(after).toBeGreaterThan(before + 80) // grew by ~the drag delta (within clamp)
  expect(await readStartMd(page)).toBe("keep") // resizing wrote nothing to disk (AC-7)

  // The width survives a reload (the folder auto-restores and the saved width applies).
  await page.reload()
  await expect(page.locator("#welcome")).toBeHidden()
  await expect.poll(() => sidebarWidth(page)).toBeGreaterThan(before + 80)
})

test("dragging far past the available space pins the editor at its min width, sidebar takes the rest (FEAT-0044 AC-3)", async ({
  page,
}) => {
  await page.locator("#open-folder").click()
  await expect(sidebar(page)).toBeVisible()

  const box = (await resizer(page).boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + 4000, box.y + box.height / 2, { steps: 10 }) // drag way past the window
  await page.mouse.up()

  // The editor holds at its 20rem (~320px) min-width — never squeezed to nothing —
  // and the sidebar absorbs the remaining space rather than overflowing the window.
  const ew = await editorWidth(page)
  expect(ew).toBeGreaterThanOrEqual(300)
  expect(ew).toBeLessThan(360)
  expect(await sidebarWidth(page)).toBeGreaterThan(700)
})

test("the resize handle is absent before a folder opens and while collapsed (FEAT-0044 AC-6)", async ({
  page,
}) => {
  await expect(resizer(page)).toBeHidden() // no folder open yet — nothing to resize

  await page.locator("#open-folder").click()
  await expect(resizer(page)).toBeVisible()

  await toggle(page).click() // collapse the sidebar
  await expect(sidebar(page)).not.toBeVisible()
  await expect(resizer(page)).toBeHidden()

  await toggle(page).click() // expand again
  await expect(resizer(page)).toBeVisible()
})
