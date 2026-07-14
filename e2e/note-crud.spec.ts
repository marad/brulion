import { test, expect, type Page } from "@playwright/test"

const FOLDER = "e2e-note-crud-folder"

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

async function noteExists(page: Page, name: string): Promise<boolean> {
  return await page.evaluate(
    async ([folder, file]) => {
      const root = await navigator.storage.getDirectory()
      const dir = await root.getDirectoryHandle(folder, { create: true })
      try {
        await dir.getFileHandle(file)
        return true
      } catch {
        return false
      }
    },
    [FOLDER, name] as const,
  )
}

const editor = (page: Page) => page.locator(".cm-content")
const row = (page: Page, name: string) => page.locator(".note-row", { hasText: name })

// Creation now goes through the quick switcher (FEAT-0033): open it, type the name,
// Enter activates the "Create" row when the name matches no existing note.
async function createNote(page: Page, name: string) {
  await page.locator("#sidebar-search").click()
  await page.locator("#switcher-input").fill(name)
  await page.locator("#switcher-input").press("Enter")
}

// Delete now lives behind the row's context menu (M35/FEAT-0071), not an
// inline button — right-click the row, then pick "Delete" from the menu.
async function deleteNote(page: Page, name: string) {
  await row(page, name).click({ button: "right" })
  await page.locator(".cm-context-menu button[role=menuitem]", { hasText: "Delete" }).click()
}

test("creates a named note and opens it (AC-1)", async ({ page }) => {
  await stubPicker(page)
  await page.goto("/brulion/")
  await page.locator("#open-folder").click()

  await createNote(page, "Diablo builds")

  await expect(row(page, "Diablo builds")).toHaveClass(/active/)
  expect(await noteExists(page, "Diablo builds.md")).toBe(true)
  await editor(page).click() // focus was in the switcher input
  await page.keyboard.type("Whirlwind barb")
  await expect(editor(page)).toHaveText("Whirlwind barb")
})

test("typing an existing name opens it rather than duplicating (AC-3)", async ({ page }) => {
  await stubPicker(page)
  await page.goto("/brulion/")
  await writeNote(page, "alpha.md", "alpha body")
  await page.locator("#open-folder").click()
  await expect(row(page, "alpha")).toBeVisible()

  // The switcher offers an existing note to OPEN, never to re-create — so there is
  // no duplicate and no error path; the note just opens.
  await createNote(page, "alpha")

  await expect(editor(page)).toHaveText("alpha body")
  await expect(page.locator(".note-row")).toHaveCount(1) // no duplicate row
})

test("deletes a note after confirmation (AC-5, AC-6)", async ({ page }) => {
  await stubPicker(page)
  await page.goto("/brulion/")
  await writeNote(page, "keep.md", "keep body")
  await writeNote(page, "trash.md", "trash body")
  await page.locator("#open-folder").click()
  await expect(page.locator(".note-row")).toHaveCount(2)

  page.once("dialog", (d) => d.accept())
  await deleteNote(page, "trash")

  await expect(row(page, "trash")).toHaveCount(0)
  await expect(page.locator(".note-row")).toHaveCount(1)
  expect(await noteExists(page, "trash.md")).toBe(false)
})

test("declining the confirmation keeps the note (AC-5)", async ({ page }) => {
  await stubPicker(page)
  await page.goto("/brulion/")
  await writeNote(page, "alpha.md", "alpha body")
  await writeNote(page, "beta.md", "beta body")
  await page.locator("#open-folder").click()

  page.once("dialog", (d) => d.dismiss())
  await deleteNote(page, "beta")

  await expect(row(page, "beta")).toBeVisible()
  expect(await noteExists(page, "beta.md")).toBe(true)
})

test("deleting the active note switches to another (AC-7)", async ({ page }) => {
  await stubPicker(page)
  await page.goto("/brulion/")
  await writeNote(page, "alpha.md", "alpha body")
  await writeNote(page, "beta.md", "beta body")
  await page.locator("#open-folder").click()
  await row(page, "beta").locator(".note-name").click()
  await expect(editor(page)).toHaveText("beta body")

  page.once("dialog", (d) => d.accept())
  await deleteNote(page, "beta")

  await expect(row(page, "beta")).toHaveCount(0)
  await expect(editor(page)).toHaveText("alpha body") // switched to the remaining note
})
