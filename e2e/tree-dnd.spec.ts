import { test, expect, type Page } from "@playwright/test"

// M35/FEAT-0072: dragging a note or folder row onto a folder (or the root
// drop zone) moves it — additive to the "Move…" picker, same underlying move.
const FOLDER = "e2e-tree-dnd-folder"

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

async function folderExists(page: Page, path: string): Promise<boolean> {
  return await page.evaluate(
    async ([folder, rel]) => {
      const root = await navigator.storage.getDirectory()
      let dir = await root.getDirectoryHandle(folder, { create: true })
      try {
        for (const seg of rel.split("/")) dir = await dir.getDirectoryHandle(seg)
        return true
      } catch {
        return false
      }
    },
    [FOLDER, path] as const,
  )
}

const row = (page: Page, name: string) => page.locator(".note-row", { hasText: name })
const folderHeader = (page: Page, name: string) => page.locator(".folder-header", { hasText: name })

test("dragging a note onto a folder moves it there (AC-5)", async ({ page }) => {
  await stubPicker(page)
  await page.goto("/brulion/")
  await writeNote(page, "alpha.md", "alpha body")
  await writeNote(page, "projects/keep.md", "keep body")
  await page.locator("#open-folder").click()

  await row(page, "alpha").dragTo(folderHeader(page, "projects"))

  await expect.poll(() => noteExists(page, "projects/alpha.md")).toBe(true)
  expect(await noteExists(page, "alpha.md")).toBe(false)
})

test("dragging a folder onto another folder moves it and its contents (AC-6)", async ({ page }) => {
  await stubPicker(page)
  await page.goto("/brulion/")
  await writeNote(page, "archive/keep.md", "keep body")
  await writeNote(page, "projects/a.md", "a body")
  await page.locator("#open-folder").click()

  await folderHeader(page, "projects").dragTo(folderHeader(page, "archive"))

  await expect.poll(() => noteExists(page, "archive/projects/a.md")).toBe(true)
  expect(await folderExists(page, "projects")).toBe(false)
})

test("dropping a folder onto itself does not move it (AC-7)", async ({ page }) => {
  await stubPicker(page)
  await page.goto("/brulion/")
  await writeNote(page, "projects/a.md", "a body")
  await page.locator("#open-folder").click()

  await folderHeader(page, "projects").dragTo(folderHeader(page, "projects"))

  expect(await noteExists(page, "projects/a.md")).toBe(true) // untouched
})

test("dropping a note onto the root zone moves it there (root drop)", async ({ page }) => {
  await stubPicker(page)
  await page.goto("/brulion/")
  await writeNote(page, "projects/alpha.md", "alpha body")
  await page.locator("#open-folder").click()

  await row(page, "alpha").dragTo(page.locator("#note-list"))

  await expect.poll(() => noteExists(page, "alpha.md")).toBe(true)
  expect(await noteExists(page, "projects/alpha.md")).toBe(false)
})

test("the Move… picker still works after this phase (AC-8)", async ({ page }) => {
  await stubPicker(page)
  await page.goto("/brulion/")
  await writeNote(page, "alpha.md", "alpha body")
  await writeNote(page, "projects/keep.md", "keep body")
  await page.locator("#open-folder").click()

  await row(page, "alpha").click({ button: "right" })
  await page.locator(".cm-context-menu button[role=menuitem]", { hasText: "Move…" }).click()
  await page.locator("#move-list .move-row", { hasText: "projects" }).click()
  await expect(page.locator("#move-backdrop")).toBeHidden()

  expect(await noteExists(page, "projects/alpha.md")).toBe(true)
})
