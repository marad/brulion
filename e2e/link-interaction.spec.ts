import { test, expect, type Page } from "@playwright/test"

const FOLDER = "e2e-link-interaction-folder"

async function stubPicker(page: Page) {
  await page.addInitScript((folder) => {
    window.showDirectoryPicker = async () => {
      const root = await navigator.storage.getDirectory()
      return await root.getDirectoryHandle(folder, { create: true })
    }
    // Record (and neutralize) programmatic anchor clicks so the external-link
    // test needn't open a real tab / hit the network.
    ;(window as unknown as { __clicked: string[] }).__clicked = []
    HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
      ;(window as unknown as { __clicked: string[] }).__clicked.push(this.href)
    }
  }, FOLDER)
}

const editor = (page: Page) => page.locator(".cm-content")
const link = (page: Page, text: string) => page.locator(".cm-link", { hasText: text })

async function createNote(page: Page, name: string) {
  await page.locator("#new-note-input").fill(name)
  await page.locator("#new-note-input").press("Enter")
}

async function typeInEditor(page: Page, text: string) {
  await editor(page).click()
  await page.keyboard.type(text)
}

test("plain click on an internal link switches to its note (AC-1)", async ({ page }) => {
  await stubPicker(page)
  await page.goto("/brulion/")
  await page.locator("#open-folder").click()

  await createNote(page, "other")
  await typeInEditor(page, "other body")
  await createNote(page, "home")
  await typeInEditor(page, "see [go](other.md)")

  await link(page, "go").click() // plain click — no modifier
  await expect(editor(page)).toHaveText("other body")
})

test("plain click on an external link opens a tab and does not switch notes (AC-2)", async ({
  page,
}) => {
  await stubPicker(page)
  await page.goto("/brulion/")
  await page.locator("#open-folder").click()

  await createNote(page, "home")
  await typeInEditor(page, "see [site](https://example.com)")

  await link(page, "site").click()

  const clicked = await page.evaluate(() => (window as unknown as { __clicked: string[] }).__clicked)
  expect(clicked).toContain("https://example.com/")
  await expect(editor(page)).toContainText("site") // still on the home note
})

test("Ctrl/Cmd+click places the caret and reveals the markup, without following (AC-4, AC-8)", async ({
  page,
}) => {
  await stubPicker(page)
  await page.goto("/brulion/")
  await page.locator("#open-folder").click()

  await createNote(page, "other")
  await typeInEditor(page, "other body")
  await createNote(page, "home")
  await typeInEditor(page, "see [go](other.md)")
  await expect(link(page, "go")).toBeVisible() // rendered (markup hidden) before the click

  await link(page, "go").click({ modifiers: ["ControlOrMeta"] })

  // Did not follow — still the home note — and the raw markup is now revealed.
  await expect(editor(page)).toContainText("(other.md)")
  await expect(editor(page)).toContainText("[go]")
})

test("a bare URL autolinks as a clickable link (AC-6)", async ({ page }) => {
  await stubPicker(page)
  await page.goto("/brulion/")
  await page.locator("#open-folder").click()

  await createNote(page, "home")
  await typeInEditor(page, "visit https://example.com today")

  await expect(link(page, "https://example.com")).toBeVisible()
})
