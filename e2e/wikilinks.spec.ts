import { test, expect, type Page } from "@playwright/test"

const FOLDER = "e2e-wikilinks-folder"

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
  await editor(page).click()
  await page.keyboard.type(text)
}

test("clicking a wikilink to an existing note switches to it (AC-7)", async ({ page }) => {
  await stubPicker(page)
  await page.goto("/brulion/")
  await page.locator("#open-folder").click()

  await createNote(page, "other")
  await typeInEditor(page, "other body")
  await createNote(page, "home")
  await typeInEditor(page, "see [[other]]")

  await expect(link(page, "other")).toBeVisible() // rendered, brackets hidden
  await expect(link(page, "other")).not.toHaveClass(/cm-link-broken/) // target exists
  await link(page, "other").click()

  await expect(editor(page)).toHaveText("other body")
})

test("clicking a wikilink to a missing note creates it at the root (AC-8)", async ({ page }) => {
  await stubPicker(page)
  await page.goto("/brulion/")
  await page.locator("#open-folder").click()

  await createNote(page, "home")
  await typeInEditor(page, "see [[fresh]]")
  await expect(link(page, "fresh")).toHaveClass(/cm-link-broken/) // no fresh.md yet

  page.once("dialog", (d) => d.accept())
  await link(page, "fresh").click()

  await expect(row(page, "fresh")).toHaveClass(/active/) // created and opened
  await expect(editor(page)).toHaveText("") // a fresh, empty note
})
