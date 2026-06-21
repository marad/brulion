import { test, expect, type Page } from "@playwright/test"

const FOLDER = "e2e-note-list-folder"

// showDirectoryPicker returns a real OPFS directory — a genuine
// FileSystemDirectoryHandle the app lists, reads, and writes against.
async function stubPicker(page: Page) {
  await page.addInitScript((folder) => {
    window.showDirectoryPicker = async () => {
      const root = await navigator.storage.getDirectory()
      return await root.getDirectoryHandle(folder, { create: true })
    }
  }, FOLDER)
}

async function writeNote(page: Page, name: string, text: string) {
  await page.evaluate(
    async ([folder, file, content]) => {
      const root = await navigator.storage.getDirectory()
      const dir = await root.getDirectoryHandle(folder, { create: true })
      const handle = await dir.getFileHandle(file, { create: true })
      const writable = await handle.createWritable()
      await writable.write(content)
      await writable.close()
    },
    [FOLDER, name, text] as const,
  )
}

const editor = (page: Page) => page.locator(".cm-content")
// The row div (carries the .active class); click via its name button.
const row = (page: Page, name: string) => page.locator(".note-row", { hasText: name })
const open = (page: Page, name: string) => row(page, name).locator(".note-name").click()

test("lists the folder's notes and switches between them (AC-1, AC-3)", async ({ page }) => {
  await stubPicker(page)
  await page.goto("/brulion/")
  await writeNote(page, "alpha.md", "alpha body")
  await writeNote(page, "beta.md", "beta body")

  await page.locator("#open-folder").click()

  await expect(page.locator(".note-name")).toHaveText(["alpha", "beta"])
  // One of the two is loaded and marked active.
  await expect(page.locator(".note-row.active")).toHaveCount(1)

  await open(page, "beta")
  await expect(editor(page)).toHaveText("beta body")
  await expect(row(page, "beta")).toHaveClass(/active/)

  await open(page, "alpha")
  await expect(editor(page)).toHaveText("alpha body")
  await expect(row(page, "alpha")).toHaveClass(/active/)
})

test("switching flushes the open note's unsaved edits (AC-4)", async ({ page }) => {
  await stubPicker(page)
  await page.goto("/brulion/")
  await writeNote(page, "alpha.md", "alpha body")
  await writeNote(page, "beta.md", "beta body")

  await page.locator("#open-folder").click()
  await open(page, "alpha")
  await expect(editor(page)).toHaveText("alpha body")

  await editor(page).click()
  await page.keyboard.type(" — appended")
  // Switch immediately, before the autosave debounce fires.
  await open(page, "beta")
  await expect(editor(page)).toHaveText("beta body")

  // alpha.md on disk must contain the appended text (flushed on switch).
  const alpha = await page.evaluate(async (folder) => {
    const root = await navigator.storage.getDirectory()
    const dir = await root.getDirectoryHandle(folder)
    const handle = await dir.getFileHandle("alpha.md")
    return await (await handle.getFile()).text()
  }, FOLDER)
  expect(alpha).toBe("alpha body — appended")
})

test("remembers the active note across a reload (AC-6)", async ({ page }) => {
  await stubPicker(page)
  await page.goto("/brulion/")
  await writeNote(page, "alpha.md", "alpha body")
  await writeNote(page, "beta.md", "beta body")

  await page.locator("#open-folder").click()
  await open(page, "beta")
  await expect(editor(page)).toHaveText("beta body")

  await page.reload()
  // The folder auto-restores on reload (handle still granted); the welcome screen
  // never reappears, and the last active note (beta) is restored.
  await expect(page.locator("#welcome")).toBeHidden()
  await expect(editor(page)).toHaveText("beta body")
  await expect(row(page, "beta")).toHaveClass(/active/)
})
