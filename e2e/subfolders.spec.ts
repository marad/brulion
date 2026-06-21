import { test, expect, type Page } from "@playwright/test"

const FOLDER = "e2e-subfolders-folder"

async function stubPicker(page: Page) {
  await page.addInitScript((folder) => {
    window.showDirectoryPicker = async () => {
      const root = await navigator.storage.getDirectory()
      return await root.getDirectoryHandle(folder, { create: true })
    }
  }, FOLDER)
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
const folderHeader = (page: Page, name: string) =>
  page.locator(".folder-header", { hasText: name })

async function createNote(page: Page, name: string) {
  await page.locator("#new-note-input").fill(name)
  await page.locator("#new-note-input").press("Enter")
}

test("creates a subfolder note, switches, and removes the folder on delete (AC-7, AC-8)", async ({
  page,
}) => {
  await stubPicker(page)
  await page.goto("/brulion/")
  await page.locator("#open-folder").click()

  // Create a note inside a subfolder via a pathed name.
  await createNote(page, "sub/one")
  await expect(folderHeader(page, "sub")).toBeVisible()
  const nested = page.locator(".folder-children .note-row", { hasText: "one" })
  await expect(nested).toBeVisible()
  await expect(nested).toHaveClass(/active/) // the freshly created nested note is open
  expect(await noteExists(page, "sub/one.md")).toBe(true)

  await editor(page).click() // focus left the editor for the new-note input after submit
  await page.keyboard.type("one body")
  await expect(editor(page)).toHaveText("one body")

  // Create a root note and give it distinct content.
  await createNote(page, "top")
  await editor(page).click()
  await page.keyboard.type("top body")
  await expect(editor(page)).toHaveText("top body")

  // Switch back to the nested note — its content loads.
  await nested.locator(".note-name").click()
  await expect(editor(page)).toHaveText("one body")

  // Delete the only note in `sub`: the folder header disappears.
  page.once("dialog", (d) => d.accept())
  await nested.locator(".note-delete").click()

  await expect(folderHeader(page, "sub")).toHaveCount(0)
  expect(await noteExists(page, "sub/one.md")).toBe(false)
  await expect(editor(page)).toHaveText("top body") // switched to the remaining root note
})
