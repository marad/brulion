import { test, expect, type Page } from "@playwright/test"

// M35/FEAT-0072: "New note…" seeds the quick switcher with a folder prefix;
// "Rename…" changes only a note's/folder's own leaf segment.
const FOLDER = "e2e-tree-new-note-rename-folder"

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

async function clickMenuItem(page: Page, label: string) {
  await page.locator(".cm-context-menu button[role=menuitem]", { hasText: label }).click()
}

test("a folder's New note… opens the switcher pre-filled with its path (AC-1, AC-2)", async ({ page }) => {
  await stubPicker(page)
  await page.goto("/brulion/")
  await writeNote(page, "projects/keep.md", "keep body")
  await page.locator("#open-folder").click()

  await folderHeader(page, "projects").click({ button: "right" })
  await clickMenuItem(page, "New note…")

  await expect(page.locator("#switcher-input")).toHaveValue("projects/")
  await page.locator("#switcher-input").type("ideas")
  await page.locator("#switcher-input").press("Enter")

  expect(await noteExists(page, "projects/ideas.md")).toBe(true)
})

test("renaming a note changes only its own leaf segment (AC-4)", async ({ page }) => {
  await stubPicker(page)
  await page.goto("/brulion/")
  await writeNote(page, "start.md", "start body")
  await writeNote(page, "projects/a.md", "a body")
  await page.locator("#open-folder").click()
  await expect(editor(page)).toHaveText("start body") // a.md is not the active note

  page.once("dialog", (d) => d.accept("b"))
  await folderHeader(page, "projects").click() // collapsed by default — expand it
  await page.locator(".folder-children .note-row", { hasText: "a" }).click({ button: "right" })
  await clickMenuItem(page, "Rename…")

  await expect.poll(() => noteExists(page, "projects/b.md")).toBe(true)
  expect(await noteExists(page, "projects/a.md")).toBe(false)
})

test("renaming a folder changes only its own leaf segment (AC-3)", async ({ page }) => {
  await stubPicker(page)
  await page.goto("/brulion/")
  await writeNote(page, "archive/projects/a.md", "a body")
  await page.locator("#open-folder").click()
  // The only note is auto-active, so both "archive" and "archive/projects"
  // are already expanded as its ancestors (FEAT-0043) — no click needed.

  page.once("dialog", (d) => d.accept("work"))
  await folderHeader(page, "projects").click({ button: "right" })
  await clickMenuItem(page, "Rename…")

  await expect.poll(() => noteExists(page, "archive/work/a.md")).toBe(true)
  expect(await noteExists(page, "archive/projects/a.md")).toBe(false)
})
