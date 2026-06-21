import { test, expect, type Page } from "@playwright/test"

const FOLDER = "e2e-links-folder"

async function stubPicker(page: Page) {
  await page.addInitScript((folder) => {
    window.showDirectoryPicker = async () => {
      const root = await navigator.storage.getDirectory()
      return await root.getDirectoryHandle(folder, { create: true })
    }
  }, FOLDER)
}

const editor = (page: Page) => page.locator(".cm-content")
const row = (page: Page, name: string) => page.locator(".note-row", { hasText: name })
const link = (page: Page, text: string) => page.locator(".cm-link", { hasText: text })

async function createNote(page: Page, name: string) {
  await page.locator("#new-note-input").fill(name)
  await page.locator("#new-note-input").press("Enter")
}

async function typeInEditor(page: Page, text: string) {
  await editor(page).click() // focus left for the new-note input after a create
  await page.keyboard.type(text)
}

// The internal-switch and external-open paths are covered by link-interaction.spec
// (FEAT-0026, the now-plain-click model). This keeps FEAT-0025's distinctive case:
// a link to a non-existent note renders broken and following it creates the note.
test("clicking a missing internal link offers to create it (AC-5, AC-7)", async ({ page }) => {
  await stubPicker(page)
  await page.goto("/brulion/")
  await page.locator("#open-folder").click()

  await createNote(page, "home")
  await typeInEditor(page, "see [new](fresh.md)")
  await expect(link(page, "new")).toHaveClass(/cm-link-broken/) // target doesn't exist

  page.once("dialog", (d) => d.accept())
  await link(page, "new").click() // plain click follows (FEAT-0026)

  await expect(row(page, "fresh")).toHaveClass(/active/) // created and opened
  await expect(editor(page)).toHaveText("") // a fresh, empty note
})
