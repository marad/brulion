import { test, expect, type Page } from "@playwright/test"

const FOLDER = "e2e-move-note-folder"

async function stubPicker(page: Page) {
  await page.addInitScript((folder) => {
    window.showDirectoryPicker = async () => {
      const root = await navigator.storage.getDirectory()
      return await root.getDirectoryHandle(folder, { create: true })
    }
  }, FOLDER)
}

async function writeNote(page: Page, path: string, content: string) {
  await page.evaluate(
    async ([folder, rel, text]) => {
      const root = await navigator.storage.getDirectory()
      let dir = await root.getDirectoryHandle(folder, { create: true })
      const segments = rel.split("/")
      for (const seg of segments.slice(0, -1)) dir = await dir.getDirectoryHandle(seg, { create: true })
      const handle = await dir.getFileHandle(segments[segments.length - 1], { create: true })
      const writable = await handle.createWritable()
      await writable.write(text)
      await writable.close()
    },
    [FOLDER, path, content] as const,
  )
}

async function noteExists(page: Page, path: string): Promise<boolean> {
  return await page.evaluate(
    async ([folder, rel]) => {
      const root = await navigator.storage.getDirectory()
      let dir = await root.getDirectoryHandle(folder, { create: true })
      const segments = rel.split("/")
      try {
        for (const seg of segments.slice(0, -1)) dir = await dir.getDirectoryHandle(seg)
        await dir.getFileHandle(segments[segments.length - 1])
        return true
      } catch {
        return false
      }
    },
    [FOLDER, path] as const,
  )
}

const editor = (page: Page) => page.locator(".cm-content")
const row = (page: Page, name: string) => page.locator(".note-row", { hasText: name })
const folderHeader = (page: Page, name: string) => page.locator(".folder-header", { hasText: name })
const moveRow = (page: Page, label: string) => page.locator("#move-list .move-row", { hasText: label })

// "Move…" lives behind the note row's context menu now (M35/FEAT-0071), not
// an inline button — right-click the row, then pick it.
async function openMoveNote(rowLocator: ReturnType<typeof row>) {
  await rowLocator.click({ button: "right" })
  await rowLocator
    .page()
    .locator(".cm-context-menu button[role=menuitem]", { hasText: "Move…" })
    .click()
}

test("moves a note to another folder via the picker, switching to it first (AC-1)", async ({ page }) => {
  await stubPicker(page)
  await page.goto("/brulion/")
  await writeNote(page, "start.md", "start body")
  await writeNote(page, "alpha.md", "alpha body")
  await writeNote(page, "projects/x.md", "x body")
  await page.locator("#open-folder").click()
  await expect(editor(page)).toHaveText("start body") // start.md is active by default, not alpha

  await openMoveNote(row(page, "alpha"))
  await expect(page.locator("#move-input")).toBeFocused()
  await expect(editor(page)).toHaveText("alpha body") // switched to alpha before the picker even opens
  await moveRow(page, "projects").click()
  await expect(page.locator("#move-backdrop")).toBeHidden() // picker closes once the move settles

  expect(await noteExists(page, "projects/alpha.md")).toBe(true)
  expect(await noteExists(page, "alpha.md")).toBe(false)
})

test("moves a note back to the root via the picker (AC-2)", async ({ page }) => {
  await stubPicker(page)
  await page.goto("/brulion/")
  await writeNote(page, "projects/alpha.md", "alpha body")
  await page.locator("#open-folder").click()
  // The only note is auto-active, so "projects" is already expanded as its
  // ancestor (FEAT-0043) — no need to click the folder header.

  await openMoveNote(page.locator(".folder-children .note-row", { hasText: "alpha" }))
  await moveRow(page, "(root)").click()
  await expect(page.locator("#move-backdrop")).toBeHidden()

  expect(await noteExists(page, "alpha.md")).toBe(true)
  expect(await noteExists(page, "projects/alpha.md")).toBe(false)
})
