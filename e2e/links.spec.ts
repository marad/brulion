import { test, expect, type Page } from "@playwright/test"

const FOLDER = "e2e-links-folder"

async function stubPicker(page: Page) {
  await page.addInitScript((folder) => {
    window.showDirectoryPicker = async () => {
      const root = await navigator.storage.getDirectory()
      return await root.getDirectoryHandle(folder, { create: true })
    }
    // Record window.open calls so the external-link test needn't hit the network.
    ;(window as unknown as { __opened: string[] }).__opened = []
    window.open = ((url?: string | URL) => {
      ;(window as unknown as { __opened: string[] }).__opened.push(String(url))
      return null
    }) as typeof window.open
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

test("Ctrl+click an internal link switches to the target note (AC-6)", async ({ page }) => {
  await stubPicker(page)
  await page.goto("/brulion/")
  await page.locator("#open-folder").click()

  await createNote(page, "other")
  await typeInEditor(page, "other body")
  await createNote(page, "home")
  await typeInEditor(page, "see [go](other.md)")

  await expect(link(page, "go")).toBeVisible() // rendered as a link, markup hidden
  await link(page, "go").click({ modifiers: ["ControlOrMeta"] })

  await expect(editor(page)).toHaveText("other body") // switched to the linked note
})

test("Ctrl+click a missing internal link offers to create it (AC-7)", async ({ page }) => {
  await stubPicker(page)
  await page.goto("/brulion/")
  await page.locator("#open-folder").click()

  await createNote(page, "home")
  await typeInEditor(page, "see [new](fresh.md)")
  // A target that doesn't exist renders broken.
  await expect(link(page, "new")).toHaveClass(/cm-link-broken/)

  page.once("dialog", (d) => d.accept())
  await link(page, "new").click({ modifiers: ["ControlOrMeta"] })

  await expect(row(page, "fresh")).toHaveClass(/active/) // created and opened
  await expect(editor(page)).toHaveText("") // a fresh, empty note
})

test("Ctrl+click an external link opens a new tab, not in-app navigation (AC-8)", async ({
  page,
}) => {
  await stubPicker(page)
  await page.goto("/brulion/")
  await page.locator("#open-folder").click()

  await createNote(page, "home")
  await typeInEditor(page, "see [site](https://example.com)")
  await expect(link(page, "site")).not.toHaveClass(/cm-link-broken/) // external, never broken

  await link(page, "site").click({ modifiers: ["ControlOrMeta"] })

  // It opened in a new tab (stubbed) and the editor did not switch notes.
  const opened = await page.evaluate(() => (window as unknown as { __opened: string[] }).__opened)
  expect(opened).toContain("https://example.com")
  await expect(row(page, "home")).toHaveClass(/active/)
})
