import { test, expect, type Page } from "@playwright/test"

const FOLDER = "e2e-move-folder-folder"

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

async function readNoteContent(page: Page, path: string): Promise<string> {
  return await page.evaluate(
    async ([folder, rel]) => {
      const root = await navigator.storage.getDirectory()
      let dir = await root.getDirectoryHandle(folder, { create: true })
      const segments = rel.split("/")
      for (const seg of segments.slice(0, -1)) dir = await dir.getDirectoryHandle(seg)
      const handle = await dir.getFileHandle(segments[segments.length - 1])
      return await (await handle.getFile()).text()
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

const editor = (page: Page) => page.locator(".cm-content")
const folderHeader = (page: Page, name: string) => page.locator(".folder-header", { hasText: name })
const moveRow = (page: Page, label: string) => page.locator("#move-list .move-row", { hasText: label })

// "Move…" lives behind the folder header's context menu now (M35/FEAT-0071),
// not an inline button — right-click it, then pick the item.
async function openMoveFolder(page: Page, name: string) {
  await folderHeader(page, name).click({ button: "right" })
  await page.locator(".cm-context-menu button[role=menuitem]", { hasText: "Move…" }).click()
}

test("moves a folder and everything beneath it, including nested subfolders (AC-3)", async ({ page }) => {
  await stubPicker(page)
  await page.goto("/brulion/")
  await writeNote(page, "archive/keep.md", "keep body")
  await writeNote(page, "projects/a.md", "a body")
  await writeNote(page, "projects/ideas/b.md", "b body")
  await page.locator("#open-folder").click()

  await openMoveFolder(page, "projects")
  await moveRow(page, "archive").click()
  await expect(page.locator("#move-backdrop")).toBeHidden() // picker closes once the move settles

  expect(await noteExists(page, "archive/projects/a.md")).toBe(true)
  expect(await noteExists(page, "archive/projects/ideas/b.md")).toBe(true)
  expect(await noteExists(page, "projects/a.md")).toBe(false)
  expect(await folderExists(page, "projects")).toBe(false)
})

test("refuses moving a folder into itself, showing a message (AC-4)", async ({ page }) => {
  await stubPicker(page)
  await page.goto("/brulion/")
  await writeNote(page, "projects/a.md", "a body")
  await page.locator("#open-folder").click()

  await openMoveFolder(page, "projects")
  await moveRow(page, "projects").click()

  await expect(page.locator("#move-error")).toBeVisible()
  expect(await noteExists(page, "projects/a.md")).toBe(true)
})

test("refuses moving a folder into its own descendant (AC-5)", async ({ page }) => {
  await stubPicker(page)
  await page.goto("/brulion/")
  await writeNote(page, "projects/a.md", "a body")
  await writeNote(page, "projects/ideas/c.md", "c body")
  await page.locator("#open-folder").click()

  await openMoveFolder(page, "projects")
  await moveRow(page, "projects/ideas").click()

  await expect(page.locator("#move-error")).toBeVisible()
  expect(await noteExists(page, "projects/a.md")).toBe(true)
})

test("rebases a moved note's own links and rewrites inbound links from outside (AC-6, AC-7)", async ({
  page,
}) => {
  await stubPicker(page)
  await page.goto("/brulion/")
  await writeNote(page, "archive/keep.md", "keep body")
  await writeNote(page, "projects/a.md", "[b](b.md)") // same-folder relative link, moves along
  await writeNote(page, "projects/b.md", "b body")
  await writeNote(page, "outside.md", "[a](projects/a.md)") // inbound link from outside the folder
  await page.locator("#open-folder").click()

  await openMoveFolder(page, "projects")
  await moveRow(page, "archive").click()
  await expect(page.locator("#move-backdrop")).toBeHidden() // picker closes once the move settles

  expect(await readNoteContent(page, "archive/projects/a.md")).toBe("[b](b.md)")
  expect(await readNoteContent(page, "outside.md")).toBe("[a](archive/projects/a.md)")
})

test("the active note follows when its folder moves (AC-8)", async ({ page }) => {
  await stubPicker(page)
  await page.goto("/brulion/")
  await writeNote(page, "archive/keep.md", "keep body")
  await writeNote(page, "projects/a.md", "a body")
  await page.locator("#open-folder").click()
  await folderHeader(page, "projects").click() // collapsed by default — expand it
  await page.locator(".folder-children .note-row", { hasText: "a" }).locator(".note-name").click()
  await expect(editor(page)).toHaveText("a body")

  await openMoveFolder(page, "projects")
  await moveRow(page, "archive").click()
  await expect(page.locator("#move-backdrop")).toBeHidden() // picker closes once the move settles

  await expect(editor(page)).toHaveText("a body") // still showing, now at the new path
  expect(await noteExists(page, "archive/projects/a.md")).toBe(true)
})
